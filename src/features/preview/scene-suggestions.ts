import { defaults, type SpectrumSettings, type RegionStyle, type SceneBounds, type SpectrumEffect } from '../spectrum/model'
import { regionStyle } from '../spectrum/regions'
import { luminance, suggestPalette } from './wallpaper-palette'
import { recommendedMusic } from '../spectrum/effect-presets'

export type SceneComposition = RegionStyle & Pick<SpectrumSettings, 'regionName' | 'regionVisible' | 'regions'>
export interface SceneSuggestion { id: string; name: string; description: string; layers: RegionStyle[] }
export interface WallpaperAnalysis { key: string; suggestions: SceneSuggestion[] }
export const composition = (settings: SpectrumSettings): SceneComposition => structuredClone({ ...regionStyle(settings), regionName: settings.regionName, regionVisible: settings.regionVisible, regions: settings.regions })

// Palette swatches also serve ordinary shapes, where dark colors are useful on
// light wallpaper. Emissive scenes need a luminous tint instead of dark halos.
function lightColor(value: string) {
  const source = value.slice(1).match(/../g)!.map(channel => parseInt(channel, 16) / 255) as [number, number, number]
  let color = source
  for (let mix = .05; luminance(color) < .42 && mix <= 1; mix += .05) {
    color = source.map(channel => channel + (1 - channel) * mix) as [number, number, number]
  }
  return '#' + color.map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')
}

// This is a low-resolution composition heuristic, not object/sky/person recognition.
export function analyzeWallpaper(data: Uint8ClampedArray, width: number, height: number): WallpaperAnalysis {
  if (width < 1 || height < 1 || data.length !== width * height * 4) throw new Error('壁纸采样不完整，请重试。')
  const light = new Float32Array(width * height), detail = new Float32Array(light.length)
  let hash = 2166136261
  for (let i = 0; i < light.length; i++) {
    light[i] = luminance([data[i * 4] / 255, data[i * 4 + 1] / 255, data[i * 4 + 2] / 255])
    for (let c = 0; c < 4; c++) hash = Math.imul(hash ^ data[i * 4 + c], 16777619)
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x
    detail[i] = Math.abs(light[i] - light[y * width + Math.max(0, x - 1)]) + Math.abs(light[i] - light[Math.max(0, y - 1) * width + x])
  }
  const scan = (bounds: SceneBounds, palette = false) => {
    let n = 0, total = 0, square = 0, edges = 0
    const pixels: number[] = []
    for (let y = Math.floor(bounds.y * height); y < Math.min(height, Math.ceil((bounds.y + bounds.height) * height)); y++) {
      for (let x = Math.floor(bounds.x * width); x < Math.min(width, Math.ceil((bounds.x + bounds.width) * width)); x++) {
        const i = y * width + x, value = light[i]
        n++; total += value; square += value * value; edges += detail[i]
        if (palette) pixels.push(...data.subarray(i * 4, i * 4 + 4))
      }
    }
    return { cost: edges / n * 2 + Math.sqrt(Math.max(0, square / n - (total / n) ** 2)) * .55, pixels }
  }
  const place = (sizes: [number, number][], preferredY: number, verticalWeight = .065, minimumCenterY = 0) => {
    let best = { x: 0, y: 0, width: sizes[0][0], height: sizes[0][1] }, score = Infinity
    for (const [w, h] of sizes) for (let row = 0; row <= 8; row++) for (let column = 0; column <= 8; column++) {
      const bounds = { x: column / 8 * (1 - w), y: row / 8 * (1 - h), width: w, height: h }
      if (bounds.y + h / 2 < minimumCenterY) continue
      const next = scan(bounds).cost + Math.abs(bounds.y + h / 2 - preferredY) * verticalWeight + Math.abs(bounds.x + w / 2 - .5) * .012 + (1 - w) * .008
      if (next < score) { best = bounds; score = next }
    }
    return best
  }
  const sky = place([[.66, .48], [.84, .5]], .28)
  const drift = place([[.54, .36], [.7, .36]], .6, .22)
  // Keep the musical ribbon in the lower half; detail still chooses its size,
  // horizontal placement and height within that band, even on busy images.
  const ribbon = place([[.72, .24], [.92, .24]], .76, .6, .55)
  const layer = (effect: SpectrumEffect, bounds: SceneBounds, accent = false): RegionStyle => {
    const colors = suggestPalette(new Uint8ClampedArray(scan(bounds, true).pixels))
    return { ...regionStyle(defaults), effect, music: recommendedMusic(effect), bounds, color: lightColor(colors[accent ? Math.min(1, colors.length - 1) : 0]?.value ?? defaults.color), reflection: 0 }
  }
  return { key: `v1-${width}x${height}-${(hash >>> 0).toString(16)}`, suggestions: [
    { id: 'starlight', name: '星光留白', description: '星点与微光，轻柔铺开', layers: [layer('dream_stars', sky)] },
    { id: 'fireflies', name: '浮光星海', description: '水母缓缓漂游，映衬细碎星点', layers: [layer('rhythm_balls', drift, true), layer('dream_stars', sky)] },
    { id: 'flow', name: '轻雪星光', description: '轻雪缓缓飘落，远星留出空白', layers: [layer('ripple', ribbon), layer('dream_stars', sky, true)] },
  ] }
}

export function composeSuggestion(suggestion: SceneSuggestion, strength: number): SceneComposition {
  const amount = Math.max(0, Math.min(100, Number.isFinite(strength) ? strength : 45)) / 100
  const layers = suggestion.layers.map((layer, index) => ({ ...layer, sceneMode: amount >= .65 ? 'immersive' as const : 'daily' as const,
    opacity: Math.round((index ? 32 : 55) + amount * (index ? 32 : 45)), sensitivity: Math.round(70 + amount * 65),
    glow: Math.round(25 + amount * 65), decay: Math.round(65 + amount * 20), reflection: layer.effect === 'ripple' ? Math.round(amount * 20) : 0,
    music: { ...layer.music, sensitivity: .5 + amount, speed: Math.min(4, Math.round(layer.music.speed * (.5 + amount * 1.5))),
      driftSpeed: layer.music.driftSpeed * (.5 + amount), rainSpeedMultiplier: layer.music.rainSpeedMultiplier * (.5 + amount),
      skinFlowSpeedMultiplier: layer.music.skinFlowSpeedMultiplier * (.5 + amount) },
    atmosphere: { ...layer.atmosphere, wind: Math.round(20 + amount * 40), fog: Math.round(30 + amount * 45), lights: Math.round(45 + amount * 50) } }))
  return { ...layers[0], regionName: suggestion.name, regionVisible: true,
    regions: layers.slice(1).map((layer, index) => ({ ...layer, id: `auto-${suggestion.id}-${index}`, name: '背景微光', visible: true })) }
}

const memoryKey = 'soundspectra.scene-choices.v1'
interface Choice { key: string; id: string; strength: number }
function choices(): Choice[] {
  const value: unknown = JSON.parse(localStorage.getItem(memoryKey) ?? '[]')
  return Array.isArray(value) ? value.filter(item => typeof item?.key === 'string' && ['starlight', 'fireflies', 'flow'].includes(item.id) && Number.isFinite(item.strength) && item.strength >= 0 && item.strength <= 100).slice(0, 30) : []
}
export function rememberedChoice(key: string) { try { return choices().find(item => item.key === key) } catch { return undefined } }
export function rememberChoice(choice: Choice) {
  let previous: Choice[] = []
  try { previous = choices() } catch { /* Replace malformed optional preferences only after a successful apply. */ }
  localStorage.setItem(memoryKey, JSON.stringify([choice, ...previous.filter(item => item.key !== choice.key)].slice(0, 30)))
}
