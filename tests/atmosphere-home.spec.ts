import { expect, test } from "@playwright/test";
import { defaults } from "../src/features/spectrum/model";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((settings) => {
    if (!localStorage.getItem("soundspectra.settings.v1"))
      localStorage.setItem("soundspectra.settings.v1", JSON.stringify(settings));
  }, { ...defaults, quality: "eco" });
});

test("home shows an honest demo, and editing, history and music preserve the scene", async ({ page }) => {
  await page.goto("/");
  const home = page.getByRole("region", { name: "氛围画面", exact: true });
  await expect(home).toBeVisible();
  await expect(page.getByRole("complementary", { name: "对象属性" })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "演示动效" })).toBeChecked();
  await expect(home.locator(".atmosphere-status")).toContainText("演示画面");
  const saved = await page.evaluate(() => localStorage.getItem("soundspectra.settings.v1"));
  await page.getByRole("switch", { name: "演示动效" }).uncheck();
  await page.getByRole("button", { name: "编辑场景", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "对象属性" })).toBeVisible();
  await page.getByRole("button", { name: "布置", exact: true }).click();
  await page.getByRole("button", { name: "返回氛围" }).click();
  await expect(home).toBeVisible();
  await expect(page.locator(".desktop-preview.arranging")).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "演示动效" })).not.toBeChecked();
  await page.goBack();
  await expect(page.getByRole("complementary", { name: "对象属性" })).toBeVisible();
  await page.goForward();
  await expect(home).toBeVisible();
  await page.getByRole("button", { name: "音乐库", exact: true }).click();
  await expect(page.getByRole("region", { name: "音乐库", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回氛围" }).click();
  await expect(home).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("soundspectra.settings.v1"))).toBe(saved);
  await page.reload();
  await expect(home).toBeVisible();
});

test("scene collection, expanded viewing and quick controls are reachable from home", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("switch", { name: "演示动效" }).uncheck();
  await page.getByRole("button", { name: "场景收藏", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "场景收藏", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "放大画面", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "布置", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".atmosphere-output > summary")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "音乐来源" })).toBeVisible();
  await page.getByRole("button", { name: "桌面与性能" }).click();
  await expect(page.getByRole("combobox", { name: "渲染性能" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "快捷控制", exact: true })).toBeVisible();
});

test("live audio takes priority over demo and connection errors remain visible", async ({ page }) => {
  await page.route("**/src/features/spectrum/bridge.ts*", async (route) => {
    if (route.request().url().includes("original")) return route.continue();
    await route.fulfill({ contentType: "text/javascript", body: `
      export * from '/src/features/spectrum/bridge.ts?original';
      import { browserStatus } from '/src/features/spectrum/model.ts';
      export async function getStatus() { return { ...browserStatus, state: window.audioTestState || 'idle' }; }
    ` });
  });
  await page.goto("/");
  const demo = page.getByRole("switch", { name: "演示动效" });
  await expect(demo).toBeChecked();
  await page.evaluate(() => { (window as any).audioTestState = "listening"; });
  await expect(demo).not.toBeChecked();
  await expect(demo).toBeDisabled();
  await expect(page.locator(".atmosphere-status")).toHaveText("正在随音乐响应");
  await page.evaluate(() => { (window as any).audioTestState = "error"; });
  await expect(page.locator(".atmosphere-status")).toContainText("演示画面 · 音源连接异常");
  await expect(demo).toBeEnabled();
});

for (const theme of ["dark", "light"] as const) {
  test(`atmosphere fits desktop and narrow windows in ${theme}`, async ({ page }) => {
    await page.addInitScript((theme) => localStorage.setItem("soundspectra.theme", theme), theme);
    await page.goto("/");
    await expect(page.getByRole("switch", { name: "演示动效" })).toBeChecked();
    await expect.poll(() => page.locator(".three-scene-surface canvas").first().getAttribute("data-frames"), { timeout: 15000 }).not.toBeNull();
    for (const [width, height] of [[1280, 720], [1000, 620], [390, 740]]) {
      await page.setViewportSize({ width, height });
      await expect(page.getByRole("button", { name: "编辑场景", exact: true })).toBeInViewport();
      await expect(page.getByRole("button", { name: "场景收藏", exact: true })).toBeInViewport();
      await expect(page.getByRole("button", { name: "应用设置与更新", exact: true })).toBeInViewport();
      await expect(page.getByRole("combobox", { name: "音乐来源" })).toBeInViewport();
      await expect(page.getByRole("button", { name: "桌面与性能" })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
      await page.screenshot({ path: `artifacts/atmosphere-${theme}-${width}.png` });
    }
  });
}

test("song details belong to the footer and retain long titles without crowding scene actions", async ({ page }) => {
  const title = 'The Courage To Love (Theme Song From "Divorce Lawyer")';
  await page.route("**/src/features/desktop-card/use-now-playing.ts*", async (route) => {
    if (route.request().url().includes("original")) return route.continue();
    await route.fulfill({ contentType: "text/javascript", body: `
      export * from '/src/features/desktop-card/use-now-playing.ts?original';
      import { emptyNowPlaying } from '/src/features/desktop-card/use-now-playing.ts?original';
      export function useNowPlaying() { return { ...emptyNowPlaying, title: ${JSON.stringify(title)}, artist: '曲婉婷' }; }
    ` });
  });
  await page.goto("/");
  await page.getByRole("switch", { name: "演示动效" }).uncheck();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 740 });
    const track = page.locator(".ambient-listening-title");
    await expect(track).toHaveAttribute("title", `${title} · 曲婉婷`);
    await expect(page.locator(".atmosphere-controls")).not.toContainText(title);
    await expect(track).toBeInViewport();
    await expect(page.getByRole("button", { name: "场景收藏", exact: true })).toBeInViewport();
    await expect.poll(() => page.locator(".atmosphere-controls").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect.poll(() => track.evaluate(el => {
      const title = el.querySelector('strong')!.getBoundingClientRect(), artist = el.querySelector('span')!.getBoundingClientRect();
      return title.right <= artist.left && Math.abs(title.bottom - artist.bottom) < 8;
    })).toBe(true);
    await page.screenshot({ path: `artifacts/atmosphere-track-${width}.png` });
    await page.locator(".atmosphere-controls").screenshot({ path: `artifacts/atmosphere-track-controls-${width}.png` });
  }
});
