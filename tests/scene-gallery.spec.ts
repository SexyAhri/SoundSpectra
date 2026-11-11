import { expect, test, type Page } from "@playwright/test";
import { defaults } from "../src/features/spectrum/model";
import { desktopPresets, scenePatch } from "../src/features/preview/desktop-scenes";

const initial = { ...structuredClone(defaults), enabled: false, quality: "eco" as const };
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("soundspectra.settings.v1")!));
const open = async (page: Page) => {
  await page.getByRole("button", { name: "场景收藏", exact: true }).click();
  await expect(page.locator(".scene-gallery")).toBeVisible();
};
test.beforeEach(async ({ page }) => {
  await page.addInitScript((settings) => {
    if (!localStorage.getItem("soundspectra.settings.v1")) localStorage.setItem("soundspectra.settings.v1", JSON.stringify(settings));
  }, initial);
  await page.goto("/");
  await page.getByRole("switch", { name: "演示动效" }).uncheck();
});

test("home previews without saving, applies in place, and can undo", async ({ page }) => {
  await open(page);
  await expect(page.getByLabel("收藏名称")).toHaveCount(0);
  await page.getByRole("button", { name: /暮蓝听歌/ }).click();
  await expect(page.locator(".scene-preview-compare")).toContainText("预览 · 暮蓝听歌");
  expect(await saved(page)).toEqual(initial);
  await page.getByRole("button", { name: "对比当前搭配" }).click();
  await expect(page.locator(".scene-preview-compare")).toContainText("当前搭配");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "场景收藏", exact: true })).toBeFocused();
  expect(await saved(page)).toEqual(initial);
  await open(page);
  await page.getByRole("button", { name: /暮蓝听歌/ }).click();
  await page.getByRole("button", { name: "应用此场景", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => saved(page)).toEqual({ ...initial, ...scenePatch(initial, desktopPresets[1].scene) });
  await expect(page.getByRole("region", { name: "氛围画面", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "撤销搭配" }).click();
  await expect.poll(() => saved(page)).toEqual(initial);
});

test("empty collection leads to management and returns to the saved gallery", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "我的收藏", exact: true }).click();
  await page.getByRole("button", { name: "收藏当前搭配" }).click();
  await page.getByLabel("收藏名称").fill("夜晚的小房间");
  await page.getByRole("button", { name: "保存当前", exact: true }).click();
  await page.getByRole("button", { name: "返回选景" }).click();
  await expect(page.locator(".scene-gallery-card")).toContainText("夜晚的小房间");
  await page.getByRole("searchbox", { name: "搜索场景" }).fill("不存在");
  await expect(page.getByText("没有找到这个场景，试试其他名称。")).toBeVisible();
  await expect(page.getByRole("button", { name: "应用此场景", exact: true })).toBeDisabled();
  expect(await saved(page)).toEqual(initial);
});

test("corrupt collection can recover while presets remain usable", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("soundspectra.scene-library.v1", "broken"));
  await open(page);
  await expect(page.getByRole("alert")).toContainText("场景库读取失败");
  await page.getByRole("button", { name: /暮蓝听歌/ }).click();
  await expect(page.getByRole("button", { name: "应用此场景", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "管理收藏", exact: true }).click();
  await page.getByRole("button", { name: "备份并重建" }).click();
  await expect(page.getByRole("status")).toContainText("场景库已重建");
  await page.getByRole("button", { name: "返回选景" }).click();
  await expect(page.locator(".scene-gallery")).toBeVisible();
});

test("apply failure keeps the selected preview available for retry", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /暮蓝听歌/ }).click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).failGallerySave = true;
    Storage.prototype.setItem = function(key, value) {
      if (key === "soundspectra.settings.v1" && (window as any).failGallerySave) throw Error("选景保存失败");
      return original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "应用此场景", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("选景保存失败");
  expect(await saved(page)).toEqual(initial);
  await page.evaluate(() => { (window as any).failGallerySave = false; });
  await page.getByRole("button", { name: "应用此场景", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const theme of ["dark", "light"]) {
  test(`gallery fits desktop and narrow windows in ${theme}`, async ({ page }) => {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
    await open(page);
    await page.getByRole("button", { name: /暮蓝听歌/ }).click();
    for (const [width, height] of [[1280, 720], [1000, 620], [390, 700]]) {
      await page.setViewportSize({ width, height });
      await expect(page.getByRole("button", { name: "应用此场景", exact: true })).toBeInViewport();
      await expect(page.getByRole("button", { name: "管理收藏", exact: true })).toBeInViewport();
      expect(await page.getByRole("dialog").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await page.locator(".scene-gallery-card").last().scrollIntoViewIfNeeded();
      await expect(page.locator(".scene-gallery-card").last()).toBeInViewport();
      await page.screenshot({ path: `artifacts/scene-gallery-${theme}-${width}.png` });
    }
  });
}
