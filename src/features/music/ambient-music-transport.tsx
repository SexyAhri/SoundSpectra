import {
  ListMusic,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { MusicButton as Button } from "./music-hint";
import { MusicCover } from "./music-cover";
import { MusicProgress } from "./music-progress";
import { clock, type Playback } from "./types";
import type { NowPlaying } from "../desktop-card/use-now-playing";
import { CardTransport } from "../desktop-card/card-transport";
import { cardPosition } from "../desktop-card/card-clock";
import "./ambient-music-transport.css";

export function AmbientMusicTransport({
  playback: p,
  info,
  busy,
  command,
  queueOpen,
  onQueue,
}: {
  playback: Playback;
  info?: NowPlaying;
  busy: boolean;
  command: (action: string, value?: number) => void;
  queueOpen: boolean;
  onQueue: () => void;
}) {
  const current = p.queue[p.index];
  const external = !!info?.title && (!current || p.suspended);
  const builtin = !!current && !external;
  const waiting =
    p.phase === "loading" ||
    (p.playing && ["ready", "buffering"].includes(p.phase));
  const title = external ? info.title : current?.title;
  const artist = external ? info.artist : current?.artist;
  const externalPosition = external ? cardPosition(info, Date.now()) : null;
  const state = external
    ? info.issue ||
      info.playbackAvailable === false ||
      !info.updated ||
      Date.now() - info.updated > 4000
      ? "媒体状态待确认"
      : info.playing
        ? "正在播放"
        : "已暂停"
    : builtin
      ? p.suspended
        ? "内置进度已保留"
        : p.phase === "error"
          ? "播放未完成"
          : waiting
            ? "正在载入…"
            : p.playing
              ? "正在播放"
              : "已暂停"
      : "音乐待机";
  return (
    <div
      className="ambient-listening"
      data-source={external ? "external" : builtin ? "builtin" : "standby"}
      aria-label="首页音乐控制"
    >
      <button
        className="ambient-listening-track"
        aria-label="打开音乐库"
        onClick={() => {
          location.hash = "music";
        }}
      >
        {title ? (
          <MusicCover src={external ? info.cover : current?.cover} small />
        ) : (
          <Music2 size={20} aria-hidden="true" />
        )}
        <span className="ambient-listening-info">
          <span
            className="ambient-listening-title"
            title={[title, artist].filter(Boolean).join(" · ")}
          >
            <strong>{title || "音乐待机"}</strong>
            {artist && <span>{artist}</span>}
          </span>
          <span className="ambient-listening-state" role="status">
            {title ? state : "打开音乐库，或播放外部音乐"}
          </span>
        </span>
      </button>
      {builtin && (
        <div className="ambient-listening-progress">
          <MusicProgress playback={p} command={command} />
        </div>
      )}
      {external && (
        <div className="ambient-listening-progress ambient-listening-external-progress">
          <div
            className="library-progress"
            title={
              externalPosition === null
                ? "播放器未提供进度"
                : "进度由外部播放器控制"
            }
          >
            <span>
              {externalPosition === null ? "—" : clock(externalPosition / 1000)}
            </span>
            <div
              className="library-progress-rail"
              role={externalPosition === null ? undefined : "progressbar"}
              aria-label="外部播放进度"
              aria-valuemin={externalPosition === null ? undefined : 0}
              aria-valuemax={
                externalPosition === null ? undefined : info.duration
              }
              aria-valuenow={
                externalPosition === null
                  ? undefined
                  : Math.floor(externalPosition / 1000)
              }
            >
              <div className="library-progress-track">
                <i
                  className="library-progress-played"
                  style={{
                    width: `${externalPosition === null ? 0 : Math.max(0, Math.min(100, (externalPosition / 1000 / info.duration) * 100))}%`,
                  }}
                />
              </div>
            </div>
            <span>
              {externalPosition === null ? "—" : clock(info.duration)}
            </span>
          </div>
        </div>
      )}
      <div className="ambient-listening-actions">
        {external ? (
          <CardTransport info={info} supportedOnly />
        ) : builtin ? (
          <div
            className="ambient-listening-buttons"
            role="group"
            aria-label="播放控制"
            aria-busy={busy || waiting}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="上一首"
              disabled={busy || !p.canPrevious}
              onClick={() => command("previous")}
            >
              <SkipBack size={16} />
            </Button>
            <Button
              className="ambient-listening-play"
              variant="secondary"
              size="icon-sm"
              aria-label={p.playing ? "暂停" : "播放"}
              title={
                p.suspended
                  ? "恢复内置播放"
                  : p.phase === "error"
                    ? "重试播放"
                    : p.playing
                      ? "暂停"
                      : "播放"
              }
              disabled={busy}
              onClick={() =>
                command(
                  p.playing ? "pause" : p.phase === "error" ? "retry" : "play",
                )
              }
            >
              {waiting ? (
                <LoaderCircle size={17} className="spinning" />
              ) : p.playing ? (
                <Pause size={17} />
              ) : (
                <Play size={17} />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="下一首"
              disabled={busy || !p.canNext}
              onClick={() => command("next")}
            >
              <SkipForward size={16} />
            </Button>
          </div>
        ) : null}
        {builtin && (
          <Button
            variant="ghost"
            size="icon-sm"
            data-music-panel-toggle
            aria-label="播放队列"
            aria-pressed={queueOpen}
            onClick={onQueue}
          >
            <ListMusic size={17} />
          </Button>
        )}
      </div>
      {builtin && p.error && (
        <p className="ambient-listening-error" role="alert">
          {p.error}
        </p>
      )}
    </div>
  );
}
