import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { visualProbeHtml } from "./visual-probe-html.mjs";

const out = "artifacts/music-analysis/visual";
const baseline = JSON.parse(
  await readFile("artifacts/music-analysis/baseline-native.json", "utf8"),
);
const current = JSON.parse(
  await readFile("artifacts/music-analysis/native.json", "utf8"),
);
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
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/music-analysis-probe", (route) =>
  route.fulfill({
    contentType: "text/html",
    body: visualProbeHtml('<body style="margin:0;background:#080e1b"></body>'),
  }),
);
await page.goto("http://127.0.0.1:1420/music-analysis-probe");
await mkdir(out, { recursive: true });
const results = [];
const selected = [
  "mid-0.004",
  "bass-0.14142136",
  "mid-0.14142136",
  "high-0.14142136",
  "mid-attacks",
  "silence-after-tone",
];
for (const effect of [
  "rhythm_balls",
  "rhythm_rain",
  "rhythm_skin",
  "ripple",
  "volume_rain",
  "dream_stars",
  "vortex",
  "sound_field",
  "petal_bloom",
  "aurora_flow",
  "star_flight",
]) {
  for (const name of selected)
    for (const variant of ["before", "after"]) {
      const data = variant === "before" ? baseline : current;
      const frames =
        name === "silence-after-tone"
          ? [
              ...data.cases.find((item) => item.name === "mid-0.14142136")
                .frames,
              ...data.cases.find((item) => item.name === "silence").frames,
              ...data.cases.find((item) => item.name === "silence").frames,
            ]
          : data.cases.find((item) => item.name === name).frames;
      const result = await page.evaluate(
        async ({ frames, effect, name, variant, renderRoot }) => {
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
          canvas.style.cssText = "width:640px;height:360px";
          document.body.append(canvas);
          const config = {
            ...structuredClone(defaults),
            effect,
            quality: "eco",
            sceneMode: "immersive",
            bounds: { x: 0, y: 0, width: 1, height: 1 },
          };
          const failures = [],
            world = new FiberSceneRenderer(canvas, (error) =>
              failures.push(String(error)),
            );
          const motion = new SceneMotion(),
            timeline = new AudioFeatureTimeline();
          await world.resize(config, 1);
          let final, lastAudio;
          // Fixed sample time and identical current renderer isolate the audio algorithm.
          for (let i = 0; i < frames.length; i++) {
            const audio = {
              ...frames[i].audio, sourceRevision: 1, streamId: 1,
              sequence: i + 1,
              samplePosition: 4096 + i * 1024,
            };
            const time = audio.samplePosition / 48;
            if (name === "mid-attacks" && time > 510) break;
            timeline.push(audio, time);
            lastAudio = audio;
            final = motion.step(
              audio,
              1024 / 48000,
              config.music,
              false,
              timeline.sample(time, config.music),
            );
            world.draw(motion, config, false, 1024 / 48000);
          }
          const gl = world.renderer.getContext(),
            pixels = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(
            0,
            0,
            canvas.width,
            canvas.height,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels,
          );
          let lit = 0,
            ink = 0,
            opaque = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (
              Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 12 &&
              pixels[i + 3] > 8
            )
              lit++;
            if (pixels[i + 3] > 8) opaque++;
            ink +=
              ((0.2126 * pixels[i] +
                0.7152 * pixels[i + 1] +
                0.0722 * pixels[i + 2]) *
                pixels[i + 3]) /
              255;
          }
          const capture = canvas.toDataURL(),
            error = gl.getError(),
            debug = gl.getExtension("WEBGL_debug_renderer_info");
          const gpu = debug
            ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER);
          world.dispose();
          canvas.remove();
          await new Promise((resolve) => setTimeout(resolve, 30));
          return {
            effect,
            name,
            variant,
            width: canvas.width,
            height: canvas.height,
            lit,
            opaque,
            ink,
            error,
            gpu,
            failures,
            capture,
            frame: {
              rms: lastAudio.rms,
              audible: final.audible, presence: motion.presence, volume: motion.volume,
              intensity: final.intensity,
              levels: final.levels,
              transients: final.transients,
            },
          };
        },
        { frames, effect, name, variant, renderRoot },
      );
      const { capture, ...metrics } = result;
      await writeFile(
        `${out}/${effect}-${name}-${variant}.png`,
        Buffer.from(capture.split(",")[1], "base64"),
      );
      results.push(metrics);
      console.log(
        `${effect} ${name} ${variant}: lit=${metrics.lit}, gl=${metrics.error}`,
      );
    }
}
await writeFile(
  `${out}/report.json`,
  JSON.stringify({
    hardware, renderRoot,
    dspFingerprints: { before: baseline.dspFingerprint, after: current.dspFingerprint },
    errors, results,
  }, null, 2),
);
await browser.close();
if (errors.length || results.some((item) => item.error || item.failures.length))
  process.exitCode = 1;
