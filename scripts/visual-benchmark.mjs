// Hardware WebGL integration benchmark. Input is explicitly simulated, not captured audio.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { visualProbeHtml } from "./visual-probe-html.mjs";

const option = (name, fallback) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1] ??
  fallback;
const width = Number(option("width", 3840)),
  height = Number(option("height", 2160)),
  quality = option("quality", "balanced");
const label=option('label',''), lyrics=process.argv.includes('--lyrics');
if(label&&!/^[a-zA-Z0-9_-]{1,60}$/.test(label))throw Error('Invalid benchmark label');
const suffix=label?`-${label}`:'';
if (
  !Number.isFinite(width) ||
  !Number.isFinite(height) ||
  width < 320 ||
  height < 180 ||
  width > 7680 ||
  height > 4320 ||
  !["eco", "balanced", "smooth"].includes(quality)
)
  throw Error("Invalid benchmark dimensions/quality");
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-webgl"],
});
try {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/visual-benchmark", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: visualProbeHtml(
        '<body style="margin:0;background:#0c101c"></body>',
      ),
    }),
  );
  await page.goto(`${option('url','http://127.0.0.1:1420')}/visual-benchmark`);
  const report = await page.evaluate(
    async ({ width, height, quality, lyrics }) => {
      const [
        { FiberSceneRenderer },
        { SceneMotion },
        { defaults },
        { demoAnalysis },
        { AudioFeatureTimeline },
        { threePixelBudgets },
      ] = await Promise.all([
        import("/src/features/spectrum/three/r3f/fiber-renderer.tsx"),
        import("/src/features/spectrum/three/motion.ts"),
        import("/src/features/spectrum/model.ts"),
        import("/src/features/spectrum/music-analysis.ts"),
        import("/src/features/spectrum/audio-feature-timeline.ts"),
        import("/src/features/spectrum/three/render-budget.ts"),
      ]);
      const effects = [
          "aurora_flow",
          "rhythm_balls",
          "sound_field",
          "star_flight",
        ],
        worlds = [],
        timeline = new AudioFeatureTimeline();
      document.body.style.cssText =
        "margin:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;background:#0c101c";
      try {
        for (const effect of effects) {
          const canvas = document.createElement("canvas");
          canvas.style.cssText = `width:${width / 2}px;height:${height / 2}px`;
          document.body.append(canvas);
          const config = {
            ...structuredClone(defaults),
            effect,
            quality,
            sceneMode: "immersive",
            bounds: { x: 0, y: 0, width: 1, height: 1 },
          };
          const world = new FiberSceneRenderer(canvas),
            motion = new SceneMotion();
          await world.resize(config, 4);
          worlds.push({ world, motion, config, canvas });
        }
        let sequence = 0,
          previous = performance.now(),
          started = previous;
        const cpu = [],
          complete = [],
          intervals = [];
        for (let frame = 0; frame < 140; frame++) {
          await new Promise(requestAnimationFrame);
          const now = performance.now(),
            dt = Math.min(0.1, (now - previous) / 1000),
            seconds = 2 + (now - started) / 1000;
          const end = Math.floor((seconds * 48000) / 1024);
          if (sequence === 0) sequence = end - 15;
          for (; sequence <= end; sequence++)
            timeline.push(demoAnalysis((sequence * 1024) / 48000 + 1e-8), now);
          const audio = demoAnalysis(seconds),
            begin = performance.now();
          for (const { world, motion, config } of worlds) {
            motion.step(
              audio,
              dt,
              config.music,
              false,
              timeline.sample(now, config.music),
            );
            world.draw(motion, config, false, dt, lyrics?{
              bounds:{x:.15,y:.55,width:.7,height:.25},lineKey:String(Math.floor(frame/60)),revision:Math.floor(frame/60)
            }:undefined);
          }
          const submit = performance.now() - begin;
          for (const { world } of worlds) world.renderer.getContext().finish();
          if (frame >= 20) {
            cpu.push(submit);
            complete.push(performance.now() - begin);
            intervals.push(now - previous);
          }
          previous = now;
        }
        const percentile = (values, p) =>
          values.sort((a, b) => a - b)[
            Math.min(values.length - 1, Math.floor(values.length * p))
          ];
        const results = worlds.map(({ world, motion, config, canvas }) => {
          const gl = world.renderer.getContext(),
            extension = gl.getExtension("WEBGL_debug_renderer_info");
          return {
            effect: config.effect,
            width: canvas.width,
            height: canvas.height,
            beatIndex: motion.frame.beatIndex,
            gpu: extension
              ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
              : gl.getParameter(gl.RENDERER),
            error: gl.getError(),
            ...canvas.dataset,
          };
        });
        window.__benchmarkWorlds = worlds;
        return {
          width,
          height,
          quality,
          lyricFocus:lyrics,
          regions: 4,
          samples: 120,
          pixelBudget: threePixelBudgets[quality],
          totalPixels: results.reduce(
            (sum, result) => sum + result.width * result.height,
            0,
          ),
          cpuMedian: percentile(cpu, 0.5),
          cpuP95: percentile(cpu, 0.95),
          synchronizedMedian: percentile(complete, 0.5),
          synchronizedP95: percentile(complete, 0.95),
          intervalMedian: percentile(intervals, 0.5),
          intervalP95: percentile(intervals, 0.95),
          results,
        };
      } catch (error) {
        worlds.forEach(({ world }) => world.dispose());
        throw error;
      }
    },
    { width, height, quality, lyrics },
  );
  await mkdir("artifacts/r3f", { recursive: true });
  await page.screenshot({
    path: `artifacts/r3f/desktop-${quality}-${width}${suffix}.png`,
  });
  report.disposed = await page.evaluate(() =>
    window.__benchmarkWorlds.map(({ world }) => {
      world.dispose();
      return { ...world.renderer.info.memory };
    }),
  );
  await writeFile(
    `artifacts/r3f/benchmark-${quality}-${width}${suffix}.json`,
    JSON.stringify({ ...report, errors }, null, 2),
  );
  console.log(JSON.stringify({ ...report, errors }, null, 2));
  if (
    errors.length ||
    report.totalPixels > report.pixelBudget ||
    report.results.some((result) => result.error || Number(result.frames) !== 140) ||
    report.disposed.some((result) => result.geometries || result.textures)
  )
    throw Error("Visual benchmark reported an error, an unexpected frame count, an exceeded pixel budget or leaked GPU resources");
} finally {
  await browser.close();
}
