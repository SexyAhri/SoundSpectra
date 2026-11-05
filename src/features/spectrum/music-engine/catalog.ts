import { MUSIC_EFFECT_DEFAULTS, normalizeMusicAppearance } from './musicAppearance'
import type { MusicEffectAppearance } from './types'

export const musicEffects = [
  { value: 'rhythm_balls', label: '弹球' },
  { value: 'rhythm_rain', label: '落雨' },
  { value: 'rhythm_fluid', label: '熔金潮汐' },
  { value: 'rhythm_skin', label: '风织绸境' },
  { value: 'spectrum_bars', label: '频谱柱' },
  { value: 'ripple', label: '雪花飘舞' },
  { value: 'pulse_ring', label: '脉冲光环' },
  { value: 'volume_rain', label: '晴空浮游' },
  { value: 'dream_stars', label: '梦幻星空' },
  { value: 'vortex', label: '旋涡' },
  { value: 'water_ripple', label: '水波纹' },
  { value: 'rhythm_bars', label: '丹霞声谷' },
  { value: 'sound_field', label: '频谱回响' },
  { value: 'petal_bloom', label: '星瓣花境' },
  { value: 'aurora_flow', label: '极光流域' },
  { value: 'star_flight', label: '星尘航道' },
] as const
export type MusicEffect = typeof musicEffects[number]['value']
export const classicMusicEffects = musicEffects.slice(0, 12)
export const ambientEffects = ['petal_bloom', 'aurora_flow', 'star_flight'] as const
export type AmbientEffect = typeof ambientEffects[number]
export type ClassicEffect = Exclude<MusicEffect, AmbientEffect | 'sound_field'>
export type ThreeEffect = MusicEffect
export const threeEffects = musicEffects.map(effect => effect.value)
export const isThreeEffect = (value: string): value is ThreeEffect => (threeEffects as readonly string[]).includes(value)
export const isAmbientEffect = (value: string): value is AmbientEffect => (ambientEffects as readonly string[]).includes(value)
export const isClassicEffect = (value: string): value is ClassicEffect => classicMusicEffects.some(effect => effect.value === value)
export type MusicSettings = MusicEffectAppearance & { speed: number }
export const defaultMusicSettings: MusicSettings = { ...MUSIC_EFFECT_DEFAULTS, speed: 4 }
export function normalizeMusicSettings(value: unknown): MusicSettings {
  const source = value && typeof value === 'object' ? value as Partial<MusicSettings> : {}
  return { ...normalizeMusicAppearance(source), speed: typeof source.speed === 'number' && Number.isFinite(source.speed) ? Math.max(0, Math.min(4, Math.round(source.speed))) : 4 }
}
