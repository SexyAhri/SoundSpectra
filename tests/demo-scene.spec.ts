import { expect, test } from "@playwright/test";
import { defaults } from "../src/features/spectrum/model";

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript((settings) => {
    localStorage.setItem("soundspectra.settings.v1", JSON.stringify(settings));
  }, { ...defaults, effect: "volume_rain", quality: "eco", color: "#e7bd91" });
});

test("the terrace demo renders its wallpaper, snow, lyrics and bundled keepsakes without saving over the scene", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const skip = page.getByRole("button", { name: "跳过动画" });
  if (await skip.isVisible()) await skip.click();
  const toggle = page.getByRole("switch", { name: "演示动效" });
  await expect(toggle).toBeChecked();
  const preview = page.locator(".desktop-preview");
  await expect(preview).toHaveAttribute("data-scene-effect", "ripple");
  await expect(preview).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await expect.poll(() => page.locator(".three-scene-surface canvas").first().getAttribute("data-frames"), { timeout: 20_000 }).not.toBeNull();
  const wallpaper = page.getByTestId("preview-wallpaper");
  await expect(wallpaper).toHaveCSS("background-image", /terrace.*\.webp/);
  await expect(preview.locator(".lyric-layer")).toBeVisible();
  const keepsakes = preview.locator(".rail-item-media img");
  await expect(keepsakes).toHaveCount(8);
  await expect.poll(() => keepsakes.evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  const saved = await page.evaluate(() => localStorage.getItem("soundspectra.settings.v1"));
  expect(JSON.parse(saved!).effect).toBe("volume_rain");
  expect(await preview.locator(".rail-layer").getAttribute("inert")).not.toBeNull();
  await toggle.uncheck();
  await expect(preview).toHaveAttribute("data-scene-effect", "volume_rain");
  await expect(preview.locator(".rail-item-media img")).toHaveCount(0);
  await expect(preview.locator(".lyric-layer")).toHaveCount(0);
  await toggle.check();
  await expect(preview).toHaveAttribute("data-scene-effect", "ripple");
  await page.getByRole("button", { name: "场景收藏", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toggle).not.toBeChecked();
  await expect(preview).toHaveAttribute("data-scene-effect", "volume_rain");
  await toggle.check();
  await page.getByRole("button", { name: "编辑场景", exact: true }).click();
  await expect(preview).toHaveAttribute("data-scene-effect", "volume_rain");
  expect(await page.evaluate(() => localStorage.getItem("soundspectra.settings.v1"))).toBe(saved);
  expect(errors).toEqual([]);
});

test("real audio restores the user's composition and stopping it resumes the sample", async ({ page }) => {
  await page.route("**/src/features/spectrum/bridge.ts*", async route => {
    if (route.request().url().includes("demo-original")) return route.continue();
    await route.fulfill({ contentType: "text/javascript", body: `
      export * from '/src/features/spectrum/bridge.ts?demo-original';
      import { browserStatus } from '/src/features/spectrum/model.ts';
      export async function getStatus() { return { ...browserStatus, state: window.demoAudioState || 'waiting' }; }
    ` });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const preview = page.locator(".desktop-preview");
  await expect(preview).toHaveAttribute("data-scene-effect", "ripple");
  const saved = await page.evaluate(() => localStorage.getItem("soundspectra.settings.v1"));
  await page.evaluate(() => { (window as any).demoAudioState = "listening"; });
  await expect(preview).toHaveAttribute("data-scene-effect", "volume_rain");
  await expect(page.getByRole("switch", { name: "演示动效" })).toBeDisabled();
  await page.evaluate(() => { (window as any).demoAudioState = "silent"; });
  await expect(preview).toHaveAttribute("data-scene-effect", "ripple");
  expect(await page.evaluate(() => localStorage.getItem("soundspectra.settings.v1"))).toBe(saved);
});
