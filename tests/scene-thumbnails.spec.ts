import { expect, test, type Page } from "@playwright/test";
import { defaults } from "../src/features/spectrum/model";
import { desktopPresets } from "../src/features/preview/desktop-scenes";

async function openGallery(page: Page) {
  await page.goto("/");
  await page.getByRole("switch", { name: "演示动效" }).uncheck();
  await page.getByRole("button", { name: "场景收藏", exact: true }).click();
  await expect(page.locator(".scene-gallery")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((settings) => {
    localStorage.setItem("soundspectra.settings.v1", JSON.stringify(settings));
  }, { ...defaults, enabled: false, quality: "eco" });
});

test("featured thumbnails load complete static scenes with no live renderers", async ({ page }) => {
  await openGallery(page);
  const thumbnails = page.locator(".scene-gallery .scene-thumbnail");
  await expect(thumbnails).toHaveCount(3);
  await expect(page.locator(".scene-gallery [data-thumbnail=capture]")).toHaveCount(3);
  for (const image of await thumbnails.locator("img").all()) {
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth === 640 && node.naturalHeight === 360)).toBe(true);
  }
  await expect(thumbnails.locator("canvas")).toHaveCount(0);
  const box = await thumbnails.first().boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
});

test("saved scenes reuse captures only when all parameters match regardless of key order", async ({ page }) => {
  const scene = structuredClone(desktopPresets[0].scene);
  const reverse = (value: any): any => Array.isArray(value) ? value.map(reverse)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverse(item)])) : value;
  await page.addInitScript((scenes) => localStorage.setItem("soundspectra.scene-library.v1", JSON.stringify(scenes)), [
    { id: "same", name: "同一搭配", wallpaper: null, updated: 2, scene: reverse(scene) },
    { id: "edited", name: "修改配色", wallpaper: null, updated: 1, scene: { ...scene, color: "#ff4466" } },
  ]);
  await openGallery(page);
  await page.getByRole("button", { name: "我的收藏", exact: true }).click();
  await expect(page.getByRole("button", { name: /同一搭配/ }).locator("[data-thumbnail=capture]")).toHaveCount(1);
  const edited = page.getByRole("button", { name: /修改配色/ });
  await expect(edited.locator("[data-thumbnail=layout]")).toHaveCount(1);
  await expect(edited).toContainText("布局示意");
  await edited.click();
  await expect(page.locator(".scene-preview-compare")).toContainText("修改配色");
  await expect(page.getByRole("button", { name: "应用此场景", exact: true })).toBeEnabled();
});

test("unavailable static image falls back to a usable layout thumbnail", async ({ page }) => {
  await page.route(/warm-sand.*\.webp/, (route) => route.abort());
  await openGallery(page);
  const card = page.getByRole("button", { name: /暖砂日常/ });
  await expect(card.locator("[data-thumbnail=layout]")).toHaveCount(1);
  await expect(card).toContainText("布局示意");
  await card.click();
  await expect(page.locator(".scene-preview-compare")).toContainText("暖砂日常");
});
