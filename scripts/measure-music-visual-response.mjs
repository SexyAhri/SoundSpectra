import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { visualProbeHtml } from "./visual-probe-html.mjs";

const hardware = process.argv.includes("--hardware");
const renderRoot = process.argv.find(arg => arg.startsWith("--render-root="))?.slice(14) ?? "/src/features/spectrum";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: hardware
    ? ["--enable-webgl"]
    : [
        "--enable-webgl",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
});
const page = await browser.newPage();
await page.route("**/music-response-probe", (route) =>
  route.fulfill({
    contentType: "text/html",
    body: visualProbeHtml('<body style="margin:0"></body>'),
  }),
);
await page.goto("http://127.0.0.1:1420/music-response-probe");
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const results = [];
const dspFingerprints = {};
for (const variant of ["before", "after"]) {
  const data = JSON.parse(
    await readFile(
      `artifacts/music-analysis/${variant === "before" ? "baseline-native" : "native"}.json`,
      "utf8",
    ),
  );
  dspFingerprints[variant] = data.dspFingerprint;
  for (const effect of ["sound_field", "rhythm_skin", "aurora_flow"])
    for (const name of ["low-attacks", "mid-attacks", "high-attacks"]) {
      const frames = data.cases
        .find((item) => item.name === name)
        .frames.filter((frame) => frame.audio.samplePosition / 48 < 850);
      const result = await page.evaluate(
        async ({ variant, effect, frames, name, renderRoot }) => {
          const [
            { FiberSceneRenderer },
            { defaults },
            { SceneMotion },
            { AudioFeatureTimeline },
          ] = await Promise.all([
            import(`${renderRoot}/three/r3f/fiber-renderer.tsx`),
            import(`${renderRoot}/model.ts`),
            import(
              variant === "before"
                ? "/artifacts/music-analysis/baseline-src/spectrum/three/motion.ts"
                : `${renderRoot}/three/motion.ts`
            ),
            import(
              variant === "before"
                ? "/artifacts/music-analysis/baseline-src/spectrum/audio-feature-timeline.ts"
                : `${renderRoot}/audio-feature-timeline.ts`
            ),
          ]);
          const canvas = document.createElement("canvas");
          canvas.style.cssText = "width:160px;height:90px";
          document.body.append(canvas);
          const failures = [],
            world = new FiberSceneRenderer(canvas, (error) =>
              failures.push(String(error)),
            );
          const config = {
            ...structuredClone(defaults),
            effect,
            quality: "eco",
            sceneMode: "immersive",
            bounds: { x: 0, y: 0, width: 1, height: 1 },
          };
          await world.resize(config, 1);
          const motion = new SceneMotion(),
            timeline = new AudioFeatureTimeline(),
            trace = [];
          const gl = world.renderer.getContext(),
            pixels = new Uint8Array(canvas.width * canvas.height * 4);
          let beat = -1,
            onsetTime = null;
          for (const { audio } of frames) {
            const time = audio.samplePosition / 48;
            timeline.push(audio, time);
            const shared = timeline.sample(time, config.music);
            motion.step(audio, 1024 / 48000, config.music, false, shared);
            if (shared.beatIndex > beat) {
              beat = shared.beatIndex;
              if (time >= 400 && onsetTime === null) onsetTime = time;
            }
            world.draw(motion, config, false, 1024 / 48000);
            gl.readPixels(
              0,
              0,
              canvas.width,
              canvas.height,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              pixels,
            );
            let ink = 0;
            for (let i = 0; i < pixels.length; i += 4)
              ink +=
                ((0.2126 * pixels[i] +
                  0.7152 * pixels[i + 1] +
                  0.0722 * pixels[i + 2]) *
                  pixels[i + 3]) /
                255;
            trace.push({
              time,
              ink,
              volume: motion.volume, presence: motion.presence,
              level: Math.max(...motion.frame.levels),
              pulse: shared.pulse,
            });
          }
          const active = trace.filter((point) => point.time >= 400),
            peak = active.reduce((a, b) => (b.ink > a.ink ? b : a));
          const threshold = Math.max(1, peak.ink * 0.05),
            first = active.find((point) => point.ink >= threshold);
          const error = gl.getError(),
            debug = gl.getExtension("WEBGL_debug_renderer_info"),
            gpu = debug
              ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
              : gl.getParameter(gl.RENDERER);
          world.dispose();
          canvas.remove();
          await new Promise((resolve) => setTimeout(resolve, 30));
          return {
            variant,
            effect,
            name,
            onsetDelayMs: onsetTime === null ? null : onsetTime - 400,
            visualStartMs: first ? first.time - 400 : null,
            visualPeakMs: peak.ink > 0 ? peak.time - 400 : null,
            peakInk: peak.ink,
            threshold,
            error,
            gpu,
            failures,
            trace,
          };
        },
        { variant, effect, name, frames, renderRoot },
      );
      results.push(result);
      console.log(
        `${variant} ${effect} ${name}: onset=${result.onsetDelayMs}, visual=${result.visualStartMs}, peak=${result.visualPeakMs}`,
      );
    }
}
await writeFile(
  "artifacts/music-analysis/visual-response.json",
  JSON.stringify(
    {
      hardware,
      renderRoot,
      dspFingerprints,
      note: "Sample-clock PCM-to-pixels simulation at 160×90; excludes capture, transport, display scheduling and physical display latency. First pixel response is 5% of the measured first-hit peak.",
      errors,
      results,
    },
    null,
    2,
  ),
);
await browser.close();
if (errors.length || results.some((item) => item.error || item.failures.length))
  process.exitCode = 1;
