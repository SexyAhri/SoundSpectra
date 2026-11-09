import { useId } from "react";
import type { DesktopCardSettings } from "../spectrum/model";
import "./card-artwork.css";

/** Original cover studies, also used when a player's cover is absent or broken. */
export function CardArtwork({
  variant,
  cover,
}: {
  variant: DesktopCardSettings["variant"];
  cover?: string | null;
}) {
  const id = useId();
  const paper = variant === "afternoon";
  return (
    <span className="mc-artwork" data-cover={cover ? "provided" : "original"}>
      {cover ? (
        <img key={cover} src={cover} alt="" />
      ) : (
        <svg
          viewBox="0 0 160 160"
          className="mc-original-cover"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id={`${id}-field`} x2=".8" y2="1">
              <stop
                stopColor={
                  paper
                    ? "#e7ddbb"
                    : variant === "floating"
                      ? "#18374b"
                      : "#102d39"
                }
              />
              <stop offset="1" stopColor={paper ? "#c3b489" : "#101c2b"} />
            </linearGradient>
            <radialGradient id={`${id}-halo`}>
              <stop
                stopColor={paper ? "#f8edca" : "#f0d7bc"}
                stopOpacity=".9"
              />
              <stop
                offset=".36"
                stopColor={paper ? "#d9c49a" : "#a5bfc3"}
                stopOpacity=".45"
              />
              <stop
                offset="1"
                stopColor={paper ? "#aa986a" : "#6b9eae"}
                stopOpacity="0"
              />
            </radialGradient>
            <linearGradient id={`${id}-ribbon`} x1="0" y1="1" x2="1" y2="0">
              <stop stopColor="#77c9be" />
              <stop offset=".48" stopColor="#9fb8e0" />
              <stop offset="1" stopColor="#d2a5bf" />
            </linearGradient>
            <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#f4c59b" />
              <stop offset=".52" stopColor="#bdc4dc" />
              <stop offset="1" stopColor="#588d9f" />
            </linearGradient>
          </defs>
          <path fill={`url(#${id}-field)`} d="M0 0H160V160H0Z" />
          {variant === "record" && (
            <>
              <circle
                className="mc-artwork-glow"
                cx="84"
                cy="66"
                r="69"
                fill={`url(#${id}-halo)`}
              />
              <circle
                cx="84"
                cy="66"
                r="30"
                fill="#132a38"
                stroke={`url(#${id}-ring)`}
                strokeWidth="1.8"
              />
              <circle
                cx="84"
                cy="66"
                r="33"
                fill="none"
                stroke="#bed1cf"
                strokeOpacity=".18"
                strokeWidth=".6"
              />
              <path d="M0 111Q38 92 80 111T160 106V160H0Z" fill="#132a35" />
              {Array.from({ length: 9 }, (_, i) => (
                <path
                  key={i}
                  d={`M-10 ${113 + i * 5}Q40 ${94 + i * 7} 86 ${114 + i * 4}T170 ${105 + i * 6}`}
                  fill="none"
                  stroke="#8cacae"
                  strokeOpacity={0.22 - i * 0.018}
                  strokeWidth=".7"
                />
              ))}
              <path
                d="M18 22H41M18 22V28M119 138H142M142 132V138"
                fill="none"
                stroke="#b2c7c7"
                strokeOpacity=".5"
                strokeWidth=".7"
              />
            </>
          )}
          {variant === "compact" && (
            <>
              <circle
                className="mc-artwork-glow"
                cx="80"
                cy="76"
                r="72"
                fill={`url(#${id}-halo)`}
              />
              <circle
                cx="80"
                cy="76"
                r="39"
                fill="#132630"
                stroke={`url(#${id}-ring)`}
                strokeWidth="3"
              />
              <circle
                cx="80"
                cy="76"
                r="44"
                fill="none"
                stroke="#e4cab3"
                strokeWidth=".6"
                strokeOpacity=".35"
              />
              <ellipse
                cx="80"
                cy="87"
                rx="63"
                ry="17"
                transform="rotate(-27 80 87)"
                fill="none"
                stroke="#a0bfc3"
                strokeWidth="1"
                strokeOpacity=".44"
              />
              <path d="M0 123Q54 99 160 125V160H0Z" fill="#162c36" />
              <path
                d="M0 131Q70 109 160 132"
                fill="none"
                stroke="#728e96"
                strokeWidth=".6"
              />
            </>
          )}
          {paper && (
            <>
              <path
                d="M9 9H151V151H9Z"
                fill="none"
                stroke="#7e7857"
                strokeOpacity=".45"
                strokeWidth=".6"
              />
              <circle
                className="mc-artwork-glow"
                cx="110"
                cy="43"
                r="35"
                fill={`url(#${id}-halo)`}
              />
              <circle
                cx="112"
                cy="40"
                r="18"
                fill="none"
                stroke="#8b8158"
                strokeOpacity=".45"
                strokeWidth=".65"
              />
              <g
                fill="none"
                stroke="#686f53"
                strokeWidth="1.1"
                strokeLinecap="round"
              >
                <path d="M56 143Q77 96 66 36M69 95Q96 73 113 57M68 77Q43 64 32 49" />
                {[0, 1, 2, 3, 4].map((i) => (
                  <g
                    key={i}
                    transform={`translate(${67 + i * 0.1} ${46 + i * 16}) rotate(${-12 + i * 3})`}
                  >
                    <path
                      d="M0 0Q-24 -17 -27 -7Q-21 4 0 0M0 4Q22 -17 27 -8Q24 5 0 4"
                      fill="#89906a"
                      fillOpacity=".3"
                    />
                    <path d="M-25 -7L0 0L25 -8" strokeWidth=".45" />
                  </g>
                ))}
                <path
                  d="M18 137Q69 125 144 136M18 141Q82 131 144 140"
                  strokeOpacity=".35"
                  strokeWidth=".5"
                />
              </g>
              <g fill="#7d795a" opacity=".3">
                {Array.from({ length: 26 }, (_, i) => (
                  <circle
                    key={i}
                    cx={12 + ((i * 37) % 136)}
                    cy={14 + ((i * 53) % 130)}
                    r=".45"
                  />
                ))}
              </g>
            </>
          )}
          {variant === "floating" && (
            <>
              <circle
                className="mc-artwork-glow"
                cx="112"
                cy="46"
                r="66"
                fill={`url(#${id}-halo)`}
                opacity=".55"
              />
              {Array.from({ length: 24 }, (_, i) => (
                <path
                  key={i}
                  d={`M-20 ${145 + i * 2}C${76 - i * 2} ${136 - i * 4}, ${39 + i * 3} ${26 + i}, 182 ${13 + i * 4}`}
                  fill="none"
                  stroke={`url(#${id}-ribbon)`}
                  strokeWidth={i % 5 === 0 ? "1.4" : ".65"}
                  strokeOpacity={0.28 + Math.sin((i / 24) * Math.PI) * 0.5}
                />
              ))}
              <path
                d="M15 16H35M15 16V35M125 144H145M145 125V144"
                fill="none"
                stroke="#b6d6d6"
                strokeOpacity=".38"
                strokeWidth=".7"
              />
            </>
          )}
        </svg>
      )}
      <span className="mc-artwork-finish" />
    </span>
  );
}
