import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { native } from "../spectrum/bridge";

export interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  cover: string | null;
  position: number;
  duration: number;
  playing: boolean;
  source: string;
  processId: number | null;
  updated: number;
  issue: string | null;
  timelineAvailable?: boolean;
  timelineSource?:
    | "kugou-checkpoint"
    | "kugou-native"
    | "player-accessibility"
    | "netease-events";
  timelineValidUntil?: number;
  trackId?: string;
  playbackAvailable?: boolean;
  sessionId?: string;
  controls?: {
    previous: boolean;
    next: boolean;
    play: boolean;
    pause: boolean;
  };
}
export const emptyNowPlaying: NowPlaying = {
  title: "",
  artist: "",
  album: "",
  cover: null,
  position: 0,
  duration: 0,
  playing: false,
  source: "",
  processId: null,
  updated: 0,
  issue: null,
};

const snapshotFields = [
  "title", "artist", "album", "cover", "position", "duration", "playing",
  "source", "processId", "updated", "issue", "timelineAvailable",
  "timelineSource", "timelineValidUntil", "trackId", "playbackAvailable", "sessionId",
] as const satisfies readonly (keyof NowPlaying)[];

function sameNowPlaying(previous: NowPlaying, next: NowPlaying) {
  if (!snapshotFields.every(field => Object.is(previous[field], next[field]))) return false;
  const a = previous.controls, b = next.controls;
  return a === b || Boolean(a && b && a.previous === b.previous &&
    a.next === b.next && a.play === b.play && a.pause === b.pause);
}

export function useNowPlaying(active = true, desktop = false) {
  const [value, setValue] = useState<NowPlaying>(emptyNowPlaying);
  const latest = useRef(value);
  useEffect(() => {
    if (!native || !active) return;
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    const publish = (next: NowPlaying) => {
      if (disposed || sameNowPlaying(latest.current, next)) return;
      latest.current = next;
      setValue(next);
    };
    const read = async () => {
      if (desktop || !document.hidden) {
        try {
          const next = await invoke<NowPlaying>("get_now_playing");
          publish(next);
        } catch {
          publish({ ...emptyNowPlaying, issue: "播放器媒体信息暂不可用" });
        }
      }
      if (!disposed) timer = setTimeout(read, 500);
    };
    void read();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [active, desktop]);
  return value;
}
