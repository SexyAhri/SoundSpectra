import { expect, test, type Page } from "@playwright/test";
import { defaults } from "../src/features/spectrum/model";
import { emptySnapshot } from "../src/features/music/types";
import { railDefaults } from "../src/features/rail/model";
import { emptyNowPlaying } from "../src/features/desktop-card/use-now-playing";

async function boot(page: Page, source: "builtin" | "external" | "retained" | "standby" = "builtin") {
  await page.addInitScript(({ settings, music, rail, info, source }) => {
    const app = window as any;
    app.isTauri = true;
    app.__music = music;
    app.__commands = [];
    app.__externalPlaying = true;
    if (source !== "standby") music.playback.queue = ["长歌名测试：让音乐成为周围的一部分", "下一首测试歌曲"].map((title, i) => ({ id: String(i), provider: "qq", title, artist: "测试歌手", album: "", cover: null, duration: 249, paid: false }));
    Object.assign(music.playback, { phase: "paused", suspended: source === "external" || source === "retained", duration: 249, position: 11, canNext: true, canPrevious: true, queueRevision: 1 });
    app.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "settings" }, currentWebview: { label: "settings" } },
      transformCallback: () => 1, unregisterCallback() {},
      invoke: async (command: string, args: any = {}) => {
        switch (command) {
          case "get_settings": return settings;
          case "update_settings": return args.settings;
          case "get_status": return { state: music.playback.playing ? "listening" : "silent", message: "", editing: false, desktopAttached: false, processId: 1 };
          case "get_now_playing": return source === "external" ? { ...info, title: "外部音乐", artist: "外部歌手", source: "播放器", position: 11, duration: 249, timelineAvailable: true, playing: app.__externalPlaying, updated: Date.now(), sessionId: "session", trackId: "track", playbackAvailable: true, controls: { previous: false, next: true, play: true, pause: true } } : info;
          case "music_snapshot": return structuredClone(music);
          case "music_control": {
            app.__commands.push({ command, ...args });
            const p = music.playback;
            if (args.action === "seek") { p.position = args.value; p.seekRevision++; return; }
            if (args.action === "next") { p.index = 1; return; }
            if (args.action === "previous") { p.index = 0; return; }
            if (app.__fail) { p.phase = "error"; p.playing = false; p.error = "测试网络中断"; return; }
            p.playing = args.action !== "pause";
            p.phase = p.playing ? "playing" : "paused"; p.suspended = false; p.error = null;
            return;
          }
          case "control_card_media": app.__commands.push({ command, ...args }); app.__externalPlaying = args.action === "play"; return;
          case "rail_get": return { settings: rail, missing: [], desktopError: null, supported: true };
          case "get_audio_sources": return { selection: { mode: "auto" }, error: null, catalog: [], discovery: { targets: [], warning: null } };
          case "get_desktop_background": return { screen: { x: 0, y: 0, width: 2560, height: 1440 }, virtualScreen: { x: 0, y: 0, width: 2560, height: 1440 }, position: "fill", color: "#25232c", image: null, revision: "solid", issue: null };
          case "application_info": return { version: "1.1.14", repository: "SexyAhri/SoundSpectra", updaterConfigured: false, development: true };
          case "get_preferences": return { closeToTray: true, autoCheckUpdates: false, autoInstallUpdates: false, showUpdateButton: false };
          case "plugin:event|listen": return 1;
          case "plugin:event|unlisten": case "plugin:event|emit": case "sync_scene_shortcuts": return;
          case "plugin:window|is_maximized": case "plugin:autostart|is_enabled": return false;
          default: throw new Error(`未声明测试 IPC: ${command}`);
        }
      },
    };
  }, { settings: { ...defaults, enabled: false, quality: "eco", followCover: false }, music: structuredClone(emptySnapshot), rail: railDefaults, info: emptyNowPlaying, source });
  await page.goto("/");
  await expect(page.locator(".studio-shell")).not.toHaveAttribute("inert", "", { timeout: 30000 });
  await expect(page.locator(".ambient-listening")).toBeVisible();
}

test("home transport plays, seeks, skips, recovers errors and opens its queue", async ({ page }) => {
  test.setTimeout(90000);
  await boot(page);
  const footer = page.getByLabel("首页音乐控制", { exact: true });
  await expect(page.locator(".atmosphere-controls")).not.toContainText("长歌名测试");
  await footer.getByRole("button", { name: "播放", exact: true }).click();
  await expect(footer.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  await footer.getByRole("slider", { name: "播放进度" }).press("End");
  await expect.poll(() => page.evaluate(() => (window as any).__commands.some((c: any) => c.action === "seek" && c.value === 249))).toBe(true);
  await footer.getByRole("button", { name: "下一首", exact: true }).click();
  await expect(footer).toContainText("下一首测试歌曲");
  await footer.getByRole("button", { name: "暂停", exact: true }).click();
  await page.evaluate(() => { (window as any).__fail = true; });
  await footer.getByRole("button", { name: "播放", exact: true }).click();
  await expect(footer.getByRole("alert")).toHaveText("测试网络中断");
  await page.evaluate(() => { (window as any).__fail = false; });
  await footer.getByRole("button", { name: "播放", exact: true }).click();
  await expect(footer.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  await expect(footer.getByRole("alert")).toHaveCount(0);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => { document.documentElement.classList.toggle("dark", theme === "dark"); document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [1280, 1000, 390]) {
      await page.setViewportSize({ width, height: 740 });
      await expect(page.getByRole("combobox", { name: "音乐来源" })).toBeInViewport();
      await expect(page.getByRole("button", { name: "桌面与性能" })).toBeInViewport();
      await expect(footer.getByRole("button", { name: "暂停", exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
      await page.screenshot({ path: `artifacts/ambient-footer-${theme}-${width}.png` });
      await footer.getByRole("button", { name: "播放队列" }).click();
      const queue = page.getByRole("complementary", { name: "播放队列面板" });
      await expect(queue).toBeVisible();
      const box = await queue.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await expect(queue.getByRole("button", { name: "收起面板" })).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(queue).toHaveCount(0);
    }
  }
});

test("external controls keep the builtin queue suspended", async ({ page }) => {
  await boot(page, "external");
  const footer = page.getByLabel("首页音乐控制", { exact: true });
  await expect(footer).toHaveAttribute("data-source", "external");
  await expect(footer.getByRole("progressbar", { name: "外部播放进度" })).toBeVisible();
  await expect(footer.getByRole("slider")).toHaveCount(0);
  await expect(footer.getByRole("button", { name: "播放队列" })).toHaveCount(0);
  await expect(footer.getByRole("button", { name: "上一首" })).toHaveCount(0);
  await expect(footer.getByRole("button", { name: "下一首" })).toBeEnabled();
  await footer.getByRole("button", { name: "暂停", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__commands)).toEqual([{ command: "control_card_media", action: "pause", sessionId: "session", trackId: "track" }]);
  expect(await page.evaluate(() => (window as any).__music.playback.suspended)).toBe(true);
  await page.setViewportSize({ width: 390, height: 740 });
  await expect(footer).toBeInViewport();
  await page.screenshot({ path: "artifacts/ambient-footer-external-390.png" });
});

test("retained builtin playback resumes explicitly", async ({ page }) => {
  await boot(page, "retained");
  const footer = page.getByLabel("首页音乐控制", { exact: true });
  await expect(footer).toContainText("内置进度已保留");
  await expect(footer.getByRole("slider")).toBeDisabled();
  await footer.getByRole("button", { name: "播放", exact: true }).click();
  await expect(footer.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  await expect(footer.getByRole("slider")).toBeEnabled();
});

test("standby keeps the demo and direct settings without inactive playback controls", async ({ page }) => {
  await boot(page, "standby");
  const footer = page.getByLabel("首页音乐控制", { exact: true });
  await expect(footer).toContainText("音乐待机");
  await expect(footer.getByRole("group", { name: "播放控制" })).toHaveCount(0);
  await expect(footer.getByRole("slider")).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "演示动效" })).toBeChecked();
  await page.getByRole("button", { name: "桌面与性能" }).click();
  await expect(page.getByRole("combobox", { name: "渲染性能" })).toBeVisible();
});
