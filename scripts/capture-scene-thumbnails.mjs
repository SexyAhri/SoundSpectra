import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// Isolated browser storage, original demo lyrics, no system audio or personal wallpaper.
// Run against an owned dev server: node scripts/capture-scene-thumbnails.mjs --port=1449
const port = Number(process.argv.find((arg) => arg.startsWith("--port="))?.split("=")[1] ?? 1449);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Invalid port");
const folder = "src/assets/desktop-scenes";
const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-webgl"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = `http://127.0.0.1:${port}`;
  await page.goto(origin);
  const entries = await page.evaluate(async () => {
    const { desktopPresets } = await import("/src/features/preview/desktop-scenes.ts");
    const { sceneThumbnailSignature } = await import("/src/features/preview/scene-thumbnail-captures.ts");
    return desktopPresets.map((preset) => ({ id: preset.id, scene: preset.scene,
      signature: sceneThumbnailSignature(preset.scene) }));
  });
  const captures = [];
  await mkdir(folder, { recursive: true });
  for (const entry of entries) {
    await page.evaluate(async (scene) => {
      const { defaults, normalizeSettings } = await import("/src/features/spectrum/model.ts");
      const { scenePatch, desktopLayout } = await import("/src/features/preview/desktop-scenes.ts");
      const { sceneThumbnailSignature } = await import("/src/features/preview/scene-thumbnail-captures.ts");
      const settings = normalizeSettings({ ...defaults, ...scenePatch(defaults, scene), enabled: false });
      if (sceneThumbnailSignature(desktopLayout(settings)) !== sceneThumbnailSignature(scene))
        throw Error("Preset contains values changed by settings normalization");
      localStorage.setItem("soundspectra.settings.v1", JSON.stringify(settings));
    }, entry.scene);
    await page.reload();
    await page.locator(".startup-screen").waitFor({ state: "hidden" });
    const stage = page.locator(".atmosphere-preview .desktop-preview");
    await stage.waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector(".atmosphere-preview .desktop-preview")?.getAttribute("data-ready") === "true");
    const demo = page.getByRole("switch", { name: "演示动效" });
    await demo.check();
    if (entry.scene.regionVisible) await page.waitForFunction(() => Number(document.querySelector(".atmosphere-preview .preview-spectrum canvas")?.dataset.frames) >= 60);
    if (entry.scene.desktop.lyrics.enabled) {
      await page.waitForFunction(() => document.querySelector(".atmosphere-preview .kinetic-lyrics-canvas")?.dataset.fontsReady === "true");
      await page.evaluate(() => {
        const elapsed = Number(document.querySelector(".atmosphere-preview .kinetic-lyrics-canvas").dataset.time);
        const fixed = Date.now() - elapsed + 2600;
        Date.now = () => fixed;
      });
      await page.waitForFunction(() => Math.abs(Number(document.querySelector(".atmosphere-preview .kinetic-lyrics-canvas")?.dataset.time) - 2600) < 100);
    }
    // Exclude editor status badges from the scene image. Keep all visual content.
    await page.addStyleTag({ content: ".preview-corner,.lyric-demo-label{visibility:hidden!important}" });
    await page.evaluate(() => document.fonts.ready);
    const png = await stage.screenshot({ animations: "disabled" });
    const webp = await page.evaluate(async (base64) => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
      canvas.getContext("2d").drawImage(image, 0, 0, 640, 360);
      return canvas.toDataURL("image/webp", .92).split(",")[1];
    }, png.toString("base64"));
    captures.push({ id: entry.id, data: Buffer.from(webp, "base64") });
    console.log(`Captured ${entry.id}`);
  }
  if (errors.length) throw Error(errors.join("\n"));
  // Asset writes trigger Vite reloads; finish browser work before publishing them.
  await page.close();
  for (const { id, data } of captures) await writeFile(`${folder}/${id}.webp`, data);
  await writeFile(`${folder}/manifest.json`, JSON.stringify(entries.map(({ id, signature }) => ({ id, signature })), null, 2) + "\n");
} finally { await browser.close(); }
