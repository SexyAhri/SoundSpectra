export interface Membership {
  active: boolean;
  name: string;
  level: number;
  expires: string | null;
}
export interface Account {
  provider: string;
  nickname: string;
  avatar: string | null;
  membership: Membership | null;
  membershipIssue: string | null;
}
export interface Playlist {
  id: string;
  name: string;
  cover: string | null;
  count: number;
}
export interface Track {
  id: string;
  provider: string;
  title: string;
  artist: string;
  album: string;
  cover: string | null;
  duration: number;
  paid: boolean;
}
export interface Page<T> {
  items: T[];
  total: number;
  nextOffset: number | null;
  filtered: number;
}
export interface Playback {
  generation: number;
  revision: number;
  seekRevision: number;
  queue: Track[];
  entryIds?: string[];
  queueRevision?: number;
  queueUnchanged?: boolean;
  lyricOffset?: number;
  globalLyricOffset?: number;
  sleepAt?: number | null;
  sleepAfterTrack?: boolean;
  failure?: { kind: string; retryable: boolean; loginRequired: boolean } | null;
  index: number;
  phase: string;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  error: string | null;
  quality: AudioQuality | null;
  mode: "sequence" | "loop" | "single" | "shuffle";
  muted: boolean;
  canPrevious: boolean;
  canNext: boolean;
  suspended: boolean;
  loadStage: string;
  buffered: [number, number][];
  seeking: boolean;
  transfer: {
    received: number;
    total: number;
    status: "downloading" | "complete" | "cached" | "failed";
  } | null;
}
export interface AudioQuality {
  id: string;
  label: string;
  codec: string;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  bitrate: number | null;
  fallback: string | null;
}
export interface MusicSnapshot {
  libraryKey?: string | null;
  account: Account | null;
  login: { phase: string; qr: string | null; message: string };
  playback: Playback;
  providers: { id: string; name: string; capabilities: string[] }[];
}
export const emptySnapshot: MusicSnapshot = {
  account: null,
  login: { phase: "", qr: null, message: "" },
  playback: {
    generation: 0,
    revision: 0,
    seekRevision: 0,
    queue: [],
    index: 0,
    phase: "idle",
    playing: false,
    position: 0,
    duration: 0,
    volume: 0.7,
    error: null,
    quality: null,
    mode: "sequence",
    muted: false,
    canPrevious: false,
    canNext: false,
    suspended: false,
    loadStage: "",
    buffered: [],
    seeking: false,
    transfer: null,
  },
  providers: [],
};
export const trackKey = (track: Track) => `${track.provider}:${track.id}`;
export function clock(value: number) {
  const n = Math.floor(Math.max(0, Number.isFinite(value) ? value : 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

export interface MusicPreferences {
  cacheGib: number;
  normalize: boolean;
}
export interface CacheStats {
  audioBytes: number;
  lyricBytes: number;
  limitBytes: number;
  pending: number;
}
export interface IndexedPage {
  nextOffset?: number | null;
  items: Track[];
  total: number;
  synced: number;
  complete: boolean;
  updated: number;
}
export type QueueEdit =
  | { action: "append"; ids: string[]; next: boolean }
  | { action: "reorder" | "remove"; entries: string[] }
  | { action: "clear-played" };

export interface BrowseState {
  collection: string;
  selected: Playlist | null;
  query: string;
  sort: string;
  top: number;
}
