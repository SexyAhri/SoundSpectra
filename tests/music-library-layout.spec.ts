import { expect, test } from "@playwright/test";
import { musicWorkspace } from "./helpers/music-workspace";

for (const theme of ["dark", "light"]) test(`library gives songs room and keeps navigation reachable in ${theme}`, async ({ page }) => {
  test.setTimeout(90000);
  await musicWorkspace(page, theme);
  await expect(page.getByRole("complementary", { name: "主导航" })).toHaveCount(0);
  await expect(page.locator(".save-status")).toBeHidden();
  await page.screenshot({ path: `artifacts/music-layout-collections-${theme}.png` });
  await page.locator(".library-playlist").first().click();
  for (const [width, height] of [[1280, 840], [1000, 620], [900, 620], [390, 740]]) {
    await page.setViewportSize({ width, height });
    const first = page.locator(".library-track-row").first();
    await expect(first).toBeVisible();
    await expect(page.getByRole("button", { name: "返回氛围", exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "编辑场景", exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "播放已加载歌曲" })).toBeInViewport();
    await expect(page.getByRole("combobox", { name: "音乐来源" })).toBeInViewport();
    const playerBox = await page.locator(".library-player").boundingBox();
    expect(playerBox!.x).toBeGreaterThanOrEqual(0);
    expect(playerBox!.x + playerBox!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    if (width >= 900) {
      const firstBox = await first.boundingBox(), player = await page.locator(".library-player").boundingBox();
      expect(firstBox!.y).toBeLessThan(270);
      expect(player!.y - firstBox!.y).toBeGreaterThanOrEqual(65 * 3);
    }
    await page.getByRole("button", { name: "列表选项", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "歌曲排序" })).toBeInViewport();
    await expect(page.getByRole("combobox", { name: "列表密度" })).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "列表选项", exact: true })).toBeFocused();
    await page.locator(".library-collection-copy h3").click();
    await page.mouse.move(5, 5);
    await page.screenshot({ path: `artifacts/music-layout-${theme}-${width}.png` });
  }
});

test("view options preserve sorting, density, search, playback and return state", async ({ page }) => {
  test.setTimeout(90000);
  await musicWorkspace(page);
  await page.locator(".library-playlist").first().click();
  await page.getByRole("button", { name: "列表选项", exact: true }).click();
  await page.getByRole("combobox", { name: "歌曲排序" }).click();
  await page.getByRole("option", { name: "时长", exact: true }).click();
  await page.getByRole("combobox", { name: "列表密度" }).click();
  await page.getByRole("option", { name: "紧凑", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".library-track-row").first()).toHaveAttribute("data-density", "compact");
  await page.getByRole("button", { name: "播放已加载歌曲" }).click();
  await expect(page.locator(".library-player").getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "播放队列", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "播放队列面板" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("searchbox", { name: "搜索已同步歌曲" }).fill("晚风");
  await expect(page.locator(".library-match-count")).toHaveText("匹配 4 首");
  await page.getByRole("button", { name: "返回氛围", exact: true }).click();
  await expect(page.locator(".ambient-listening-title")).toContainText("路过人间");
  await page.getByRole("button", { name: "音乐库", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "搜索已同步歌曲" })).toHaveValue("晚风");
  await page.getByRole("button", { name: "编辑场景", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "主导航" })).toBeVisible();
  await page.locator(".workspace-nav").getByRole("button", { name: "音乐库", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "搜索已同步歌曲" })).toHaveValue("晚风");
  await page.getByRole("button", { name: "列表选项", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "列表密度" })).toContainText("紧凑");
  await page.getByRole("button", { name: "刷新歌曲", exact: true }).click();
});

test("library keeps scene save failures visible while normal status stays quiet", async ({ page }) => {
  await musicWorkspace(page);
  await page.getByRole("button", { name: "编辑场景", exact: true }).click();
  await page.evaluate(() => { (window as any).__settingsWriteError = true; });
  await page.getByRole("combobox", { name: "渲染性能", exact: true }).click();
  await page.getByRole("option", { name: "均衡 · 60 帧", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("保存失败");
  await page.locator(".workspace-nav").getByRole("button", { name: "音乐库", exact: true }).click();
  await expect(page.locator(".save-status")).toBeVisible();
  await expect(page.locator(".save-status")).toContainText("保存失败");
});
