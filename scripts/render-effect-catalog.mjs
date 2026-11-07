import { visualProbeHtml } from "./visual-probe-html.mjs";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const focus = process.argv.includes("--focus");

// Render the real shader/geometry path. No artwork approximations or user settings.
const browser = await chromium.launch({
  channel: "chrome",
  args: [
    "--enable-webgl",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: focus ? 390 : 900 },
    deviceScaleFactor: 1,
  });
  await page.route("**/effect-catalog-probe", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: visualProbeHtml('<body style="margin:0"></body>'),
    }),
  );
  await page.goto("http://127.0.0.1:1420/effect-catalog-probe");
  const samples = await page.evaluate(async (focus) => {
    const { defaults } = await import("/src/features/spectrum/model.ts");
    const { musicEffects } =
      await import("/src/features/spectrum/music-engine/catalog.ts");
    const { recommendedMusic } =
      await import("/src/features/spectrum/effect-presets.ts");
    const { effectPalettes } =
      await import("/src/features/spectrum/effect-palette.ts");
    const { createThreeSceneRenderer } =
      await import("/src/features/spectrum/three/scene-renderer.ts");
    const { SceneMotion } =
      await import("/src/features/spectrum/three/motion.ts");
    const { demoAnalysis } =
      await import("/src/features/spectrum/music-analysis.ts");
    const result = [];
    for (const effect of musicEffects) {
      if (focus && !["dream_stars", "rhythm_balls"].includes(effect.value))
        continue;
      const canvas = document.createElement("canvas");
      canvas.style.cssText = "width:480px;height:270px";
      document.body.append(canvas);
      const world = createThreeSceneRenderer(canvas, effect.value),
        motion = new SceneMotion();
      const config = {
        ...structuredClone(defaults),
        effect: effect.value,
        music: recommendedMusic(effect.value),
        opacity: 100,
        sceneMode: "immersive",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
      };
      try {
        await world.resize(config, 1);
        for (let i = 0; i < 60; i++) {
          motion.step(demoAnalysis(i / 20), 0.05, config.music, false);
          world.draw(motion, config, false);
        }
        const images = {};
        for (const fieldPalette of ["iris", "ember", "lake"]) {
          world.draw(
            motion,
            { ...config, music: { ...config.music, fieldPalette } },
            false,
          );
          images[fieldPalette] = canvas.toDataURL("image/webp", 0.92);
        }
        result.push({
          ...effect,
          images,
          palettes: effectPalettes[effect.value],
        });
      } finally {
        world.dispose();
        world.renderer.forceContextLoss();
        canvas.remove();
      }
    }
    return result;
  }, focus);
  await mkdir("artifacts", { recursive: true });
  for (const sample of samples)
    await writeFile(
      `src/assets/scenes/${sample.value}.webp`,
      Buffer.from(sample.images.iris.split(",")[1], "base64"),
    );
  const cards = samples
    .map(
      (sample) =>
        `<figure><img src="${sample.images.iris}"><figcaption>${sample.label}<small>${sample.palettes.iris.name}</small></figcaption></figure>`,
    )
    .join("");
  const style = `<style>body{margin:0;padding:24px;background:#181c20;color:#e8e9eb;font:14px 'Microsoft YaHei',sans-serif}h1{font-size:22px;margin:0 0 8px}p,small{color:#aab4bc}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}figure{margin:0;background:#242a30;border:1px solid #384049}img{display:block;width:100%;aspect-ratio:16/9}figcaption{padding:10px 12px;display:flex;justify-content:space-between;gap:8px}small{font-size:11px}</style>`;
  const html = `<!doctype html><meta charset="utf-8">${style}${focus ? "<style>.grid{grid-template-columns:repeat(2,1fr)}</style>" : ""}<h1>灯效配色与形态 · 调整后</h1><p>${focus ? "银河 / 浮光水母" : `现有 ${samples.length} 种灯效`} / 各自推荐参数 / 默认专属色板 / 同一模拟音频</p><div class="grid">${cards}</div>`;
  const output = focus ? "effect-trio-after" : "effect-color-after";
  await writeFile(`artifacts/${output}.html`, html);
  await page.setContent(html);
  await page.screenshot({ path: `artifacts/${output}.png`, fullPage: true });
  const variants = `<!doctype html><meta charset="utf-8">${style}<style>.grid{grid-template-columns:repeat(3,1fr)}h2{font-size:16px;margin-top:26px}</style><h1>专属配色实渲染</h1>${samples.map((sample) => `<h2>${sample.label}</h2><div class="grid">${["iris", "ember", "lake"].map((id) => `<figure><img src="${sample.images[id]}"><figcaption>${sample.palettes[id].name}</figcaption></figure>`).join("")}</div>`).join("")}`;
  await writeFile(
    `artifacts/${focus ? "effect-trio-palettes" : "effect-palette-variants"}.html`,
    variants,
  );
  console.log(
    `Rendered ${samples.length} effects and three palettes each; catalog thumbnails updated.`,
  );
} finally {
  await browser.close();
}
