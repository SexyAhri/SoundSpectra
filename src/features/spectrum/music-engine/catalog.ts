import {
  MUSIC_EFFECT_DEFAULTS,
  normalizeMusicAppearance,
} from "./musicAppearance";
import type { MusicEffectAppearance } from "./types";

export const musicEffects = [
  { value: "rhythm_balls", label: "浮光水母" },
  { value: "rhythm_rain", label: "落雨" },
  { value: "window_rain", label: "窗前听雨" },
  { value: "rhythm_skin", label: "风织绸境" },
  { value: "ripple", label: "雪花飘舞" },
  { value: "volume_rain", label: "晴空浮游" },
  { value: "dream_stars", label: "银河" },
  { value: "vortex", label: "旋涡" },
  { value: "sound_field", label: "频谱回响" },
  { value: "petal_bloom", label: "星瓣花境" },
  { value: "aurora_flow", label: "极光流域" },
  { value: "star_flight", label: "星尘航道" },
  { value: "tidal_knot", label: "潮汐之结" },
  { value: "layered_tides", label: "层海" },
  { value: "echo_corridor", label: "回声廊道" },
  { value: "butterfly_flock", label: "风栖蝶群" },
  { value: "caustic_light", label: "水光焦散" },
  { value: "ginkgo_leaves", label: "秋光银杏" },
  { value: "cosmic_web", label: "星脉旷野" },
] as const;
export type MusicEffect = (typeof musicEffects)[number]["value"];
export const classicMusicEffects = musicEffects.filter((effect) =>
  [
    "rhythm_balls",
    "rhythm_rain",
    "window_rain",
    "rhythm_skin",
    "ripple",
    "volume_rain",
    "dream_stars",
    "vortex",
    "butterfly_flock",
    "caustic_light",
    "ginkgo_leaves",
    "cosmic_web",
  ].includes(effect.value),
);
export const ambientEffects = [
  "petal_bloom",
  "aurora_flow",
  "star_flight",
] as const;
export type AmbientEffect = (typeof ambientEffects)[number];
export const compositionEffects = [
  "tidal_knot",
  "layered_tides",
  "echo_corridor",
] as const;
export type CompositionEffect = (typeof compositionEffects)[number];
export type ClassicEffect = Exclude<
  MusicEffect,
  AmbientEffect | CompositionEffect | "sound_field"
>;
export type ThreeEffect = MusicEffect;
export const threeEffects = musicEffects.map((effect) => effect.value);
export const isThreeEffect = (value: string): value is ThreeEffect =>
  (threeEffects as readonly string[]).includes(value);
export const isAmbientEffect = (value: string): value is AmbientEffect =>
  (ambientEffects as readonly string[]).includes(value);
export const isClassicEffect = (value: string): value is ClassicEffect =>
  classicMusicEffects.some((effect) => effect.value === value);
export type MusicSettings = MusicEffectAppearance & { speed: number };
export const defaultMusicSettings: MusicSettings = {
  ...MUSIC_EFFECT_DEFAULTS,
  speed: 2,
};
export function normalizeMusicSettings(value: unknown): MusicSettings {
  const source =
    value && typeof value === "object" ? (value as Partial<MusicSettings>) : {};
  return {
    ...normalizeMusicAppearance(source),
    speed:
      typeof source.speed === "number" && Number.isFinite(source.speed)
        ? Math.max(0, Math.min(4, Math.round(source.speed)))
        : 2,
  };
}
