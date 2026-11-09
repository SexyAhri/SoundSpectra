import { defaults, type SpectrumSettings } from "../spectrum/model";
import { resolveEffectPalette } from "../spectrum/effect-palette";
export interface LyricPalette {
  sung: string;
  unsung: string;
  accent: string;
  glow: string;
  shadow: string;
  prism: readonly [string, string, string];
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
export function lyricPalette(
  settings: Pick<SpectrumSettings, "effect" | "music" | "color"> = defaults,
  cardAccent?: string,
): LyricPalette {
  const p = resolveEffectPalette(settings);
  const accent = cardAccent ? mix(p.accent, cardAccent, 0.32) : p.accent;
  return {
    sung: mix(p.high, "#f1f4ed", 0.28),
    unsung: mix(p.main, p.high, 0.34),
    accent,
    glow: mix(p.main, p.high, 0.5),
    shadow: mix(p.low, "#020508", 0.65),
    prism: [
      mix(p.main, "#9af3de", 0.2),
      mix(accent, "#d3b5ef", 0.18),
      mix(p.high, accent, 0.4),
    ],
  };
}
export const defaultLyricPalette = lyricPalette();
