import { emptyNowPlaying, type NowPlaying } from "./use-now-playing";
import type { CSSProperties } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { DesktopCardSettings } from "../spectrum/model";
import { CardFace } from "./card-face";
import { CardArtwork } from "./card-artwork";
import { useCardCover } from "./card-presentation";
import { cardPosition } from "./card-clock";
import "./card-style-preview.css";

const fallbackInfo = {
  ...emptyNowPlaying,
  title: "沿着海岸慢慢走，直到晚风把这一首歌唱完",
  artist: "林间来信",
  album: "海风手记",
  source: "音乐",
  duration: 236,
};
const levels = [5, 11, 17, 9, 21, 14, 7, 16, 11, 5];
const stamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function CardStylePreview({
  variant,
  info: playing,
  ratio,
}: {
  variant: DesktopCardSettings["variant"];
  info?: NowPlaying;
  ratio?: number;
}) {
  const info = playing?.title ? playing : fallbackInfo;
  const example = info === fallbackInfo;
  const cover = useCardCover(info);
  const now = Date.now();
  const unavailable =
    !example &&
    (!!info.issue ||
      info.playbackAvailable === false ||
      !info.updated ||
      now - info.updated > 4000 ||
      info.updated > now + 2000);
  const position = example ? 72000 : cardPosition(info, now);
  const progress =
    position === null
      ? 0
      : Math.max(0, Math.min(1, position / 1000 / info.duration));
  const status = example
    ? "样式示例"
    : unavailable
      ? "媒体状态待确认"
      : info.playing
        ? "播放中"
        : "已暂停";
  const time =
    position === null
      ? "—"
      : `${stamp(position / 1000)} / ${stamp(info.duration)}`;
  const Toggle = example || (!unavailable && info.playing) ? Pause : Play;
  const height = ratio ? 432 / Math.max(0.5, ratio) : 152;
  const canvasHeight = ratio ? height + 48 : 260;
  return (
    <svg
      className="card-style-preview"
      viewBox={`0 0 480 ${canvasHeight}`}
      style={
        {
          "--preview-card-height": `${height}px`,
          "--preview-card-y": ratio ? "24px" : "54px",
          "--preview-progress": progress,
        } as CSSProperties
      }
      aria-hidden="true"
      focusable="false"
    >
      <foreignObject width="480" height={canvasHeight}>
        <div
          className={`music-card music-card-${variant} mc mc-${variant}`}
          data-active="false"
          data-playing="false"
          data-timeline={position === null ? "unavailable" : "available"}
          style={
            {
              "--mc-accent": "#c2d7be",
              "--mc-button-fill": "#cedec8",
              "--mc-button-ink": "#14272c",
            } as CSSProperties
          }
        >
          <CardFace
            variant={variant}
            info={info}
            art={<CardArtwork variant={variant} cover={cover} />}
            title={info.title}
            artist={info.artist}
            status={status}
            time={time}
            transport={
              <span className="mc-transport">
                {[SkipBack, Toggle, SkipForward].map((Icon, index) => (
                  <span
                    key={index}
                    className={`mc-control${index === 1 ? " mc-control-primary" : ""}`}
                  >
                    <Icon size={14} fill="currentColor" />
                  </span>
                ))}
              </span>
            }
            meter={
              <svg className="mc-meter" viewBox="0 0 82 24">
                {levels.map((level, index) => (
                  <line
                    key={index}
                    x1={4 + index * 8}
                    x2={4 + index * 8}
                    y1={24 - level}
                    y2={24}
                  />
                ))}
              </svg>
            }
          />
        </div>
      </foreignObject>
    </svg>
  );
}
