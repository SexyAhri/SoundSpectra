import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const hardware = process.argv.includes("--hardware");
const selected = process.argv
  .find((value) => value.startsWith("--effect="))
  ?.slice(9);
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
const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto("http://127.0.0.1:1420");
await mkdir("artifacts/r3f", { recursive: true });
const result = await page.evaluate(async (selected) => {
  const [
    { FiberSceneRenderer },
    { SceneMotion },
    { defaults },
    { demoAnalysis },
  ] = await Promise.all([
    import("/src/features/spectrum/three/r3f/fiber-renderer.tsx"),
    import("/src/features/spectrum/three/motion.ts"),
    import("/src/features/spectrum/model.ts"),
    import("/src/features/spectrum/music-analysis.ts"),
  ]);
  document.querySelector(".app-shell").style.display = "none";
  const host = document.createElement("div");
  host.style.cssText =
    "width:640px;height:360px;background:#080e1b;position:fixed;left:0;top:0";
  document.body.append(host);
  const results = [];
  for (const effect of [
    "aurora_flow",
    "petal_bloom",
    "star_flight",
    "sound_field",
    "rhythm_balls",
    "rhythm_rain",
    "rhythm_skin",
    "ripple",
    "volume_rain",
    "dream_stars",
    "vortex",
  ].filter((effect) => !selected || effect === selected)) {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:100%;height:100%";
    host.append(canvas);
    const config = {
      ...defaults,
      effect,
      quality: "eco",
      sceneMode: "immersive",
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    };
    const errors = [],
      world = new FiberSceneRenderer(canvas, (error) =>
        errors.push(String(error)),
      ),
      motion = new SceneMotion();
    await world.resize(config, 1);
    for (let frame = 0; frame < 120; frame++)
      motion.step(demoAnalysis(frame / 60), 1 / 60, config.music, false);
    world.draw(motion, config, false);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const times = [],
      synchronized = [];
    for (let i = 0; i < 15; i++) {
      await new Promise(requestAnimationFrame);
      motion.step(demoAnalysis(2 + i / 60), 1 / 60, config.music, false);
      const start = performance.now();
      world.draw(motion, config, false, 1 / 60);
      times.push(performance.now() - start);
      world.renderer.getContext().finish();
      synchronized.push(performance.now() - start);
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
      opaque = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 45) lit++;
      if (pixels[i + 3] > 8) opaque++;
    }
    times.sort((a, b) => a - b);
    synchronized.sort((a, b) => a - b);
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    results.push({
      effect,
      lit,
      opaque,
      errors,
      error: gl.getError(),
      gpu: debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      width: canvas.width,
      height: canvas.height,
      cpuMedian: times[7],
      cpuP95: times[14],
      synchronizedMedian: synchronized[7],
      synchronizedP95: synchronized[14],
      ...canvas.dataset,
    });
    // Save the framebuffer while it is still valid; WebGL does not preserve it across tasks.
    if (effect === "aurora_flow") window.__auroraCapture = canvas.toDataURL();
    world.dispose();
    canvas.remove();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  host.remove();
  return results;
}, selected);
const capture = await page.evaluate(() => window.__auroraCapture);
if (capture)
  await writeFile(
    "artifacts/r3f/aurora.png",
    Buffer.from(capture.split(",")[1], "base64"),
  );
await writeFile(
  `artifacts/r3f/visual-report${hardware ? "-hardware" : ""}.json`,
  JSON.stringify({ results: result, errors }, null, 2),
);
console.log(JSON.stringify({ results: result, errors }, null, 2));
await browser.close();
