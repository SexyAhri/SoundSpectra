import type { TimedGlyph } from './lyric-glyphs'
import type { LyricPalette } from './lyric-palette'

export type LyricFontStyle = 'modern' | 'poetry'
export type LyricTypeMode = 'depth' | 'stage' | 'folded' | 'stardust'
export const lyricFamilies = {
  modern: '"Noto Sans SC Variable", "Microsoft YaHei", sans-serif',
  poetry: '"Noto Serif SC Variable", "Songti SC", SimSun, serif',
}
export const lyricFont = (size: number, style: LyricFontStyle = 'modern', weight = 400) => `${weight} ${size}px ${lyricFamilies[style]}`

/** Optical weight follows the actual screen size, including shallow lyric regions. */
export function lyricWeight(style: LyricFontStyle, size: number, mode: LyricTypeMode, row = 0) {
  const small = Math.max(0, Math.min(1, (30 - size) / 16))
  return Math.round((style === 'poetry' ? 430 : 400) + small * (style === 'poetry' ? 130 : 100)
    + (mode === 'stage' && row === 1 ? 55 : 0))
}

const latin = (text: string) => /^[\p{Script=Latin}\p{Number}'’\-]+$/u.test(text)
const cjk = (text: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)
const punctuation = (text: string) => /^\p{P}+$/u.test(text)
const segments = new Intl.Segmenter(undefined, { granularity: 'word' })

/** Shared advances keep Latin kerning/word spaces natural and add air between CJK phrases. */
export function measureLyricGlyphs(ctx: CanvasRenderingContext2D, glyphs: TimedGlyph[], size: number,
  style: LyricFontStyle, mode: LyricTypeMode, weight: number) {
  const starts = new Set([...segments.segment(glyphs.map(g => g.text).join(''))].map(s => s.index))
  let offset = 0
  return glyphs.map((g, i) => {
    const previous = glyphs[i - 1], next = glyphs[i + 1]
    const isLatin = latin(g.text), scale = isLatin ? style === 'poetry' ? 1.065 : 1.035 : 1
    ctx.font = lyricFont(size * scale, style, weight)
    const ink = ctx.measureText(g.text).width
    const kern = isLatin && previous && latin(previous.text)
      ? ctx.measureText(previous.text + g.text).width - ctx.measureText(previous.text).width - ink : 0
    const boundary = starts.has(offset) && previous && cjk(previous.text) && cjk(g.text)
    const tracking = cjk(g.text) && next && cjk(next.text)
      ? size * ((mode === 'depth' ? .052 : mode === 'folded' ? .043 : .025) + (style === 'poetry' ? .018 : 0)) : 0
    const gap = boundary ? size * (mode === 'depth' ? .055 : .035) : 0
    offset += g.text.length
    const width = g.hidden ? size * .27 : !g.text.trim() ? size * .30 : ink
    return { width, advance: Math.max(0, width + tracking + kern + gap), leading: kern + gap,
      scale, baseline: isLatin ? -size * .018 : 0, opacity: punctuation(g.text) ? .66 : 1 }
  })
}

const mix = (a: string, b: string, t: number) => '#' + [1, 3, 5].map(i => Math.round(
  parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')

/** The light is ink: one clipped fill, no duplicate letters or blurred shadows. */
export function lyricInk(ctx: CanvasRenderingContext2D, palette: LyricPalette, width: number, size: number,
  sung: number, progress: number, active: boolean, reduced: boolean, offset = 0) {
  const base = mix(mix(palette.unsung, '#f6f0e5', .48), mix(palette.sung, '#fff8ea', .70), sung)
  if (reduced || !active) return base
  const center = (progress - .5) * width
  const ink = ctx.createLinearGradient(-width / 2 - offset, -size * .24, width / 2 - offset, size * .24)
  const peak = Math.max(.12, Math.min(.88, center / Math.max(1, width) + .5))
  ink.addColorStop(0, base)
  ink.addColorStop(Math.max(.001, peak - .12), mix(base, palette.prism[0], .26))
  ink.addColorStop(peak, mix(base, palette.prism[2], .58))
  ink.addColorStop(Math.min(.999, peak + .10), mix(base, palette.prism[1], .36))
  ink.addColorStop(1, base)
  return ink
}
