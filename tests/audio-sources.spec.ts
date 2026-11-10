import { settingsSection } from "./helpers/module-settings";
import { test, expect, type Page } from "@playwright/test";

const sourceKey = "soundspectra.audio-source.v1";
const selector = (page: Page) =>
  page.getByRole("combobox", { name: "音乐来源", exact: true });

test("removed player selection migrates to auto and the menu lists the four supported players", async ({
  page,
}) => {
  await page.addInitScript(
    (key) =>
      localStorage.setItem(key, JSON.stringify({ mode: "player", id: "kuwo" })),
    sourceKey,
  );
  await page.goto("/");
  await expect(selector(page)).toHaveText("自动识别");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await selector(page).click();
  await expect(page.getByRole("option")).toHaveCount(5);
  await expect(
    page.getByRole("option", { name: "酷我音乐", exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("option", { name: "酷狗音乐", exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "汽水音乐", exact: false }),
  ).toBeVisible();
});

test("browser source persists independently of appearance and reports preview only", async ({
  page,
}) => {
  await page.goto("/");
  await selector(page).click();
  await page.getByRole("option", { name: "网易云音乐", exact: false }).click();
  await expect(selector(page)).toHaveText("网易云音乐");
  await selector(page).hover();
  await expect(page.getByRole("tooltip")).toContainText("仅预览设置");
  await page.mouse.move(0, 0);
  await settingsSection(page, "外观");
  await page.getByRole("slider", { name: "不透明度", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("已保存到此浏览器")).toBeVisible();
  await page.reload();
  await expect(selector(page)).toHaveText("网易云音乐");
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      sourceKey,
    ),
  ).toEqual({ mode: "player", id: "netease" });
  await selector(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("option", { name: "自动识别", exact: false }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(selector(page)).toHaveText("自动识别");
  await expect(selector(page)).toBeFocused();
  await page.screenshot({ path: "artifacts/audio-sources-desktop.png" });
});

test("corrupt source is preserved until explicit backup and recovery", async ({
  page,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, "broken source"),
    sourceKey,
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("音源设置读取失败");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), sourceKey),
  ).toBe("broken source");
  await page.getByRole("button", { name: "备份并使用自动识别" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const storage = await page.evaluate(
    (key) => ({
      saved: localStorage.getItem(key),
      backups: Object.keys(localStorage)
        .filter((k) => k.startsWith(`${key}.backup.`))
        .map((k) => localStorage.getItem(k)),
    }),
    sourceKey,
  );
  expect(JSON.parse(storage.saved!)).toEqual({ mode: "auto" });
  expect(storage.backups).toEqual(["broken source"]);
});

async function nativeFixture(page: Page, failFirst = false) {
  await page.addInitScript(
    ({ failFirst }) => {
      const app = window as any;
      app.isTauri = true;
      app.__source = { mode: "auto" };
      app.__sourceSaves = [];
      app.__holdRead = false;
      let failures = failFirst ? 1 : 0;
      app.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      app.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "settings" },
          currentWebview: { label: "settings" },
        },
        transformCallback: () => 1,
        unregisterCallback() {},
        invoke: async (command: string, args: any = {}) => {
          switch (command) {
            case "get_audio_sources": {
              const result = {
                selection: app.__source,
                error: null,
                kugouSync: app.__kugouSync,
                catalog: [
                  { id: "qqmusic", name: "QQ 音乐" },
                  { id: "netease", name: "网易云音乐" },
                ],
                discovery: {
                  warning: null,
                  targets: [
                    {
                      pid: 10,
                      executable: "QQMusic.exe",
                      name: "QQ 音乐",
                      playerId: "qqmusic",
                      audible: true,
                    },
                    {
                      pid: 20,
                      executable: "OtherMusic.exe",
                      name: "OtherMusic.exe",
                      playerId: null,
                      audible: true,
                    },
                    ...(app.__extraTargets ?? []),
                  ],
                },
              };
              if (app.__holdRead) {
                app.__holdRead = false;
                return new Promise((resolve) => {
                  app.__releaseRead = () => resolve(result);
                });
              }
              return result;
            }
            case "set_audio_source":
              app.__sourceSaves.push(args.selection);
              await new Promise((resolve) => setTimeout(resolve, 350));
              if (failures-- > 0) throw new Error("测试磁盘写入失败");
              app.__source = args.selection;
              return args.selection;
            case "get_status":
              return (
                app.__status ?? {
                  state: "listening",
                  message: "QQ 音乐 · 正在采集专属音频",
                  sourceName: "QQ 音乐",
                  processId: 10,
                  editing: false,
                  desktopAttached: false,
                }
              );
            case "get_settings":
              return {
                version: 1,
                enabled: false,
                color: "#d4c3ff",
                opacity: 85,
                sensitivity: 100,
                decay: 65,
                reflection: 32,
                glow: 35,
                bounds: { x: 0.12, y: 0.7, width: 0.76, height: 0.22 },
              };
            case "get_desktop_background":
              return {
                screen: { x: 0, y: 0, width: 1920, height: 1080 },
                virtualScreen: { x: 0, y: 0, width: 1920, height: 1080 },
                position: "fill",
                color: "#25232c",
                image: null,
                revision: "solid",
                issue: null,
              };
            case "application_info":
              return {
                version: "0.1.0",
                repository: "SexyAhri/SoundSpectra",
                updaterConfigured: false,
                development: true,
              };
            case "get_preferences":
              return {
                closeToTray: true,
                autoCheckUpdates: false,
                showUpdateButton: true,
              };
            case "plugin:event|listen":
              return 1;
            case "plugin:autostart|is_enabled":
            case "plugin:window|is_maximized":
              return false;
            case "plugin:event|unlisten":
            case "plugin:event|emit":
            case "sync_scene_shortcuts":
              return;
            default:
              throw new Error(`Unexpected IPC: ${command}`);
          }
        },
      };
    },
    { failFirst },
  );
  await page.goto("/");
  await expect(selector(page)).toHaveText("自动识别");
}

test("native save failure keeps previous source and retry commits once ready", async ({
  page,
}) => {
  await nativeFixture(page, true);
  await expect(
    page.getByRole("status").filter({ hasText: "QQ 音乐 · 正在播放" }),
  ).toBeVisible();
  await selector(page).click();
  await page.getByRole("option", { name: "网易云音乐", exact: false }).click();
  await expect(selector(page)).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("测试磁盘写入失败");
  await expect(selector(page)).toHaveText("自动识别");
  await page.getByRole("button", { name: "重试音源" }).click();
  await expect(selector(page)).toHaveText("网易云音乐");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__sourceSaves)).toEqual([
    { mode: "player", id: "netease" },
    { mode: "player", id: "netease" },
  ]);
});

test("delayed discovery cannot undo a committed player; retired custom apps never enter the menu", async ({
  page,
}) => {
  await nativeFixture(page);
  await page.evaluate(() => {
    (window as any).__holdRead = true;
  });
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__releaseRead))
    .toBe(true);
  await selector(page).click();
  await expect(page.getByRole("option")).toHaveCount(5);
  await expect(
    page.getByRole("option", { name: "OtherMusic.exe", exact: false }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: "QQ 音乐", exact: false }).click();
  await expect(selector(page)).toHaveText("QQ 音乐");
  await page.evaluate(() => {
    (window as any).__releaseRead();
  });
  await expect(selector(page)).toHaveText("QQ 音乐");
  // Simulate a saved app that no longer has a Windows audio session.
  await page.evaluate(() => {
    (window as any).__source = {
      mode: "process",
      executable: "ClosedMusic.exe",
    };
  });
  await expect(selector(page)).toHaveText("自动识别");
  await selector(page).click();
  await expect(
    page.getByRole("option", { name: "ClosedMusic.exe", exact: false }),
  ).toHaveCount(0);
  await expect(page.getByRole("option")).toHaveCount(5);
});

test("source menu fits a narrow viewport with keyboard access", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await selector(page).scrollIntoViewIfNeeded();
  expect(
    await page
      .locator(".audio-source-panel")
      .evaluate((element) => getComputedStyle(element).display),
  ).toBe("grid");
  const choiceBox = (await selector(page).boundingBox())!;
  expect(choiceBox.width).toBeLessThanOrEqual(160);
  await selector(page).hover();
  await expect(page.getByRole("tooltip")).toContainText("仅预览设置");
  await page.mouse.move(0, 0);
  await selector(page).click();
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  const rect = await menu.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/audio-sources-mobile.png" });
  await page.keyboard.press("End");
  await expect(
    page.getByRole("option", { name: "汽水音乐", exact: false }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(selector(page)).toHaveText("汽水音乐");
});

test("KuGou sync stays in the compact source status for automatic and manual selection", async ({
  page,
}) => {
  await nativeFixture(page);
  const status = page.locator(".audio-source-panel .source-status");
  await page.evaluate(() => {
    const app = window as any;
    app.__status = {
      state: "listening",
      message: "酷狗音乐 · 正在采集专属音频",
      sourceName: "酷狗音乐",
      processId: 30,
      editing: false,
      desktopAttached: false,
    };
    app.__extraTargets = [
      {
        pid: 30,
        executable: "KuGou.exe",
        name: "酷狗音乐",
        playerId: "kugou",
        audible: true,
      },
    ];
    app.__kugouSync = {
      phase: "ready",
      message: "酷狗增强同步已连接，正在读取实时播放进度。",
    };
  });
  await expect(selector(page)).toHaveText("自动识别");
  await expect(status).toHaveText("酷狗音乐 · 增强同步");
  await expect(page.getByRole("button", { name: /启动酷狗/ })).toHaveCount(0);
  await expect(page.getByText(/本地进度约每 30 秒/)).toHaveCount(0);
  await selector(page).click();
  await page.getByRole("option", { name: "酷狗音乐", exact: false }).click();
  await page.evaluate(() => {
    const app = window as any;
    app.__status = {
      state: "connecting",
      message: "正在连接",
      sourceName: null,
      processId: null,
      editing: false,
      desktopAttached: false,
    };
    app.__kugouSync = {
      phase: "restarting",
      message: "正在重启酷狗以启用实时歌词同步…",
    };
  });
  await expect(selector(page)).toHaveText("酷狗音乐");
  await expect(status).toHaveText("酷狗音乐 · 正在重启以启用同步");
  await selector(page).hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "正在重启酷狗以启用实时歌词同步…",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await selector(page).scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/kugou-sync-compact.png" });
});
