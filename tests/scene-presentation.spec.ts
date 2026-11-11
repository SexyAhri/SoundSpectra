import { expect, test, type Page } from "@playwright/test";
import { defaults } from "../src/features/spectrum/model";
import { desktopLayout, desktopPresets, scenePatch } from "../src/features/preview/desktop-scenes";
import { sceneName, sceneStatus } from "../src/features/preview/scene-presentation";
import type { SavedScene } from "../src/features/preview/scene-library";

const quiet = { ...structuredClone(defaults), enabled: false, quality: "eco" as const,
  ...scenePatch(defaults, desktopPresets[2].scene) };
const saved = (name = "我的安静角落"): SavedScene => ({
  id: "my-quiet", name, wallpaper: null, updated: 1, scene: desktopLayout(quiet),
});
async function start(page: Page, items: SavedScene[] = [], recent = "quiet-mint") {
  await page.addInitScript(({ settings, items, recent }) => {
    if (!localStorage.getItem("soundspectra.settings.v1")) {
      localStorage.setItem("soundspectra.settings.v1", JSON.stringify(settings));
      localStorage.setItem("soundspectra.scene-library.v1", JSON.stringify(items));
      localStorage.setItem("soundspectra.scene-last-used.v1", JSON.stringify({ id: recent, name: "旧名称" }));
    }
  }, { settings: quiet, items, recent });
  await page.goto("/");
  await expect(page.locator(".startup-screen")).toHaveCount(0, { timeout: 10000 });
}

test("names follow the actual composition and only use matching recent identities", () => {
  expect(sceneName(quiet, [], "warm-sand")).toBe("清浅专注");
  expect(sceneName(quiet, [saved()], "my-quiet")).toBe("我的安静角落");
  expect(sceneName({ ...quiet, desktopCard: { ...quiet.desktopCard, variant: "record" } }, [saved()], "my-quiet")).toBe("自定义搭配");
  const privateSettings = { ...quiet, quality: "smooth" as const, enabled: true,
    lyrics: { ...quiet.lyrics, folder: "D:/private-lyrics", offsetMs: 500 } };
  expect(sceneName(privateSettings, [saved()], "my-quiet")).toBe("我的安静角落");
  const legacy = saved("旧版灯效");
  delete legacy.scene.desktop;
  expect(sceneName(quiet, [legacy], legacy.id)).toBe("清浅专注");
});

test("unmatched names describe complete compositions and visible secondary effects", () => {
  const plain = { ...structuredClone(defaults), desktopCard: { ...defaults.desktopCard, enabled: false },
    lyrics: { ...defaults.lyrics, enabled: false } };
  expect(sceneName(plain, [], null)).not.toBe("自定义搭配");
  expect(sceneName({ ...plain, regionVisible: false }, [], null)).toBe("我的场景");
  const primary = { ...plain, effect: "ripple" as const };
  const secondary = { ...plain, regionVisible: false, regions: [{
    ...primary, id: "secondary", name: "另一灯效", visible: true,
  }] };
  expect(sceneName(secondary, [], null)).toBe(sceneName(primary, [], null));
  expect(sceneName({ ...secondary, regionVisible: true }, [], null)).toBe("自定义搭配");
});

test("status describes intentional quiet modes and keeps audio errors visible", () => {
  expect(sceneStatus(quiet, true, false)).toBe("演示画面 · 音乐卡片模式");
  expect(sceneStatus(quiet, false, true)).toBe("音乐卡片模式");
  const lyrics = { ...quiet, lyrics: { ...quiet.lyrics, enabled: true } };
  expect(sceneStatus(lyrics, false, false)).toBe("卡片与歌词模式");
  const noCard = { ...lyrics, desktopCard: { ...lyrics.desktopCard, enabled: false } };
  expect(sceneStatus(noCard, false, false)).toBe("歌词模式");
  const hidden = { ...noCard, lyrics: { ...noCard.lyrics, enabled: false },
    wallpaperDepth: { ...noCard.wallpaperDepth, enabled: false, ambientEnabled: false } };
  expect(sceneStatus(hidden, false, false)).toContain("未开启显示内容");
  expect(sceneStatus({ ...hidden, wallpaperDepth: { ...hidden.wallpaperDepth, ambientEnabled: true } }, false, false)).toBe("壁纸氛围模式");
  expect(sceneStatus(quiet, true, false, "error")).toBe("演示画面 · 音源连接异常，请检查音源与桌面");
  expect(sceneStatus(defaults, false, true)).toBe("正在随音乐响应");
  expect(sceneStatus(defaults, false, false)).toBe("等待音乐播放");
  expect(sceneStatus(defaults, true, false)).toContain("演示画面");
});

test("home identifies quiet scenes through demo, apply, undo and reload", async ({ page }) => {
  await start(page);
  const name = page.locator(".atmosphere-scene-name");
  await expect(name).toHaveText("清浅专注");
  await expect(page.locator(".atmosphere-status")).toHaveText("演示画面 · 音乐卡片模式");
  const settings = await page.evaluate(() => localStorage.getItem("soundspectra.settings.v1"));
  await page.getByRole("switch", { name: "演示动效" }).uncheck();
  await expect(page.locator(".atmosphere-status")).toHaveText("音乐卡片模式");
  expect(await page.evaluate(() => localStorage.getItem("soundspectra.settings.v1"))).toBe(settings);
  await page.getByRole("button", { name: "场景收藏", exact: true }).click();
  await page.getByRole("button", { name: /暖砂日常/ }).click();
  await page.getByRole("button", { name: "应用此场景", exact: true }).click();
  await expect(name).toHaveText("暖砂日常");
  await page.getByRole("button", { name: "撤销搭配" }).click();
  await expect(name).toHaveText("清浅专注");
  await page.reload();
  await expect(name).toHaveText("清浅专注");
});

test("identical saved scenes update their name on apply, rename and deletion", async ({ page }) => {
  await start(page, [saved()]);
  const name = page.locator(".atmosphere-scene-name");
  await expect(name).toHaveText("清浅专注");
  await page.getByRole("button", { name: "场景收藏", exact: true }).click();
  await page.getByRole("button", { name: "我的收藏", exact: true }).click();
  await page.getByRole("button", { name: /我的安静角落/ }).click();
  await page.getByRole("button", { name: "应用此场景", exact: true }).click();
  await expect(name).toHaveText("我的安静角落");
  await page.reload();
  await expect(name).toHaveText("我的安静角落");
  await page.evaluate(() => {
    const items = JSON.parse(localStorage.getItem("soundspectra.scene-library.v1")!);
    items[0].name = "改名后的角落";
    localStorage.setItem("soundspectra.scene-library.v1", JSON.stringify(items));
    window.dispatchEvent(new Event("scene-library-changed"));
  });
  await expect(name).toHaveText("改名后的角落");
  await page.evaluate(() => {
    localStorage.setItem("soundspectra.scene-library.v1", "[]");
    window.dispatchEvent(new StorageEvent("storage", { key: "soundspectra.scene-library.v1" }));
  });
  await expect(name).toHaveText("清浅专注");
  await page.evaluate(() => {
    localStorage.setItem("soundspectra.scene-library.v1", "broken");
    localStorage.setItem("soundspectra.scene-last-used.v1", "broken");
  });
  await page.reload();
  await expect(name).toHaveText("清浅专注");
});

for (const theme of ["dark", "light"]) {
  test(`long saved scene names wrap within the home controls in ${theme}`, async ({ page }) => {
    const longName = "夜晚听歌时让房间安静下来的温柔角落".repeat(3).slice(0, 40);
    await page.addInitScript(theme => localStorage.setItem("soundspectra.theme", theme), theme);
    await start(page, [saved(longName)], "my-quiet");
    await expect(page.locator(".atmosphere-scene-name")).toHaveText(longName);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 740 });
      await expect(page.getByRole("button", { name: "场景收藏", exact: true })).toBeInViewport();
      await expect(page.locator(".atmosphere-status")).toBeInViewport();
      expect(await page.locator(".atmosphere-controls").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `artifacts/scene-presentation-${theme}-${width}.png` });
    }
  });
}
