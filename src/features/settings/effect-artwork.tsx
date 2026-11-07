import type { SpectrumEffect } from '../spectrum/model'
import { musicEffects } from '../spectrum/music-engine/catalog'
import { effectPalettes } from '../spectrum/effect-palette'

const thumbnails = import.meta.glob('../../assets/scenes/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const captions: Record<SpectrumEffect, string> = {
  butterfly_flock: '鳞翼 · 群飞', caustic_light: '折光 · 水境', ginkgo_leaves: '金叶 · 秋风', cosmic_web: '星脉 · 暗空',
  tidal_knot: '粒子 · 流体', layered_tides: '铺展 · 层浪', echo_corridor: '穿行 · 廊道',
  rhythm_balls: '薄膜 · 漂游', rhythm_rain: '夜雨 · 涟漪', rhythm_skin: '银缎 · 回环',
  ripple: '雪片 · 景深',
  volume_rain: '种子 · 日光', dream_stars: '星云 · 尘埃', vortex: '卷吸 · 旋流',
  sound_field: '岩层 · 起伏', petal_bloom: '薄瓣 · 花冠', aurora_flow: '薄幕 · 流动', star_flight: '穿行 · 纵深',
}
export const effectCatalog = Object.fromEntries(musicEffects.map(effect => [effect.value, {
  label: effect.label, caption: captions[effect.value], color: effectPalettes[effect.value].iris.main,
}])) as Record<SpectrumEffect, { label: string; caption: string; color: string }>

/** Captures of the real renderer, using each effect's recommended appearance. */
export function EffectArtwork({ effect }: { effect: SpectrumEffect }) {
  return <img className="effect-art" src={thumbnails[`../../assets/scenes/${effect}.webp`]} alt="" aria-hidden="true" />
}
