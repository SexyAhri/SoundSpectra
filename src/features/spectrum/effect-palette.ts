import type { SpectrumSettings } from './model'
import type { MusicEffect } from './music-engine/catalog'

export type PaletteId = SpectrumSettings['music']['fieldPalette']
export interface EffectPalette { name: string; low: string; main: string; accent: string; high: string }
const palette = (name: string, low: string, main: string, accent: string, high: string): EffectPalette => ({ name, low, main, accent, high })
// Retain the saved identifiers. Their colors belong to the effect's material,
// rather than forcing every scene into the same cyan/purple gradient.
export const effectPalettes: Record<MusicEffect, Record<PaletteId, EffectPalette>> = {
  rhythm_balls: {
    iris: palette('海盐微光', '#0c1d24', '#7fc3c9', '#b3a9d6', '#eaf7f3'),
    ember: palette('珊瑚浅梦', '#2c202b', '#d9a7b3', '#b3accf', '#f3e2df'),
    lake: palette('深蓝浮游', '#102333', '#82b1d6', '#79c5bb', '#dceff5'),
  },
  rhythm_rain: {
    iris: palette('青石细雨', '#111e27', '#7895a7', '#42676b', '#cdd5d7'),
    ember: palette('檐下灯雨', '#211d1b', '#bba486', '#7b8b91', '#e3d5bd'),
    lake: palette('雨后竹青', '#132622', '#88aa9e', '#607f8b', '#d2e2da'),
  },
  rhythm_skin: {
    iris: palette('鼠尾草亚麻', '#303b32', '#8d9b87', '#c7b69a', '#e8dfcf'),
    ember: palette('玫瑰绢', '#3c3033', '#b49097', '#c4aa98', '#ece0d5'),
    lake: palette('雾蓝缎', '#293941', '#859eaa', '#adb9b2', '#e1e7e5'),
  },
  ripple: {
    iris: palette('银雪', '#18242e', '#d9e1e5', '#a5b9c6', '#f0f3f4'),
    ember: palette('暖雪', '#28241f', '#e6dfd2', '#c4b6a3', '#f5f0e6'),
    lake: palette('蓝冰', '#182a33', '#c6dde4', '#8fadb9', '#eaf3f5'),
  },
  volume_rain: {
    iris: palette('晴日麦穗', '#4b666c', '#b99a62', '#a6cbd6', '#efe9d9'),
    ember: palette('落日蒲公英', '#6b6254', '#bd8c5d', '#d4bba2', '#f2e5c9'),
    lake: palette('薄荷晨风', '#43666b', '#729482', '#aacbd0', '#e9eee0'),
  },
  dream_stars: {
    iris: palette('银蓝星河', '#0a1220', '#93a9c8', '#d9c39a', '#eef4ff'),
    ember: palette('暖夜微星', '#221b27', '#c6b4a4', '#948ea8', '#eee3d0'),
    lake: palette('海上星光', '#0d242b', '#91bcbf', '#a6b5d0', '#e2edec'),
  },
  vortex: {
    iris: palette('孔雀暗金', '#13232c', '#5b9c9a', '#bd9c68', '#d5e6dd'),
    ember: palette('赤铜流转', '#2a1d20', '#b47c61', '#8b778f', '#e4c9ab'),
    lake: palette('深海卷流', '#10252e', '#669caf', '#7caaa0', '#cfdfdf'),
  },
  sound_field: {
    iris: palette('陶土岩层', '#29333a', '#626f78', '#be896b', '#dbccb4'),
    ember: palette('落日砂丘', '#352b2a', '#8f776b', '#cb9c72', '#ead6af'),
    lake: palette('青石山脊', '#20343a', '#5b838b', '#94afa1', '#d0ddd2'),
  },
  petal_bloom: {
    iris: palette('豆沙花笺', '#2c2529', '#ba929c', '#899d8f', '#e8ddd4'),
    ember: palette('杏花暖白', '#34291f', '#d1ad8b', '#a7aa8b', '#eee2cc'),
    lake: palette('青瓷白花', '#213533', '#9bb8ae', '#91a2b6', '#e4ece2'),
  },
  aurora_flow: {
    iris: palette('翡翠夜幕', '#10232c', '#75b59b', '#5e8eaa', '#c9dfd2'),
    ember: palette('霞光薄幕', '#2a202b', '#c1a28c', '#9e86ad', '#e5d6c8'),
    lake: palette('冰海极光', '#112934', '#6daeb4', '#7b94b6', '#ccdfdf'),
  },
  star_flight: {
    iris: palette('银蓝航线', '#101d2a', '#9abecb', '#7f9eaf', '#e0e9e9'),
    ember: palette('香槟航线', '#251e22', '#c2ab8c', '#a395a7', '#ede1cd'),
    lake: palette('青海航线', '#10262b', '#8bb8b4', '#779cae', '#dce9e5'),
  },
}

// The legacy default was never rendered as an actual tint. Treat it as the
// neutral palette input, preserving existing saved files without a schema bump.
export const neutralEffectColor = '#d4c3ff'
const mix = (from: string, to: string, amount: number) => '#' + [1, 3, 5].map(i =>
  Math.round(parseInt(from.slice(i, i + 2), 16) * (1 - amount) + parseInt(to.slice(i, i + 2), 16) * amount).toString(16).padStart(2, '0')).join('')
const cache = new Map<string, EffectPalette>()
export function resolveEffectPalette(config: Pick<SpectrumSettings, 'effect' | 'music' | 'color'>): EffectPalette {
  const base = effectPalettes[config.effect][config.music.fieldPalette]
  if (config.color.toLowerCase() === neutralEffectColor) return base
  const key = `${config.effect}:${config.music.fieldPalette}:${config.color}`
  const existing = cache.get(key)
  if (existing) return existing
  const natural = config.effect === 'ripple' || config.effect === 'volume_rain'
  // Cover transitions start/end at the legacy neutral input. Fade its influence
  // continuously so the first interpolation frame cannot flash purple.
  const distance = Math.hypot(...[1, 3, 5].map(i => (parseInt(config.color.slice(i, i + 2), 16) - parseInt(neutralEffectColor.slice(i, i + 2), 16)) / 255))
  const influence = Math.min(1, distance / .36)
  const strength = (natural ? .14 : .38) * influence
  const tinted = { ...base, main: natural?base.main:mix(base.main, config.color, strength), accent: mix(base.accent, config.color, (natural?.14:.22)*influence),
    high: base.high, low: base.low }
  if (cache.size >= 64) cache.delete(cache.keys().next().value!)
  cache.set(key, tinted)
  return tinted
}
