import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { native } from "../spectrum/bridge";
import type { LyricSettings } from "../spectrum/model";
import type { NowPlaying } from "../desktop-card/use-now-playing";
import { emptyLyrics, trackKey, type LyricDocument } from "./model";

const browserLyrics: LyricDocument = {
  ...emptyLyrics,
  message: "请在客户端中读取本地歌词；模拟预览可查看动效",
};

function sameLyrics(previous: LyricDocument, next: LyricDocument) {
  return previous.key === next.key && previous.status === next.status &&
    previous.message === next.message && previous.file === next.file &&
    previous.issue === next.issue && previous.lines.length === next.lines.length &&
    previous.lines.every((line, index) => {
      const other = next.lines[index];
      return line.text === other.text && line.start === other.start &&
        line.end === other.end && line.words.length === other.words.length &&
        line.words.every((word, index) => {
          const otherWord = other.words[index];
          return word.text === otherWord.text && word.start === otherWord.start &&
            word.end === otherWord.end;
        });
    });
}

export function useLyrics(
  settings: LyricSettings,
  info: NowPlaying,
  active = true,
) {
  const [document, setDocument] = useState<LyricDocument>(emptyLyrics);
  const latest = useRef(document);
  const key = trackKey(info);
  useEffect(() => {
    if (!settings.enabled || !active || !native || !info.title) return;
    let disposed = false,
      first = true,
      timer: ReturnType<typeof setTimeout>;
    const publish = (next: LyricDocument) => {
      if (disposed || sameLyrics(latest.current, next)) return;
      latest.current = next;
      setDocument(next);
    };
    publish({
      ...emptyLyrics,
      key,
      status: "loading",
      message: "正在匹配歌词…",
    });
    const read = async () => {
      try {
        const next = await invoke<LyricDocument>("get_current_lyrics", {
          refresh: first,
        });
        first = false;
        if (!disposed && next.key === key && next.status !== "cancelled")
          publish(next);
      } catch {
        if (!disposed)
          publish({
            ...emptyLyrics,
            key,
            status: "error",
            message: "歌词暂时不可用，正在自动重试",
          });
      }
      if (!disposed) timer = setTimeout(read, 3000);
    };
    void read();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [
    settings.enabled,
    settings.folder,
    active,
    key,
    info.title,
    info.duration,
    info.source,
    info.processId,
    info.sessionId,
    info.trackId,
  ]);
  if (!native) return browserLyrics;
  if (!settings.enabled || !info.title || document.key !== key)
    return emptyLyrics;
  return document;
}
