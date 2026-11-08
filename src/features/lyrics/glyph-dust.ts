import { lyricFont, type LyricFontStyle } from './lyric-typography'
import type { LyricPalette } from './lyric-palette'

export interface InkPoint { x: number; y: number; seed: number }
const fract = (n: number) => n - Math.floor(n)

/** Deterministic sampling of opaque ink, bounded independently of source mask size. */
export function sampleInk(data: Uint8ClampedArray, width: number, height: number, limit: number): InkPoint[] {
  const points: InkPoint[] = []
  let seen = 0
  for (let y = 1; y < height; y += 2) for (let x = 1; x < width; x += 2) {
    if (data[(y * width + x) * 4 + 3] < 160) continue
    const seed = fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453)
    const point = { x, y, seed }; seen++
    if (points.length < limit) points.push(point)
    else { const slot = Math.floor(seed * seen); if (slot < limit) points[slot] = point }
  }
  return points
}

/** Small masks are cached per glyph/font, never read back from the presentation canvas. */
export class GlyphDust {
  private cache = new Map<string, { points: InkPoint[]; width: number }>()
  clear() { this.cache.clear() }
  prepare(text: string, style: LyricFontStyle, weight: number) {
    const key = `${style}:${weight}:${text}`
    let mask = this.cache.get(key)
    if (!mask) {
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.font = lyricFont(64, style, weight)
      canvas.width = Math.ceil(ctx.measureText(text).width) + 16; canvas.height = 96
      ctx.font = lyricFont(64, style, weight); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(text, canvas.width / 2, 48)
      mask = { width: canvas.width, points: sampleInk(ctx.getImageData(0, 0, canvas.width, 96).data, canvas.width, 96, 96) }
      this.cache.set(key, mask)
      if (this.cache.size > 192) this.cache.delete(this.cache.keys().next().value!)
    }
    return mask
  }
  draw(ctx: CanvasRenderingContext2D, text: string, size: number, style: LyricFontStyle, weight: number,
    release: number, palette: LyricPalette, limit: number, accent: number, flow: 'flight' | 'aurora' | 'drift' = 'drift') {
    if (release <= 0 || release >= 1) return 0
    const mask = this.prepare(text, style, weight)
    const count = Math.min(mask.points.length, limit), scale = size / 64
    for (let i = 0; i < count; i++) {
      const point = mask.points[Math.floor(i * mask.points.length / count)]
      const delay = point.x / mask.width * .32
      const age = Math.max(0, (release - delay) / (1 - delay))
      if (!age) continue
      const travel = age * age, side = point.seed > .5 ? 1 : -1
      const x = (point.x - mask.width / 2) * scale
      const y = (point.y - 48) * scale
      // Captured accents brighten a spark without pulling an already-released point back.
      const reach = size * (1.8 + point.seed * 2)
      const dx = flow === 'flight' ? side * reach * travel : reach * travel
      const dy = flow === 'aurora' ? -reach * age * .7 + Math.sin(age * 5 + point.seed * 6) * size * age * .3
        : -reach * travel * (.3 + point.seed * .5)
      ctx.globalAlpha = Math.min(1, Math.sin(Math.min(1, age * 5) * Math.PI / 2) * (1 - age) ** 1.4 * (.85 + accent * .12))
      ctx.fillStyle = palette.prism[i % 3]
      const radius = Math.max(.65, size * .016) * (1 - age * .6) * (1 + accent * .2)
      ctx.fillRect(x + dx, y + dy, radius, radius)
    }
    return count
  }
}
