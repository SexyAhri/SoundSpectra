import { invoke } from "@tauri-apps/api/core";
import type {
  MusicSnapshot,
  Page,
  Playlist,
  Track,
  IndexedPage,
  MusicPreferences,
  CacheStats,
  QueueEdit,
  BrowseState,
} from "./types";
import type { LyricDocument } from "../lyrics/model";
let providerId = "";
let accepted: Promise<unknown> = Promise.resolve();
const ordered = <T>(action: () => Promise<T>): Promise<T> => {
  const result = accepted.then(action, action);
  accepted = result.catch(() => {});
  return result;
};
export const setMusicProvider = (id: string) => {
  providerId = id;
};
const sourceChanged = () =>
  window.dispatchEvent(new Event("music-source-change"));
export const musicClient = {
  search: (query: string, offset = 0) =>
    invoke<Page<Track>>("music_search", { query, offset }),
  snapshot: (queueRevision?: number) =>
    invoke<MusicSnapshot>("music_snapshot", {
      queueRevision: queueRevision ?? null,
    }),
  browse: (value?: BrowseState) =>
    invoke<BrowseState | null>("music_browse", { value: value ?? null }),
  indexed: (playlist: string | null = null, recent = false) =>
    invoke<IndexedPage>("music_library_data", { playlist, recent }),
  preferences: (preferences?: MusicPreferences) =>
    invoke<MusicPreferences>("music_preferences", {
      preferences: preferences ?? null,
    }),
  cache: (clear?: "audio" | "lyrics") =>
    invoke<CacheStats>("music_cache", { clear: clear ?? null }),
  edit: (edit: QueueEdit) =>
    ordered(() => invoke<void>("music_queue_edit", { edit })),
  offset: (value: number) => invoke<number>("music_offset", { value }),
  diagnostics: () => invoke<unknown[]>("music_diagnostics"),
  artwork: (url: string, refresh = false) =>
    invoke<string | null>("music_artwork", { url, refresh }),
  login: (
    action: "start" | "cancel" | "official" | "logout" | "refresh-account",
  ) => invoke<void>("music_login", { action }),
  playlists: (collection: string, offset = 0) =>
    invoke<Page<Playlist>>("music_playlists", {
      provider: providerId,
      collection,
      offset,
      limit: 30,
    }),
  tracks: (playlist: string, offset = 0) =>
    invoke<Page<Track>>("music_tracks", {
      provider: providerId,
      playlist,
      offset,
      limit: 100,
    }),
  play: async (ids: string[], index: number) => {
    try {
      await ordered(() => invoke<void>("music_play", { ids, index }));
    } finally {
      sourceChanged();
    }
  },
  control: async (action: string, value?: number) => {
    try {
      await ordered(() =>
        invoke<void>("music_control", { action, value: value ?? null }),
      );
    } finally {
      if (
        [
          "stop",
          "clear",
          "play",
          "retry",
          "next",
          "previous",
          "queue-jump",
        ].includes(action)
      )
        sourceChanged();
    }
  },
  lyrics: (refresh = false) =>
    invoke<LyricDocument>("music_lyrics", { refresh }),
};
