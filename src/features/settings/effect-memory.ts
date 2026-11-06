import type { SpectrumSettings } from '../spectrum/model'
import { musicEffects, normalizeMusicSettings, type MusicEffect, type MusicSettings } from '../spectrum/music-engine/catalog'
import { neutralEffectColor } from '../spectrum/effect-palette'
import { recommendedMusic } from '../spectrum/effect-presets'

const key = 'soundspectra.effect-looks.v1'
interface Look { scope: string; effect: MusicEffect; color: string; music: MusicSettings }
function read(): Look[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return (Array.isArray(data) ? data : []).filter(item => item && typeof item.scope === 'string' && item.scope.length <= 64
      && musicEffects.some(effect => effect.value === item.effect) && /^#[0-9a-f]{6}$/i.test(item.color)
      && item.music && typeof item.music === 'object').slice(0, 80)
      .map(item => ({ scope: item.scope, effect: item.effect, color: item.color, music: normalizeMusicSettings(item.music) }))
  } catch { return [] }
}

// Optional UI history, scoped to a region. The actual selected appearance still
// saves through the normal settings transaction and scene collection.
export function selectEffect(current: SpectrumSettings, effect: MusicEffect, scope: string): Partial<SpectrumSettings> {
  if (current.effect === effect) return {}
  const previous = read(), remembered = previous.find(item => item.scope === scope && item.effect === effect)
  try {
    localStorage.setItem(key, JSON.stringify([{ scope, effect: current.effect, color: current.color, music: current.music },
      ...previous.filter(item => item.scope !== scope || item.effect !== current.effect)].slice(0, 80)))
  } catch { /* Optional history must not prevent selecting or saving an effect. */ }
  return { effect, music: remembered?.music ?? recommendedMusic(effect), color: remembered?.color ?? neutralEffectColor, followCover: current.followCover }
}
