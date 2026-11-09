import type { TimedGlyph } from "./lyric-glyphs";
import type { LyricPalette } from "./lyric-palette";

export type LyricFontStyle = "modern" | "poetry";
export type LyricTypeMode = "depth" | "stage" | "folded" | "stardust";
export const lyricFamilies = {
  modern: '"Noto Sans SC Variable", "Microsoft YaHei", sans-serif',
  poetry: '"Noto Serif SC Variable", "Songti SC", SimSun, serif',
};
export const lyricFont = (
  size: number,
  style: LyricFontStyle = "modern",
  weight = 400,
) => `${weight} ${size}px ${lyricFamilies[style]}`;

/** Optical weight follows the actual screen size, including shallow lyric regions. */
export function lyricWeight(
  style: LyricFontStyle,
  size: number,
  mode: LyricTypeMode,
  row = 0,
) {
  const small = Math.max(0, Math.min(1, (30 - size) / 16));
  return Math.round(
    (style === "poetry" ? 430 : 400) +
      small * (style === "poetry" ? 130 : 100) +
      (mode === "stage" && row === 1 ? 55 : 0),
  );
}

const latin = (text: string) =>
  /^[\p{Script=Latin}\p{Number}'’\-]+$/u.test(text);
const cjk = (text: string) =>
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
    text,
  );
const punctuation = (text: string) => /^\p{P}+$/u.test(text);
const segments = new Intl.Segmenter(undefined, { granularity: "word" });

/** Shared advances keep Latin kerning/word spaces natural and add air between CJK phrases. */
export function measureLyricGlyphs(
  ctx: CanvasRenderingContext2D,
  glyphs: TimedGlyph[],
  size: number,
  style: LyricFontStyle,
  mode: LyricTypeMode,
  weight: number,
) {
  const starts = new Set(
    [...segments.segment(glyphs.map((g) => g.text).join(""))].map(
      (s) => s.index,
    ),
  );
  let offset = 0;
  return glyphs.map((g, i) => {
    const previous = glyphs[i - 1],
      next = glyphs[i + 1];
    const isLatin = latin(g.text),
      scale = isLatin ? (style === "poetry" ? 1.065 : 1.035) : 1;
    ctx.font = lyricFont(size * scale, style, weight);
    const ink = ctx.measureText(g.text).width;
    const kern =
      isLatin && previous && latin(previous.text)
        ? ctx.measureText(previous.text + g.text).width -
          ctx.measureText(previous.text).width -
          ink
        : 0;
    const boundary =
      starts.has(offset) && previous && cjk(previous.text) && cjk(g.text);
    const tracking =
      cjk(g.text) && next && cjk(next.text)
        ? size *
          ((mode === "depth" ? 0.052 : mode === "folded" ? 0.043 : 0.025) +
            (style === "poetry" ? 0.018 : 0))
        : 0;
    const gap = boundary ? size * (mode === "depth" ? 0.055 : 0.035) : 0;
    offset += g.text.length;
    const width = g.hidden ? size * 0.27 : !g.text.trim() ? size * 0.3 : ink;
    return {
      width,
      advance: Math.max(0, width + tracking + kern + gap),
      leading: kern + gap,
      scale,
      baseline: isLatin ? -size * 0.018 : 0,
      opacity: punctuation(g.text) ? 0.66 : 1,
    };
  });
}

const mix = (a: string, b: string, t: number) =>
  "#" +
  [1, 3, 5]
    .map((i) =>
      Math.round(
        parseInt(a.slice(i, i + 2), 16) * (1 - t) +
          parseInt(b.slice(i, i + 2), 16) * t,
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

/** Seekable liquid ink, sampled across the source word and painted only once. */
export function lyricInk(
  ctx: CanvasRenderingContext2D,
  palette: LyricPalette,
  width: number,
  size: number,
  sung: number,
  progress: number,
  active: boolean,
  reduced: boolean,
  offset = 0,
) {
  const base = mix(
    mix(palette.unsung, "#f6f0e5", 0.48),
    mix(palette.sung, "#fff8ea", 0.7),
    sung,
  );
  if (reduced || !active) return base;
  const p = Math.max(0, Math.min(1, progress)),
    phase = p * Math.PI * 2;
  const tilt = Math.sin(phase) * size * 0.42;
  const ink = ctx.createLinearGradient(
    -width / 2 - offset,
    -tilt,
    width / 2 - offset,
    tilt,
  );
  // Enter and settle without a flash at either word boundary. The second pool
  // trails the advancing front, so long notes gather color instead of just scanning.
  const envelope = Math.sin(Math.PI * p) ** 0.65;
  const front = -0.18 + p * 1.36;
  for (let i = 0; i <= 20; i++) {
    const x = i / 20;
    const crest = Math.exp(
      -(((x - front) / (0.19 + 0.045 * Math.sin(phase))) ** 2),
    );
    const wake = Math.exp(
      -(((x - front + 0.27 + 0.055 * Math.sin(phase)) / 0.29) ** 2),
    );
    const swirl = 0.5 + 0.5 * Math.sin(x * 8 - phase * 1.4);
    const color = mix(palette.prism[0], palette.prism[1], swirl);
    const pool = mix(color, palette.prism[2], crest * 0.48);
    const amount = envelope * Math.min(0.88, crest * 0.8 + wake * 0.46);
    const liquid = mix(base, pool, amount);
    ink.addColorStop(x, mix(liquid, "#fff8ea", envelope * crest * 0.16));
  }
  return ink;
}
