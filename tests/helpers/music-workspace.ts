import { expect, type Page } from "@playwright/test";
import { defaults } from "../../src/features/spectrum/model";
import { emptySnapshot } from "../../src/features/music/types";
import { railDefaults } from "../../src/features/rail/model";
import { emptyNowPlaying } from "../../src/features/desktop-card/use-now-playing";

export async function musicWorkspace(page: Page, theme = "dark") {
  await page.addInitScript(({ settings, music, rail, info, theme }) => {
    const app = window as any;
    app.isTauri = true;
    localStorage.setItem("soundspectra.theme", theme);
    app.__commands = [];
    app.__music = music;
    app.__browse = null;
    const cover = (a: string, b: string) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><path fill="url(#g)" d="M0 0h240v240H0z"/><circle fill="white" opacity=".15" cx="130" cy="90" r="65"/><path fill="white" opacity=".15" d="M0 185 90 100 240 205v35H0z"/></svg>`);
    const names = ["雨后散步", "傍晚的窗边", "山间来信", "深夜电台", "旧时光", "城市漫游"];
    app.__lists = names.map((name, i) => ({ id: String(i), name, cover: cover(["#355c67", "#4c526b", "#807566"][i % 3], ["#b8a8a0", "#a8917d", "#65959b"][i % 3]), count: 24 }));
    app.__tracks = Array.from({ length: 24 }, (_, i) => ({ id: String(i), provider: "qq", title: ["路过人间", "晚风中的一封信", "沿着海岸慢慢走，直到这一首歌唱完", "山的另一边", "明天见", "在夜色里出发"][i % 6], artist: ["陈粒", "房东的猫", "旅行团"][i % 3], album: "午后慢慢听", cover: app.__lists[i % 6].cover, duration: 218 + i, paid: i === 4 }));
    music.account = { provider: "qq", nickname: "评估示例账号", avatar: null, membership: { active: true, name: "SVIP", level: 8, expires: null }, membershipIssue: null };
    music.providers = [{ id: "qq", name: "QQ 音乐", capabilities: ["qr-login", "playlists", "search", "playback", "lyrics"] }];
    Object.assign(music.playback, { queue: app.__tracks.slice(0, 3), phase: "paused", duration: 218, position: 11, canNext: true, canPrevious: true, queueRevision: 1 });
    app.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "settings" }, currentWebview: { label: "settings" } },
      transformCallback: () => 1, unregisterCallback() {},
      invoke: async (command: string, args: any = {}) => {
        switch (command) {
          case "get_settings": return settings;
          case "update_settings": if (app.__settingsWriteError) throw new Error("测试保存失败"); return args.settings;
          case "get_status": return { state: music.playback.playing ? "listening" : "silent", message: "", editing: false, desktopAttached: false, processId: 1 };
          case "get_now_playing": return { ...info, ...music.playback.queue[music.playback.index], playing: music.playback.playing, updated: Date.now(), source: "SoundSpectra" };
          case "music_snapshot": return structuredClone(music);
          case "music_browse": if (args.value) app.__browse = args.value; return app.__browse;
          case "music_playlists": return { items: app.__lists, total: app.__lists.length, nextOffset: null, filtered: 0 };
          case "music_tracks":
            app.__commands.push({ command, ...args });
            if (app.__trackError) throw new Error("测试曲库暂不可用");
            return { items: app.__tracks, total: app.__tracks.length, nextOffset: null, filtered: 0 };
          case "music_library_data": return { items: app.__tracks, total: app.__tracks.length, synced: app.__tracks.length, complete: !app.__incomplete, updated: Date.now(), nextOffset: app.__incomplete ? 0 : null };
          case "music_search": {
            const items = app.__tracks.filter((t: any) => t.title.includes(args.query));
            return { items, total: items.length, nextOffset: null, filtered: 0 };
          }
          case "music_play": app.__commands.push({ command, ...args }); music.playback.queue = args.ids.map((id: string) => app.__tracks.find((t: any) => `qq:${t.id}` === id)); music.playback.index = args.index; music.playback.playing = true; music.playback.phase = "playing"; return;
          case "music_control": app.__commands.push({ command, ...args }); music.playback.playing = args.action === "play"; music.playback.phase = music.playback.playing ? "playing" : "paused"; return;
          case "music_artwork": return args.url;
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
  }, { settings: { ...defaults, enabled: false, quality: "eco", followCover: false }, music: structuredClone(emptySnapshot), rail: railDefaults, info: emptyNowPlaying, theme });
  await page.goto("/#music");
  await expect(page.locator(".studio-shell")).not.toHaveAttribute("inert", "", { timeout: 30000 });
  await expect(page.locator(".library-playlist").first()).toBeVisible();
}
