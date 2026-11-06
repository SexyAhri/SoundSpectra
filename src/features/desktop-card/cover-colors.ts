import { luminance, suggestPalette } from '../preview/wallpaper-palette'

const channels = (color: string) => color.slice(1).match(/../g)!.map(value => parseInt(value, 16))
export const mixColor = (from: string, to: string, amount: number) => '#' + channels(from).map((value, i) =>
  Math.round(value + (channels(to)[i] - value) * Math.max(0, Math.min(1, amount))).toString(16).padStart(2, '0')).join('')

export function coverAccent(pixels: Uint8ClampedArray): string | null {
  let count = 0
  const sum = [0, 0, 0], square = [0, 0, 0]
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue
    count++
    for (let c = 0; c < 3; c++) { sum[c] += pixels[i + c]; square[c] += pixels[i + c] ** 2 }
  }
  // Missing/flat placeholder artwork should keep the user's chosen palette.
  if (!count || sum.every((value, c) => square[c] / count - (value / count) ** 2 < 36)) return null
  const primary = suggestPalette(pixels).find(color => color.label === '呼应')?.value
  if (!primary) return null
  let color = mixColor(primary, '#bdc5c2', .18)
  for (let i = 0; i < 12 && luminance(channels(color).map(v => v / 255) as [number, number, number]) < .35; i++) color = mixColor(color, '#eeeae2', .12)
  return color
}

const cache = new Map<string, Promise<string | null>>()
export function readCoverAccent(cover: string): Promise<string | null> {
  const existing = cache.get(cover)
  if (existing) return existing
  const task = (async () => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    let timer = 0
    try {
      image.src = cover
      await Promise.race([image.decode(), new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(Error('封面读取超时')), 5000)
      })])
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 48
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw Error('无法读取封面颜色')
      context.drawImage(image, 0, 0, 48, 48)
      return coverAccent(context.getImageData(0, 0, 48, 48).data)
    } finally { clearTimeout(timer); image.src = '' }
  })()
  cache.set(cover, task)
  if (cache.size > 6) cache.delete(cache.keys().next().value!)
  void task.catch(() => { if (cache.get(cover) === task) cache.delete(cover) })
  return task
}
