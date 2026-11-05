import type { PreviewImage, ScreenRect, wallpaperPlacement } from './background'

type Rgb = [number, number, number]
export interface SuggestedColor { label: string; value: string }
export const luminance = ([r, g, b]: Rgb) => {
  const linear = (n: number) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4
  return linear(r) * .2126 + linear(g) * .7152 + linear(b) * .0722
}
const hex = (color: Rgb) => '#' + color.map(n => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')).join('')
function hsl([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2
  if (!d) return [0, 0, l]
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, d / (1 - Math.abs(2 * l - 1)), l]
}
function rgb([h, s, l]: Rgb): Rgb {
  const a = s * Math.min(l, 1 - l)
  const component = (n: number) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)) }
  return [component(0), component(8), component(4)]
}

// Small histogram, no image library or continuous sampling. Suggestions are
// brightness-adjusted colors, not a promise of text contrast on every pixel.
export function suggestPalette(pixels: Uint8ClampedArray): SuggestedColor[] {
  const bins = new Map<number, { count: number; color: Rgb }>()
  let light = 0, count = 0
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue
    const color: Rgb = [pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255]
    light += luminance(color); count++
    const key = (pixels[i] >> 5) * 64 + (pixels[i + 1] >> 5) * 8 + (pixels[i + 2] >> 5)
    const bin = bins.get(key) ?? { count: 0, color: [0, 0, 0] as Rgb }
    bin.count++; for (let c = 0; c < 3; c++) bin.color[c] += color[c]
    bins.set(key, bin)
  }
  if (!count) return []
  light /= count
  const brighten = 1.05 / (light + .05) >= (light + .05) / .05
  const adapt = (color: Rgb) => {
    const [h, s, l] = hsl(color)
    let result = color
    for (let step = 0; step <= 50; step++) {
      result = rgb([h, Math.min(s, .8), Math.max(.07, Math.min(.94, l + step * (brighten ? .02 : -.02)))])
      const current = luminance(result)
      if ((Math.max(current, light) + .05) / (Math.min(current, light) + .05) >= 2.7) break
    }
    return hex(result)
  }
  const ranked = [...bins.values()].map(bin => ({ ...bin, color: bin.color.map(n => n / bin.count) as Rgb }))
    .filter(bin => Math.max(...bin.color) - Math.min(...bin.color) > .07)
    .sort((a, b) => b.count * (.3 + hsl(b.color)[1]) - a.count * (.3 + hsl(a.color)[1]))
  const suggestions: SuggestedColor[] = []
  if (ranked.length) {
    const primary = ranked[0].color, [h, s, l] = hsl(primary)
    const secondary = ranked.slice(1).find(bin => Math.hypot(...bin.color.map((n, i) => n - primary[i])) > .35)?.color
    suggestions.push({ label: '呼应', value: adapt(primary) }, { label: '点缀', value: adapt(secondary ?? rgb([(h + .5) % 1, s * .8, l])) })
  }
  suggestions.push({ label: '明暗', value: brighten ? '#edf2ff' : '#202637' })
  return suggestions.filter((item, i, all) => all.findIndex(other => other.value === item.value) === i)
}

export async function readWallpaperPixels(image: PreviewImage | null, placement: ReturnType<typeof wallpaperPlacement> | null, screen: ScreenRect, background: string) {
  const canvas = document.createElement('canvas')
  const scale = 128 / Math.max(screen.width, screen.height)
  canvas.width = Math.max(1, Math.round(screen.width * scale)); canvas.height = Math.max(1, Math.round(screen.height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法读取图片颜色')
  context.fillStyle = background; context.fillRect(0, 0, canvas.width, canvas.height)
  if (image && placement) {
    const source = new Image(); source.src = image.url
    try { await source.decode() } catch { throw new Error('图片取色失败') }
    const { x, y, width, height, tile } = placement
    if (tile) {
      // Transform the pattern instead of looping potentially millions of tiny tiles.
      const pattern = context.createPattern(source, 'repeat')
      if (!pattern) throw new Error('无法读取平铺图片颜色')
      pattern.setTransform(new DOMMatrix().scale(width * scale / source.naturalWidth, height * scale / source.naturalHeight))
      context.fillStyle = pattern; context.fillRect(0, 0, canvas.width, canvas.height)
    } else context.drawImage(source, x * scale, y * scale, width * scale, height * scale)
  }
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  canvas.width = canvas.height = 1
  return pixels
}

export async function sampleWallpaper(image: PreviewImage | null, placement: ReturnType<typeof wallpaperPlacement> | null, screen: ScreenRect, background: string) {
  const palette = suggestPalette((await readWallpaperPixels(image, placement, screen, background)).data)
  if (!palette.length) throw new Error('未能识别图片颜色')
  return palette
}
