import { useId } from "react";
import type { LyricSettings } from "../spectrum/model";
import { lyricOrbit } from "./lyric-motion";
import { lyricFamilies, lyricWeight } from "./lyric-typography";
import "../../assets/fonts/music-fonts.css";
import "./lyric-style-preview.css";

const inks = {
  depth: ["#a8d9e5", "#e1ece7"],
  stage: ["#e9b79b", "#f4e6d3"],
  stardust: ["#a3d3b9", "#e4ecd5"],
  folded: ["#85dccd", "#c3a3e0"],
} as const;
const fallbackVerse = "让晚风替我寄一封信";

/** A still composition study, using original lyrics and the production type/orbit. */
export function LyricStylePreview({
  motion,
  text,
}: {
  motion: LyricSettings["motion"];
  text?: string;
}) {
  const verse = text?.trim().slice(0, 18) || fallbackVerse;
  const split = Math.min(5, Math.max(2, Math.floor(verse.length * 0.35)));
  const id = useId(),
    [accent, light] = inks[motion];
  const orbit = Array.from({ length: 61 }, (_, i) => {
    const p = lyricOrbit(i / 60, 0.48, 480, 260, false);
    return `${i ? "L" : "M"}${p.x},${p.y + 43}`;
  }).join(" ");
  return (
    <svg
      className={`lyric-style-preview lyric-style-preview-${motion}`}
      viewBox="0 0 480 260"
      aria-hidden="true"
      focusable="false"
      fontFamily={lyricFamilies.modern}
      fontWeight={lyricWeight("modern", 42, motion)}
    >
      <defs>
        <linearGradient id={`${id}-ink`} x1="0" y1="0" x2="1" y2=".3">
          <stop stopColor={light} />
          <stop offset=".48" stopColor={light} />
          <stop offset=".72" stopColor={accent} />
          <stop offset="1" stopColor={light} />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop stopColor={accent} stopOpacity=".12" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="480" height="260" fill="#141d23" />
      <ellipse cx="240" cy="136" rx="250" ry="155" fill={`url(#${id}-glow)`} />
      <g fill={accent} opacity=".33" fontSize="13" letterSpacing="3">
        <text x="42" y="43">
          {text ? "当前歌曲" : "把星光藏进你的眼睛"}
        </text>
        <text x="438" y="232" textAnchor="end">
          {text ? "编排预览" : "沿着海岸，慢慢走向你"}
        </text>
      </g>
      {motion === "depth" && (
        <>
          <g fill="none" stroke={accent} strokeWidth="1">
            <path d="M88 69L372 46L421 194L105 216Z" opacity=".11" />
            <path d="M62 80L392 64L404 202L74 214Z" opacity=".18" />
            <path d="M37 88L421 83L421 197L37 202Z" opacity=".08" />
          </g>
          <g
            transform="translate(43 96) skewY(-4)"
            fill={`url(#${id}-ink)`}
            letterSpacing="5"
          >
            <text fontSize="42">{verse.slice(0, split)}</text>
            <text x="92" y="73" fontSize="40">
              {verse.slice(split)}
            </text>
          </g>
          <path
            d="M44 121L172 112M226 193L420 181"
            stroke={accent}
            opacity=".23"
          />
        </>
      )}
      {motion === "stage" && (
        <>
          <g fill={accent} opacity=".06">
            <path d="M0 114L480 76V118L0 156Z" />
            <path d="M0 186L480 149V185L0 222Z" />
          </g>
          <g transform="translate(49 106) rotate(-5)" fill={`url(#${id}-ink)`}>
            <text fontSize="40" letterSpacing="9">
              {verse.slice(0, split)}
            </text>
            <text x="82" y="73" fontSize="46" letterSpacing="3">
              {verse.slice(split)}
            </text>
          </g>
          <path
            d="M51 127L185 116M151 202L431 177"
            stroke={accent}
            strokeWidth="2"
            opacity=".5"
          />
          <path d="M32 77V117M447 158V195" stroke={accent} opacity=".4" />
        </>
      )}
      {motion === "stardust" && (
        <>
          <path
            d={orbit}
            fill="none"
            stroke={accent}
            strokeWidth="1.4"
            opacity=".35"
          />
          <g
            fill={`url(#${id}-ink)`}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {Array.from(verse).map((char, i, chars) => {
              const position = 0.06 + (i / (chars.length - 1)) * 0.88;
              const p = lyricOrbit(position, 0.48, 480, 260, false);
              const scale =
                p.scale * (0.65 + 0.35 * (1 - Math.abs(position * 2 - 1)));
              return (
                <text
                  key={i}
                  transform={`translate(${p.x} ${p.y}) rotate(${(p.angle * 180) / Math.PI}) scale(${scale})`}
                  fontSize="40"
                >
                  {char}
                </text>
              );
            })}
          </g>
          {[0.15, 0.48, 0.84].map((position, i) => {
            const p = lyricOrbit(position, 0.48, 480, 260, false);
            return (
              <circle
                key={i}
                cx={p.x}
                cy={p.y + 43}
                r={i === 1 ? 3 : 1.8}
                fill={accent}
                opacity={i === 1 ? 0.9 : 0.4}
              />
            );
          })}
        </>
      )}
      {motion === "folded" && (
        <>
          <g fill="none" strokeWidth="1">
            <path
              d="M25 71L198 58L243 140L74 148ZM238 111L442 93L454 190L267 209Z"
              stroke={accent}
              opacity=".19"
            />
            <path
              d="M39 74L206 86L184 143L50 136ZM209 99L430 127L422 198L223 188Z"
              stroke={light}
              opacity=".16"
            />
          </g>
          <g transform="translate(49 109) rotate(-4) skewY(4)">
            <path
              d="M-9 -42L125 -40L141 17L-8 10Z"
              fill={accent}
              fillOpacity=".06"
              stroke={accent}
              strokeOpacity=".2"
            />
            <text fontSize="42" letterSpacing="3" fill={accent}>
              {verse.slice(0, split)}
            </text>
          </g>
          <g transform="translate(161 176) rotate(4) skewY(-5)">
            <path
              d="M-9 -43L264 -39L255 18L-9 10Z"
              fill={light}
              fillOpacity=".07"
              stroke={light}
              strokeOpacity=".22"
            />
            <path d="M85 -41V14M176 -40V15" stroke={light} opacity=".24" />
            <text fontSize="41" letterSpacing="3" fill={`url(#${id}-ink)`}>
              {verse.slice(split)}
            </text>
          </g>
        </>
      )}
    </svg>
  );
}
