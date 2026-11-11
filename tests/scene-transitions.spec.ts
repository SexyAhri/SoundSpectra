import { expect, test } from "@playwright/test";
import { defaults } from "../src/features/spectrum/model";
import { desktopPresets, scenePatch } from "../src/features/preview/desktop-scenes";

const initial = { ...structuredClone(defaults), enabled: false, quality: "eco" as const };
test.beforeEach(async ({ page }) => {
  await page.addInitScript((settings) => {
    if (!localStorage.getItem("soundspectra.settings.v1")) localStorage.setItem("soundspectra.settings.v1", JSON.stringify(settings));
  }, initial);
  await page.goto("/");
  await expect(page.locator(".studio-shell")).not.toHaveAttribute("inert", { timeout: 30000 });
});

test("rapid scene choices settle on the newest composition and do not save previews", async ({ page }) => {
  await page.getByRole("button", { name: "场景收藏", exact: true }).click();
  const stage = page.locator(".auto-scene-dialog .desktop-preview");
  await page.getByRole("button", { name: /暖砂日常/ }).click();
  await expect(stage).toHaveAttribute("data-scene-transition", /outgoing|incoming/);
  await page.getByRole("button", { name: /暮蓝听歌/ }).click();
  await page.getByRole("button", { name: /清浅专注/ }).click();
  await page.getByRole("button", { name: /暮蓝听歌/ }).click();
  await expect(stage).toHaveAttribute("data-scene-effect", desktopPresets[1].scene.effect);
  await expect(stage).not.toHaveAttribute("data-scene-transition");
  await expect(stage).toHaveCSS("opacity", "1");
  await expect(stage).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("soundspectra.settings.v1")!))).toEqual(initial);
  await page.getByRole("button", { name: "对比当前搭配" }).click();
  await expect(stage).toHaveAttribute("data-scene-effect", initial.effect);
  await expect(stage).not.toHaveAttribute("data-scene-transition");
  await page.getByRole("button", { name: "返回所选场景" }).click();
  await expect(stage).toHaveAttribute("data-scene-effect", desktopPresets[1].scene.effect);
  await page.getByRole("button", { name: "应用此场景", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".scene-feedback")).toContainText("暮蓝听歌");
  await expect(page.locator(".atmosphere-preview .desktop-preview")).toHaveAttribute("data-scene-effect", desktopPresets[1].scene.effect);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("soundspectra.settings.v1")!))).toEqual({ ...initial, ...scenePatch(initial, desktopPresets[1].scene) });
  await page.getByRole("button", { name: "撤销搭配" }).click();
  await expect(page.locator(".atmosphere-preview .desktop-preview")).toHaveAttribute("data-scene-effect", initial.effect);
  await expect(page.locator(".desktop-preview")).not.toHaveAttribute("data-scene-transition");
  await expect(page.locator(".desktop-preview")).toHaveCSS("opacity", "1");
});

for (const theme of ["dark", "light"]) {
  test(`ambient frame follows the desktop instead of enclosing black bars in ${theme}`, async ({ page }) => {
    await page.getByRole("switch", { name: "演示动效" }).uncheck();
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle("dark", theme === "dark");
    }, theme);
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 960; canvas.height = 540;
      const ctx = canvas.getContext("2d")!;
      const sky = ctx.createLinearGradient(0, 0, 960, 540);
      sky.addColorStop(0, "#5b919d"); sky.addColorStop(.55, "#e2cfa6"); sky.addColorStop(1, "#5f805f");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, 960, 540);
      return canvas.toDataURL().split(",")[1];
    });
    await page.getByLabel("参考图片文件", { exact: true }).setInputFiles({ name: "ambient.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await expect(page.getByTestId("preview-wallpaper")).toHaveCSS("background-image", /data:image/);
    const holder = page.locator(".atmosphere-preview > .preview-stage-holder");
    const stage = page.locator(".atmosphere-preview .desktop-preview");
    for (const [width, height] of [[1440, 940], [1280, 720], [390, 740]]) {
      await page.setViewportSize({ width, height });
      await expect(stage).toHaveAttribute("data-ready", "true");
      await expect(holder).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(stage).toHaveCSS("border-radius", "14px");
      await expect.poll(async () => {
        const box = (await stage.boundingBox())!;
        return Math.abs(box.width / box.height - 16 / 9);
      }).toBeLessThan(.01);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole("button", { name: "场景收藏", exact: true })).toBeInViewport();
      await page.screenshot({ path: `artifacts/ambient-frame-${theme}-${width}.png` });
    }
    await page.getByRole("button", { name: "放大画面", exact: true }).click();
    await expect(page.locator(".atmosphere-preview-dialog .desktop-preview")).toHaveCSS("border-radius", "14px");
  });
}
