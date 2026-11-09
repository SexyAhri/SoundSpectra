import type { CSSProperties } from "react";
import { Pause, SkipBack, SkipForward } from "lucide-react";
import type { DesktopCardSettings } from "../spectrum/model";
import { CardFace } from "./card-face";
import { CardArtwork } from "./card-artwork";
import "./card-style-preview.css";

const info = {
  title: "沿着海岸慢慢走",
  album: "海风手记",
  source: "音乐",
  duration: 236,
};
const levels = [5, 11, 17, 9, 21, 14, 7, 16, 11, 5];

export function CardStylePreview({
  variant,
}: {
  variant: DesktopCardSettings["variant"];
}) {
  return (
    <svg
      className="card-style-preview"
      viewBox="0 0 480 260"
      aria-hidden="true"
      focusable="false"
    >
      <foreignObject width="480" height="260">
        <div
          className={`music-card music-card-${variant} mc mc-${variant}`}
          data-active="false"
          data-playing="false"
          data-timeline="available"
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
            art={<CardArtwork variant={variant} />}
            title={info.title}
            artist="林间来信"
            status="播放中"
            time="1:12 / 3:56"
            transport={
              <span className="mc-transport">
                {[SkipBack, Pause, SkipForward].map((Icon, index) => (
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
