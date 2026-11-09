import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  activeLine,
  emptyLyrics,
  trackKey,
  type LyricDocument,
} from "../lyrics/model";
import { describeError } from "../spectrum/bridge";
import { musicClient } from "./client";
import { presentLyrics } from "./lyric-presentation";
import type { Playback } from "./types";

export function MusicLyrics({
  playback: p,
  command,
}: {
  playback: Playback;
  command: (action: string, value?: number) => void;
}) {
  const track = p.queue[p.index];
  const key = track ? trackKey(track) : "";
  const [document, setDocument] = useState<LyricDocument>(emptyLyrics);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const generation = useRef(p.generation);
  generation.current = p.generation;
  const body = useRef<HTMLDivElement>(null);
  const [browsing, setBrowsing] = useState(false);
  const [followRevision, setFollowRevision] = useState(0);
  useEffect(() => {
    setDocument({
      ...emptyLyrics,
      key,
      status: track ? "loading" : "idle",
      message: track ? "正在读取歌词…" : "选择一首歌曲查看歌词",
    });
    setIssue(null);
    setBusy(false);
    setBrowsing(false);
    if (!track) return;
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const next = await musicClient.lyrics();
        if (!disposed && next.key === key) {
          setDocument(next);
          setIssue(null);
          if (next.status === "ready") return;
        }
      } catch (e) {
        if (!disposed) setIssue(describeError(e));
      }
      if (!disposed) timer = setTimeout(read, 1500);
    };
    void read();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [p.generation, key, p.lyricOffset]);
  const lines = document.key === key ? document.lines : [];
  const { score, credits } = presentLyrics(lines);
  const active = activeLine(
    score.map((item) => item.line),
    (p.position + (p.globalLyricOffset ?? 0)) * 1000,
  );
  useEffect(() => {
    const root = body.current;
    const line = root?.querySelector<HTMLElement>('[aria-current="true"]');
    if (root && line && !browsing) {
      root.scrollTo({
        top: line.offsetTop - root.clientHeight / 2 + line.clientHeight / 2,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }
  }, [active, p.generation, browsing, followRevision]);
  const refresh = async () => {
    const request = p.generation;
    setBusy(true);
    try {
      const next = await musicClient.lyrics(true);
      if (generation.current === request && next.key === key) {
        setDocument(next);
        setIssue(null);
      }
    } catch (e) {
      if (generation.current === request) setIssue(describeError(e));
    } finally {
      if (generation.current === request) setBusy(false);
    }
  };
  return (
    <>
      <div className="library-lyrics-heading">
        <strong>{track?.title ?? "暂无歌曲"}</strong>
        <p>{track?.artist}</p>
        <div>
          <span>
            {document.key === key && document.status === "ready"
              ? document.message
              : "歌词独立获取 · 本地优先"}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="刷新歌词"
            title="重新获取并更新歌词缓存"
            disabled={busy || !track}
            onClick={() => void refresh()}
          >
            <RefreshCw size={13} className={busy ? "spinning" : ""} />
          </Button>
        </div>
      </div>
      {(issue || document.issue) && (
        <p className="library-notice" role="status">
          {issue || document.issue}
        </p>
      )}
      <div className="library-lyric-tools">
        <Button
          size="sm"
          variant="ghost"
          disabled={!track || (p.lyricOffset ?? 0) <= -10}
          onClick={() =>
            void musicClient
              .offset(Math.max(-10, (p.lyricOffset ?? 0) - 0.5))
              .catch((e) => setIssue(describeError(e)))
          }
        >
          提前 0.5 秒
        </Button>
        <span title="正值表示延后显示">
          {(p.lyricOffset ?? 0) > 0 ? "+" : ""}
          {(p.lyricOffset ?? 0).toFixed(1)}s
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={!track || (p.lyricOffset ?? 0) >= 10}
          onClick={() =>
            void musicClient
              .offset(Math.min(10, (p.lyricOffset ?? 0) + 0.5))
              .catch((e) => setIssue(describeError(e)))
          }
        >
          延后 0.5 秒
        </Button>
      </div>
      {browsing && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setBrowsing(false);
            setFollowRevision((v) => v + 1);
          }}
        >
          回到当前句
        </Button>
      )}
      <div
        className="library-lyrics-body"
        ref={body}
        onPointerDown={(e) => {
          if (
            e.currentTarget.scrollHeight > e.currentTarget.clientHeight &&
            e.clientX >= e.currentTarget.getBoundingClientRect().right - 16
          )
            setBrowsing(true);
        }}
        onWheel={() => setBrowsing(true)}
        onTouchMove={() => setBrowsing(true)}
        onKeyDown={(e) => {
          if (
            [
              "ArrowDown",
              "ArrowUp",
              "PageDown",
              "PageUp",
              "Home",
              "End",
            ].includes(e.key)
          )
            setBrowsing(true);
        }}
      >
        {score.length ? (
          score.map(({ line, index }, position) => (
            <button
              key={`${line.start}-${index}`}
              aria-current={position === active ? "true" : undefined}
              disabled={
                !p.quality ||
                p.suspended ||
                p.phase === "loading" ||
                p.phase === "error"
              }
              title="点击跳转到这一句"
              onClick={() =>
                command("seek", line.start / 1000 - (p.globalLyricOffset ?? 0))
              }
            >
              {line.text}
            </button>
          ))
        ) : (
          <div className="library-empty library-lyrics-empty">
            {document.status === "loading" && (
              <LoaderCircle className="spinning" size={16} />
            )}
            <p>
              {credits.length
                ? "这首歌暂未提供正文歌词"
                : track
                  ? document.message
                  : "选择一首歌曲查看歌词"}
            </p>
            {credits.length > 0 && (
              <small>已收到歌曲制作信息，可在下方查看</small>
            )}
          </div>
        )}
      </div>
      {credits.length > 0 && (
        <details className="library-lyrics-credits" key={key}>
          <summary>歌曲制作信息 · {credits.length} 项</summary>
          <div>
            {credits.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
