import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Capture the real UI with isolated browser storage and original demo text.
// The app must already be served by npm run dev. Nothing is written to app config.
const origin = "http://127.0.0.1:1420";
const output = "artifacts/showcase";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : "chrome",
  headless: true,
  args: [
    "--enable-webgl",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 940 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/tests/fixtures/kinetic-lyrics.html`);
  const defaults = await page.evaluate(
    async () => (await import("/src/features/spectrum/model.ts")).defaults,
  );
  const settings = {
    ...defaults,
    effect: "dream_stars",
    sceneMode: "immersive",
    opacity: 100,
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    lyrics: { ...defaults.lyrics, enabled: true },
  };
  await context.addInitScript(
    (value) =>
      localStorage.setItem("soundspectra.settings.v1", JSON.stringify(value)),
    settings,
  );
  await page.goto(`${origin}/#lyrics`);
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector(".three-scene-surface canvas")?.dataset.frames,
      ) > 20,
  );
  await page.evaluate(() => {
    const time = Number(
      document.querySelector(".kinetic-lyrics-canvas")?.dataset.time,
    );
    const captureTime = Date.now() - time + 3200;
    Date.now = () => captureTime;
  });
  await page.waitForFunction(() => {
    const time = Number(
      document.querySelector(".kinetic-lyrics-canvas")?.dataset.time,
    );
    return time > 2500 && time < 4000;
  });
  await page.screenshot({ path: `${output}/workspace.png` });
  await page.getByRole("button", { name: "音乐卡片", exact: true }).click();
  await page.getByRole("switch", { name: "显示桌面音乐卡片" }).click();
  await page.screenshot({ path: `${output}/music-card.png` });
  // Freeze the input time for standalone effect images, using the production renderer.
  await page.goto(`${origin}/tests/fixtures/kinetic-lyrics.html`);
  for (const [effect, name] of [
    ["volume_rain", "clear-sky"],
    ["ripple", "snowfall"],
  ]) {
    const image = await page.evaluate(async (effect) => {
      const { createThreeSceneRenderer } =
        await import("/src/features/spectrum/three/scene-renderer.ts");
      const { SceneMotion } =
        await import("/src/features/spectrum/three/motion.ts");
      const { defaults } = await import("/src/features/spectrum/model.ts");
      const { demoAnalysis } =
        await import("/src/features/spectrum/music-analysis.ts");
      const config = {
        ...defaults,
        effect,
        opacity: 100,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
      };
      const canvas = document.createElement("canvas");
      canvas.style.cssText = "width:960px;height:540px";
      document.body.append(canvas);
      const world = createThreeSceneRenderer(canvas, effect),
        motion = new SceneMotion();
      try {
        await world.resize(config, 1);
        for (let frame = 0; frame < 180; frame++) {
          motion.step(demoAnalysis(frame / 60), 1 / 60, config.music, false);
          world.draw(motion, config, false);
        }
        const cover = document.createElement("canvas");
        cover.width = 960;
        cover.height = 540;
        const ctx = cover.getContext("2d");
        ctx.fillStyle = effect === "volume_rain" ? "#93bdd0" : "#112131";
        ctx.fillRect(0, 0, 960, 540);
        ctx.drawImage(canvas, 0, 0, 960, 540);
        ctx.fillStyle = effect === "volume_rain" ? "#233d4b" : "#b7c6d0";
        ctx.font = "14px sans-serif";
        ctx.fillText("SoundSpectra · 模拟音频展示", 24, 516);
        return cover.toDataURL("image/png");
      } finally {
        world.dispose();
        world.renderer.forceContextLoss();
        canvas.remove();
      }
    }, effect);
    writeFileSync(
      `${output}/${name}.png`,
      Buffer.from(image.split(",")[1], "base64"),
    );
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const caption = document.createElement("div");
    caption.textContent = "SoundSpectra · 原创示例歌词 · 模拟展示";
    caption.style.cssText =
      "position:fixed;bottom:22px;left:32px;color:#71808b;font:12px sans-serif";
    document.body.append(caption);
  });
  for (const [mode, name] of [
    ["depth", "lyrics-roaming"],
    ["stage", "lyrics-staggered"],
    ["stardust", "lyrics-arc"],
  ]) {
    await page.evaluate(
      (mode) => window.lyricProbe.set({ mode, time: 2600 }),
      mode,
    );
    await page.waitForFunction((mode) => {
      const canvas = document.querySelector(".kinetic-lyrics-canvas");
      return (
        canvas?.dataset.time === "2600" && canvas?.dataset.composition === mode
      );
    }, mode);
    await page.screenshot({ path: `${output}/${name}.png` });
  }
  for (const name of [
    "workspace",
    "music-card",
    "clear-sky",
    "snowfall",
    "lyrics-roaming",
    "lyrics-staggered",
    "lyrics-arc",
  ]) {
    const data = readFileSync(`${output}/${name}.png`).toString("base64");
    const encoded = await page.evaluate(async (data) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return canvas.toDataURL("image/webp", 0.92).split(",")[1];
    }, data);
    writeFileSync(`${output}/${name}.webp`, Buffer.from(encoded, "base64"));
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    `Saved ${output}; input: simulated audio and original demo lyrics.`,
  );
} finally {
  await browser.close();
}
