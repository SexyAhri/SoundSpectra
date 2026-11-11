import { expect, test } from "@playwright/test";
import { defaults } from "../src/features/spectrum/model";
import { emptySnapshot } from "../src/features/music/types";
import { railDefaults } from "../src/features/rail/model";
import { emptyNowPlaying } from "../src/features/desktop-card/use-now-playing";

for (const width of [1440, 1000]) {
for (const suspended of [false, true]) test(`dock ${suspended ? "resume" : "play and pause"} preserves preview geometry at ${width}px`, async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width, height: 940 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(({ settings, music, rail, info, suspended }) => {
    const app = window as any;
    app.isTauri = true;
    app.__music = music;
    app.__startupFrames = [];
    const observeStartup = () => {
      const r = document.querySelector('.desktop-preview[data-ready=true]')?.getBoundingClientRect();
      if (r) {
        app.__firstPreviewAt ??= performance.now();
        app.__startupFrames.push({ y: r.y, height: r.height });
      }
      if (!app.__firstPreviewAt || performance.now() - app.__firstPreviewAt < 500)
        requestAnimationFrame(observeStartup);
    };
    requestAnimationFrame(observeStartup);
    music.playback.queue = [{ id: "test", provider: "qq", title: "测试歌曲", artist: "测试歌手", album: "", cover: null, duration: 249, paid: false }];
    Object.assign(music.playback, { index: 0, phase: suspended ? "suspended" : "paused", suspended, duration: 249, position: 11, queueRevision: 1 });
    app.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "settings" }, currentWebview: { label: "settings" } },
      transformCallback: () => 1, unregisterCallback() {},
      invoke: async (command: string, args: any = {}) => {
        switch (command) {
          case "get_settings": return settings;
          case "update_settings": return args.settings;
          case "get_status": return { state: music.playback.playing ? "listening" : "silent", message: "", editing: false, desktopAttached: false, processId: 1 };
          case "get_now_playing": app.__observedPlaying = music.playback.playing; return { ...info, title: "测试歌曲", artist: "测试歌手", source: music.playback.suspended ? "酷狗音乐" : "SoundSpectra · QQ 音乐", playing: music.playback.playing, position: 11, duration: 249, updated: Date.now() };
          case "music_snapshot":
            if (!app.__snapshotAt) {
              await new Promise(resolve => setTimeout(resolve, suspended ? 0 : 1000));
              app.__snapshotAt = performance.now();
            }
            return structuredClone(music);
          case "music_control": music.playback.playing = args.action === "play"; music.playback.suspended = false; music.playback.phase = music.playback.playing ? "playing" : "paused"; return;
          case "rail_get": return { settings: rail, missing: [], desktopError: null, supported: true };
          case "get_audio_sources": return { selection: { mode: "auto" }, error: null, catalog: [], discovery: { targets: [], warning: null } };
          case "get_desktop_background":
            app.__backgroundPending = true;
            if (app.__backgroundDelay) await new Promise(resolve => setTimeout(resolve, app.__backgroundDelay));
            app.__backgroundPending = false;
            app.__backgroundReads = (app.__backgroundReads ?? 0) + 1;
            app.__backgroundRevision = args.knownRevision;
            return { screen: { x: 0, y: 0, width: 2560, height: 1440 }, virtualScreen: { x: 0, y: 0, width: 2560, height: 1440 }, position: "fill", color: "#25232c", image: null, revision: "solid", issue: null };
          case "application_info": return { version: "1.1.14", repository: "SexyAhri/SoundSpectra", updaterConfigured: false, development: true };
          case "get_preferences": return { closeToTray: true, autoCheckUpdates: false, autoInstallUpdates: false, showUpdateButton: false };
          case "plugin:event|listen": return 1;
          case "plugin:event|unlisten": case "plugin:event|emit": case "sync_scene_shortcuts": return;
          case "plugin:window|is_maximized": case "plugin:autostart|is_enabled": return false;
          default: throw new Error(`未声明测试 IPC: ${command}`);
        }
      },
    };
  }, { settings: { ...defaults, enabled: false, quality: "eco", followCover: false, lyrics: { ...defaults.lyrics, enabled: false } }, music: structuredClone(emptySnapshot), rail: railDefaults, info: emptyNowPlaying, suspended });
  await page.goto("/#scene");
  const dock = page.getByLabel("全局音乐控制", { exact: true });
  await expect(dock.getByRole("button", { name: "播放", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__observedPlaying)).toBe(false);
  await expect(page.locator(".section-toolbar")).not.toContainText("SoundSpectra · QQ 音乐");
  await page.evaluate(() => document.fonts.ready);
  // Wait for the initial ResizeObserver fit before measuring playback changes.
  await expect.poll(() => page.evaluate(() => {
    const holder = document.querySelector<HTMLElement>(".preview-stage-holder")!;
    const preview = document.querySelector(".desktop-preview")!.getBoundingClientRect();
    return preview.height <= holder.clientHeight && preview.width <= holder.clientWidth;
  })).toBe(true);
  await page.evaluate(() => {
    const app = window as any;
    const selectors = [".desktop-preview", ".preview-stage-holder", ".preview-section", ".section-toolbar", ".music-global-dock"];
    const measure = () => selectors.map(selector => {
      const node = document.querySelector(selector)!;
      const r = node.getBoundingClientRect();
      return { selector, x: r.x, y: r.y, width: r.width, height: r.height, scroll: node.scrollTop };
    });
    app.__baseline = measure(); app.__jumps = [];
    app.__observe = true;
    const tick = () => {
      if (!app.__observe) return;
      const next = measure();
      if (JSON.stringify(next) !== JSON.stringify(app.__baseline) && app.__jumps.length < 3) app.__jumps.push(next);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  for (let cycle = 0; cycle < 2; cycle++) {
    await dock.getByRole("button", { name: "播放", exact: true }).hover();
    await page.waitForTimeout(500);
    await dock.getByRole("button", { name: "播放", exact: true }).click();
    await expect(dock.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__observedPlaying)).toBe(true);
    await dock.getByRole("button", { name: "暂停", exact: true }).click();
    await expect(dock.getByRole("button", { name: "播放", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__observedPlaying)).toBe(false);
  }
  const result = await page.evaluate(() => {
    const app = window as any; app.__observe = false;
    return { baseline: app.__baseline, jumps: app.__jumps };
  });
  expect(result.jumps, JSON.stringify(result)).toEqual([]);
  const startup = await page.evaluate(() => {
    const frames = (window as any).__startupFrames;
    return frames as { y: number; height: number }[];
  });
  expect(startup.length).toBeGreaterThan(1);
  for (const key of ["y", "height"] as const)
    expect(Math.max(...startup.map(r => r[key])) - Math.min(...startup.map(r => r[key])), `startup preview ${key}`).toBeLessThanOrEqual(1);

  // Returning from the library remounts the preview and reads the wallpaper.
  // A temporary in-flow loading label must not move the preview after it fades in.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator(".workspace-nav").getByRole("button", { name: "音乐库", exact: true }).click();
  await expect(page.locator(".desktop-preview")).toHaveCount(0);
  await page.evaluate(() => {
    const app = window as any;
    app.__backgroundDelay = 1000;
    app.__backgroundReadsBeforeReturn = app.__backgroundReads;
    app.__returnFrames = [];
    app.__watchReturn = true;
    const tick = () => {
      if (!app.__watchReturn) return;
      const preview = document.querySelector('.desktop-preview[data-ready=true]');
      if (preview) {
        const r = preview.getBoundingClientRect();
        app.__returnFrames.push({ x: r.x, y: r.y, width: r.width, height: r.height });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole("button", { name: "编辑场景", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const app = window as any;
    return app.__backgroundReads > app.__backgroundReadsBeforeReturn;
  })).toBe(true);
  expect(await page.evaluate(() => (window as any).__backgroundRevision)).toBe("solid");
  await page.waitForTimeout(150);
  const frames = await page.evaluate(() => {
    const app = window as any;
    app.__watchReturn = false;
    return app.__returnFrames as { x: number; y: number; width: number; height: number }[];
  });
  expect(frames.length).toBeGreaterThan(2);
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.max(...frames.map(r => r[key])) - Math.min(...frames.map(r => r[key])), `return preview ${key}`).toBeLessThanOrEqual(1);
  }
});
}
