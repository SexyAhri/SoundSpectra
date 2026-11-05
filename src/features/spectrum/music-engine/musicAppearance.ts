import type { MusicEffectAppearance } from './types';

/** 三维音乐场景的共享默认值，保留已保存参数的范围与格式。 */
export const MUSIC_EFFECT_DEFAULTS = Object.freeze({
  ambientDensity: 1,
  ambientSpread: 1,
  fieldScale: 1.35,
  fieldHeight: 1,
  fieldBrightness: 45,
  fieldSpread: 1,
  fieldDrops: 4,
  fieldPalette: 'iris' as const,
  fieldRippleMode: 'rain' as const,
  intensityWindowMs: 1000,
  fluidBrightnessThreshold: 8,
  ballSpeedMultiplier: 5,
  rainSpeedMultiplier: 3,
  fluidSpeedMultiplier: 1,
  skinFlowSpeedMultiplier: 4,
  sensitivity: 2,
  response: 'balanced' as const,
  ballRadiusMultiplier: 2,
  ballCount: 5,
  ballTrail: 0.35,
  rainRadiusMultiplier: 2,
  rainCount: 10,
  rainDirection: 'left' as const,
  fluidCount: 2,
  fluidWidth: 1,
  sourceFluidFadeSpeed: 30,
  dragonWidth: 1,
  dragonTrail: 4,
  dragonBurst: 1,
  spectrumTracks: 28,
  spectrumAmplitude: 1,
  spectrumNoteDensity: 1,
  rippleWidth: 1,
  rippleTwist: 1,
  rippleLights: 2,
  pulseRange: 1,
  pulseImpact: 1,
  pulseParticles: 8,
  meteorDensity: 72,
  meteorTrail: 1,
  meteorAngle: 25,
  starCount: 128,
  starDepth: 1,
  starTrail: 1,
  vortexArms: 4,
  vortexRange: 1,
  vortexWidth: 1,
  waterDrops: 4,
  waterRange: 1,
  waterEchoes: 3,
});

export function normalizeMusicAppearance(
  value: Partial<MusicEffectAppearance> = {}
): MusicEffectAppearance {
  type NumericKey = Exclude<keyof MusicEffectAppearance, 'response' | 'rainDirection' | 'fieldPalette' | 'fieldRippleMode'>;
  const number = (key: NumericKey, min: number, max: number) => {
    const next = value[key];
    return typeof next === 'number' && Number.isFinite(next)
      ? Math.max(min, Math.min(max, next))
      : MUSIC_EFFECT_DEFAULTS[key];
  };
  return {
    ambientDensity: number('ambientDensity', .5, 2),
    ambientSpread: number('ambientSpread', .6, 1.8),
    fieldScale: number('fieldScale', .8, 2),
    fieldHeight: number('fieldHeight', .3, 2),
    fieldBrightness: number('fieldBrightness', 15, 90),
    fieldSpread: number('fieldSpread', .5, 1.8),
    fieldDrops: Math.round(number('fieldDrops', 1, 8)),
    fieldPalette: value.fieldPalette === 'ember' || value.fieldPalette === 'lake' ? value.fieldPalette : 'iris',
    fieldRippleMode: value.fieldRippleMode === 'center' ? 'center' : 'rain',
    intensityWindowMs: number('intensityWindowMs', 100, 3000),
    fluidBrightnessThreshold: number('fluidBrightnessThreshold', 0, 20),
    ballSpeedMultiplier: number('ballSpeedMultiplier', 0.1, 5),
    rainSpeedMultiplier: number('rainSpeedMultiplier', 0.1, 5),
    fluidSpeedMultiplier: number('fluidSpeedMultiplier', 0.1, 5),
    skinFlowSpeedMultiplier: number('skinFlowSpeedMultiplier', 0.1, 10),
    sensitivity: number('sensitivity', 0.5, 2),
    response:
      value.response === 'soft' || value.response === 'responsive' ? value.response : 'balanced',
    ballRadiusMultiplier: number('ballRadiusMultiplier', 0.5, 2),
    ballCount: Math.round(number('ballCount', 3, 7)),
    ballTrail: number('ballTrail', 0, 1),
    rainRadiusMultiplier: number('rainRadiusMultiplier', 0.5, 2),
    rainCount: Math.round(number('rainCount', 5, 20)),
    rainDirection:
      value.rainDirection === 'down' || value.rainDirection === 'right'
        ? value.rainDirection
        : 'left',
    fluidCount: Math.round(number('fluidCount', 1, 3)),
    fluidWidth: number('fluidWidth', 0.5, 2),
    sourceFluidFadeSpeed: number('sourceFluidFadeSpeed', .5, 50),
    dragonWidth: number('dragonWidth', 0.5, 2),
    dragonTrail: Math.round(number('dragonTrail', 0, 8)),
    dragonBurst: number('dragonBurst', 0, 2),
    spectrumTracks: Math.round(number('spectrumTracks', 12, 40)),
    spectrumAmplitude: number('spectrumAmplitude', 0.5, 1.5),
    spectrumNoteDensity: Math.round(number('spectrumNoteDensity', 0, 3)),
    rippleWidth: number('rippleWidth', 0.5, 2),
    rippleTwist: number('rippleTwist', -1.5, 1.5),
    rippleLights: Math.round(number('rippleLights', 1, 4)),
    pulseRange: number('pulseRange', 0.5, 1.5),
    pulseImpact: number('pulseImpact', 0, 2),
    pulseParticles: Math.round(number('pulseParticles', 4, 16) / 2) * 2,
    meteorDensity: Math.round(number('meteorDensity', 24, 96)),
    meteorTrail: number('meteorTrail', 0.5, 2),
    meteorAngle: Math.round(number('meteorAngle', -45, 45)),
    starCount: Math.round(number('starCount', 64, 192)),
    starDepth: number('starDepth', 0.5, 2),
    starTrail: number('starTrail', 0, 2),
    vortexArms: Math.round(number('vortexArms', 2, 5)),
    vortexRange: number('vortexRange', 0.5, 1.3),
    vortexWidth: number('vortexWidth', 0.5, 2),
    waterDrops: Math.round(number('waterDrops', 2, 6)),
    waterRange: number('waterRange', 0.5, 1.5),
    waterEchoes: Math.round(number('waterEchoes', 1, 4)),
  };
}

/** 弹球与落雨沿用桌面的 0–4 档，0 档为慢速而非暂停。 */
export function musicSpeedSettings(speed: number) {
  const gear = Number.isFinite(speed) ? Math.max(0, Math.min(4, Math.round(speed))) : 4;
  const ratio = (gear + 1) / 5;
  return {
    ballSpeedMultiplier: 5 * ratio,
    rainSpeedMultiplier: 3 * ratio,
  };
}
