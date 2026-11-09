import type { MusicEffectAppearance } from "./types";
import { luminousDefaults, normalizeLuminous } from "./luminous-appearance";

/** 三维音乐场景的共享默认值，保留已保存参数的范围与格式。 */
export const MUSIC_EFFECT_DEFAULTS = Object.freeze({
  ...luminousDefaults,
  ambientDensity: 1,
  ambientSpread: 1,
  fieldScale: 1.35,
  fieldHeight: 1,
  fieldBrightness: 45,
  fieldSpread: 1,
  fieldDrops: 4,
  fieldPalette: "iris" as const,
  fieldRippleMode: "rain" as const,
  ballSpeedMultiplier: 1.5,
  rainSpeedMultiplier: 1.2,
  skinFlowSpeedMultiplier: 1.3,
  sensitivity: 1,
  response: "balanced" as const,
  ballRadiusMultiplier: 1,
  ballCount: 5,
  ballTrail: 0.15,
  rainRadiusMultiplier: 1,
  rainCount: 10,
  rainDirection: "left" as const,
  dragonWidth: 1,
  dragonTrail: 4,
  dragonBurst: 1,
  rippleWidth: 1,
  rippleTwist: 1,
  rippleLights: 2,
  meteorDensity: 72,
  meteorTrail: 1,
  meteorAngle: 25,
  starCount: 128,
  starDepth: 1,
  starTrail: 1,
  vortexArms: 4,
  vortexRange: 1,
  vortexWidth: 1,
});

export function normalizeMusicAppearance(
  value: Partial<MusicEffectAppearance> = {},
): MusicEffectAppearance {
  type NumericKey = Exclude<
    keyof MusicEffectAppearance,
    "response" | "rainDirection" | "fieldPalette" | "fieldRippleMode"
  >;
  const number = (key: NumericKey, min: number, max: number) => {
    const next = value[key];
    return typeof next === "number" && Number.isFinite(next)
      ? Math.max(min, Math.min(max, next))
      : MUSIC_EFFECT_DEFAULTS[key];
  };
  return {
    ...normalizeLuminous(value),
    ambientDensity: number("ambientDensity", 0.5, 2),
    ambientSpread: number("ambientSpread", 0.6, 1.8),
    fieldScale: number("fieldScale", 0.8, 2),
    fieldHeight: number("fieldHeight", 0.3, 2),
    fieldBrightness: number("fieldBrightness", 15, 90),
    fieldSpread: number("fieldSpread", 0.5, 1.8),
    fieldDrops: Math.round(number("fieldDrops", 1, 8)),
    fieldPalette:
      value.fieldPalette === "ember" || value.fieldPalette === "lake"
        ? value.fieldPalette
        : "iris",
    fieldRippleMode: value.fieldRippleMode === "center" ? "center" : "rain",
    ballSpeedMultiplier: number("ballSpeedMultiplier", 0.1, 5),
    rainSpeedMultiplier: number("rainSpeedMultiplier", 0.1, 5),
    skinFlowSpeedMultiplier: number("skinFlowSpeedMultiplier", 0.1, 10),
    sensitivity: number("sensitivity", 0.5, 2),
    response:
      value.response === "soft" || value.response === "responsive"
        ? value.response
        : "balanced",
    ballRadiusMultiplier: number("ballRadiusMultiplier", 0.5, 2),
    ballCount: Math.round(number("ballCount", 3, 7)),
    ballTrail: number("ballTrail", 0, 1),
    rainRadiusMultiplier: number("rainRadiusMultiplier", 0.5, 2),
    rainCount: Math.round(number("rainCount", 5, 20)),
    rainDirection:
      value.rainDirection === "down" || value.rainDirection === "right"
        ? value.rainDirection
        : "left",
    dragonWidth: number("dragonWidth", 0.5, 2),
    dragonTrail: Math.round(number("dragonTrail", 0, 8)),
    dragonBurst: number("dragonBurst", 0, 2),
    rippleWidth: number("rippleWidth", 0.5, 2),
    rippleTwist: number("rippleTwist", -1.5, 1.5),
    rippleLights: Math.round(number("rippleLights", 1, 4)),
    meteorDensity: Math.round(number("meteorDensity", 24, 96)),
    meteorTrail: number("meteorTrail", 0.5, 2),
    meteorAngle: Math.round(number("meteorAngle", -45, 45)),
    starCount: Math.round(number("starCount", 64, 192)),
    starDepth: number("starDepth", 0.5, 2),
    starTrail: number("starTrail", 0, 2),
    vortexArms: Math.round(number("vortexArms", 2, 5)),
    vortexRange: number("vortexRange", 0.5, 1.3),
    vortexWidth: number("vortexWidth", 0.5, 2),
  };
}

/** 弹球与落雨沿用桌面的 0–4 档，0 档为慢速而非暂停。 */
export function musicSpeedSettings(speed: number) {
  const gear = Number.isFinite(speed)
    ? Math.max(0, Math.min(4, Math.round(speed)))
    : 4;
  const ratio = (gear + 1) / 5;
  return {
    ballSpeedMultiplier: 5 * ratio,
    rainSpeedMultiplier: 3 * ratio,
  };
}
