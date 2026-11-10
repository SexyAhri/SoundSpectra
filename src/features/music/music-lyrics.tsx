import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { MusicButton as Button, MusicHint } from "./music-hint";
import { emptyLyrics, trackKey, type LyricDocument } from "../lyrics/model";
import { describeError } from "../spectrum/bridge";
import { musicClient } from "./client";
import { useLyricActive, useLyricFollow } from "./use-lyric-motion";
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
  useEffect(() => {
    setDocument({
      ...emptyLyrics,
      key,
      status: track ? "loading" : "idle",
      message: track ? "正在读取歌词…" : "选择一首歌曲查看歌词",
    });
    setIssue(null);
    setBusy(false);
  }, [p.generation, key]);
  useEffect(() => {
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
  const { score, credits } = useMemo(
    () => presentLyrics(document.key === key ? document.lines : []),
    [document.key, document.lines, key],
  );
  const timedLines = useMemo(() => score.map((item) => item.line), [score]);
  const active = useLyricActive(timedLines, p);
  const { browsing, browse, resume } = useLyricFollow(
    body,
    active,
    `${p.generation}:${key}`,
    score,
  );
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
  const source =
    document.key === key && document.status === "ready"
      ? document.message
      : "歌词独立获取 · 本地优先";
  return (
    <>
      <div className="library-lyrics-heading">
        <div className="library-lyrics-title-row">
          <MusicHint text={track?.title}>
            <strong>{track?.title ?? "暂无歌曲"}</strong>
          </MusicHint>
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
        <div className="library-lyrics-meta">
          {track?.artist && (
            <MusicHint text={track.artist}>
              <span className="library-lyrics-artist">{track.artist}</span>
            </MusicHint>
          )}
          <MusicHint text={source}>
            <span className="library-lyrics-source">{source}</span>
          </MusicHint>
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
        <MusicHint text="正值表示延后显示">
          <span tabIndex={0}>
            {(p.lyricOffset ?? 0) > 0 ? "+" : ""}
            {(p.lyricOffset ?? 0).toFixed(1)}s
          </span>
        </MusicHint>
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
      <div
        className="library-lyrics-stage"
        data-browsing={browsing || undefined}
      >
        <div
          className="library-lyrics-body"
          data-has-lyrics={Boolean(score.length) || undefined}
          ref={body}
          tabIndex={0}
          role="region"
          aria-label="歌词正文"
          onWheel={browse}
          onTouchMove={browse}
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
              browse();
          }}
        >
          {score.length ? (
            score.map(({ line, index }, position) => (
              <button
                key={`${line.start}-${index}`}
                aria-current={position === active ? "true" : undefined}
                data-distance={
                  Math.abs(position - active) <= 1
                    ? "near"
                    : Math.abs(position - active) <= 2
                      ? "middle"
                      : "far"
                }
                disabled={
                  !p.quality ||
                  p.suspended ||
                  p.phase === "loading" ||
                  p.phase === "error"
                }
                aria-description="点击跳转到这一句"
                onClick={() => {
                  command(
                    "seek",
                    line.start / 1000 - (p.globalLyricOffset ?? 0),
                  );
                  resume();
                }}
              >
                <span className="library-lyric-text">{line.text}</span>
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
        {browsing && (
          <Button
            className="library-lyrics-return"
            size="sm"
            variant="outline"
            onClick={resume}
          >
            回到当前句
          </Button>
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
