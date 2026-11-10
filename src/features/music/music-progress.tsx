import { useEffect, useState } from "react";
import { clock, type Playback } from "./types";
import { MusicHint } from "./music-hint";

const percent = (value: number, total: number) =>
  Math.max(
    0,
    Math.min(
      100,
      Number.isFinite(value) && total > 0 ? (value / total) * 100 : 0,
    ),
  );

/** Playback, buffered time ranges and byte download progress are independent.
 * In particular, a VBR file's byte percentage is not a playable timestamp. */
export function MusicProgress({
  playback: p,
  command,
}: {
  playback: Playback;
  command: (action: string, value?: number) => void;
}) {
  const [seek, setSeek] = useState<number | null>(null);
  useEffect(() => setSeek(null), [p.generation]);
  const current = p.queue[p.index];
  const ready =
    !!current && !p.suspended && p.phase !== "loading" && p.phase !== "error";
  const transfer = p.transfer;
  const downloading = !p.suspended && transfer?.status === "downloading";
  const downloaded = percent(transfer?.received ?? 0, transfer?.total ?? 0);
  const position = seek ?? p.position;
  const loading = p.phase === "loading" && !p.suspended;
  const authorizing = loading && p.loadStage !== "buffering";
  const buffering =
    !p.suspended &&
    ((p.phase === "buffering" && p.playing) || (loading && !authorizing));
  const seeking = !p.suspended && p.seeking;
  const failed = !p.suspended && p.phase === "error";
  const states: { id: string; label: string }[] = [];
  if (current) {
    if (p.suspended) states.push({ id: "suspended", label: "外部音源" });
    else if (authorizing) states.push({ id: "authorizing", label: "授权中" });
    else if (failed) states.push({ id: "error", label: "播放失败" });
    else if (!loading && !p.playing)
      states.push({
        id: "paused",
        label:
          p.duration > 0 && p.position >= p.duration - 0.05
            ? "播放完毕"
            : "已暂停",
      });
    else if (p.phase === "playing")
      states.push({ id: "playing", label: "播放中" });
    if (seeking) states.push({ id: "seeking", label: "跳转中" });
    if (buffering) states.push({ id: "buffering", label: "缓冲中" });
    if (downloading)
      states.push({
        id: "downloading",
        label: `${Math.floor(downloaded)}%`,
      });
    else if (!p.suspended && transfer?.status === "failed")
      states.push({
        id: "download-error",
        label: "下载中断",
      });
  }
  const summary = states
    .map((s) => (s.id === "downloading" ? `正在下载 ${s.label}` : s.label))
    .join(" · ");
  const transferDetails =
    downloading && transfer
      ? `${(transfer.received / 1048576).toFixed(1)} / ${(transfer.total / 1048576).toFixed(1)} MB`
      : "";
  const tooltip = [summary, transferDetails].filter(Boolean).join("\n");
  const commit = (value: number) => {
    command("seek", value);
    setSeek(null);
  };
  return (
    <div
      className="library-timeline"
      data-states={states.map((s) => s.id).join(" ")}
    >
      <div className="library-progress">
        <span>{clock(position)}</span>
        <MusicHint text={tooltip}>
          <div className="library-progress-rail">
            <div className="library-progress-track">
              {downloading && (
                <div
                  className="library-progress-download"
                  role="progressbar"
                  aria-label="音频下载进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.floor(downloaded)}
                  aria-valuetext={`${Math.floor(downloaded)}% · ${transferDetails}`}
                  style={{ width: `${downloaded}%` }}
                />
              )}
              {(p.buffered ?? []).map(([start, end], index) => (
                <i
                  className="library-progress-buffer"
                  aria-hidden="true"
                  key={index}
                  style={{
                    left: `${percent(start, p.duration)}%`,
                    width: `${percent(end - start, p.duration)}%`,
                  }}
                />
              ))}
              <i
                className="library-progress-played"
                aria-hidden="true"
                style={{ width: `${percent(position, p.duration)}%` }}
              />
              {(authorizing || buffering || seeking) && (
                <i className="library-progress-loading" aria-hidden="true" />
              )}
            </div>
            <input
              aria-label="播放进度"
              aria-valuetext={`${clock(position)} / ${clock(p.duration)}${summary ? `；${summary}` : ""}`}
              type="range"
              min="0"
              max={p.duration || 1}
              step=".1"
              value={position}
              disabled={!ready}
              onChange={(e) => setSeek(Number(e.target.value))}
              onPointerUp={(e) => {
                if (seek !== null) commit(Number(e.currentTarget.value));
              }}
              onKeyUp={(e) => {
                if (
                  seek !== null &&
                  [
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                    "Home",
                    "End",
                    "PageUp",
                    "PageDown",
                  ].includes(e.key)
                )
                  commit(Number(e.currentTarget.value));
              }}
              onPointerCancel={() => setSeek(null)}
            />
          </div>
        </MusicHint>
        <span>{clock(p.duration)}</span>
      </div>
    </div>
  );
}
