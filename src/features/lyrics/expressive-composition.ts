import type { CompositionFrame } from './kinetic-composition'
import { phrases, timedGlyphs, type TimedGlyph } from './lyric-glyphs'
import { defaultLyricPalette, type LyricPalette } from './lyric-palette'
import type { LyricLine } from './model'
import { drawPrismaticLight } from './prismatic-light'
import { lyricFont, lyricInk, lyricWeight, measureLyricGlyphs } from './lyric-typography'

type Frame = CompositionFrame & { mode: 'depth' | 'stage' }
interface Glyph extends TimedGlyph { x: number; y: number; width: number; size: number; row: number; order: number; weight: number; baseline: number; opacity: number }
interface Row { text: string; x: number; y: number; width: number; size: number; glyphs: Glyph[] }
interface Layout { rows: Row[]; compact: boolean; font: number }
interface Cue { intro: number; exit: number; progress: number; opacity: number; index: number; pulse: number }
const clamp = (n: number) => Math.max(0, Math.min(1, n))
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t) }
const pulseAt = (time: number, start: number) => time >= start && time - start < 650 ? Math.exp(-(time - start) / 180) : 0

function layout(ctx: CanvasRenderingContext2D, line: LyricLine, frame: Frame): Layout {
  const { width: w, height: h, mode } = frame, glyphs = timedGlyphs(line)
  const compact = h < w * .2, count = glyphs.filter(g => !g.hidden && g.text.trim()).length
  const groups = phrases(glyphs, compact || count < 6 ? 1 : mode === 'stage' && count > 15 ? 3 : 2)
  const factors = compact ? [1] : mode === 'stage' ? groups.length === 3 ? [.82, 1.12, .94] : [.86, 1.12] : [1, .92]
  const style = frame.fontStyle ?? 'modern'
  const screen = w / (1920 * frame.regionWidth) * 2.35
  const fitHeight = h * (compact ? .66 : .68) / (groups.length === 1 ? 1.1 : (groups.length - 1) * 1.55 + 1.25)
  const measure = (weights: number[]) => {
    const metrics = groups.map((group, r) => measureLyricGlyphs(ctx, group, 96, style, mode, weights[r]))
    const measures = metrics.map(items => items.map(item => item.advance))
    const widths = measures.map((items, r) => items.reduce((a, b) => a + b, 0) / 96 * factors[r])
    const fitWidth = w * (compact ? .81 : mode === 'stage' ? .72 : .76) / Math.max(1, ...widths)
    const largest = Math.min(72 * screen, fitWidth, fitHeight), smallest = Math.min(18 * screen, largest * .65)
    return { metrics, measures, widths, base: smallest + (largest - smallest) * clamp((frame.fontSize - 18) / 54) }
  }
  const first = measure(groups.map((_, r) => lyricWeight(style, Math.min(frame.fontSize * screen, h * .26), mode, r)))
  const weights = groups.map((_, r) => lyricWeight(style, first.base * factors[r], mode, r))
  const { metrics, measures, widths, base } = measure(weights)
  const rows = groups.map((group, r) => {
    const size = base * factors[r], width = widths[r] * base
    const x = compact || groups.length === 1 ? (w - width) / 2 : mode === 'depth'
      ? r % 2 ? w * .86 - width : w * .14
      : r % 2 ? Math.max(w * .12, w * .87 - width) : w * (.10 + (r === 2 ? .06 : 0))
    const y = h * .5 + (r - (groups.length - 1) / 2) * base * 1.55
    let cursor = x
    const placed = group.map((g, order) => {
      const width = measures[r][order] / 96 * size
      const metric = metrics[r][order]
      const item = { ...g, x: cursor + (metric.leading + metric.width / 2) / 96 * size, y, width,
        size: size * metric.scale, weight: weights[r], baseline: metric.baseline / 96 * size,
        opacity: metric.opacity, row: r, order }; cursor += width; return item
    })
    return { text: group.map(g => g.hidden ? ' ' : g.text).join(''), x, y, width, size, glyphs: placed }
  })
  return { rows, compact, font: base }
}

/** Production scores use only supplied media time, including their handoffs and scenery. */
export class ExpressiveComposition {
  private cache = new Map<string, Layout>()
  private document?: LyricLine[]

  private layout(ctx: CanvasRenderingContext2D, line: LyricLine, frame: Frame) {
    const key = `${frame.fontStyle}:${frame.mode}:${frame.width}:${frame.height}:${frame.fontSize}:${frame.regionWidth}:${line.start}:${line.end}:${line.text}:${line.words.map(w => `${w.start}/${w.end}/${w.text}`).join('|')}`
    let result = this.cache.get(key)
    if (!result) {
      result = layout(ctx, line, frame); this.cache.set(key, result)
      if (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value!)
    }
    return result
  }

  draw(ctx: CanvasRenderingContext2D, input: CompositionFrame): boolean {
    if (input.mode === 'stardust') return false
    const frame = input as Frame, { lines, index, time, reduced } = frame
    if (this.document !== lines) { this.cache.clear(); this.document = lines }
    const palette = frame.palette ?? defaultLyricPalette
    const visible: { line: LyricLine; layout: Layout; cue: Cue }[] = []
    for (const i of [index - 1, index, index + 1]) {
      const line = lines[i]; if (!line) continue
      const next = lines[i + 1], previous = lines[i - 1]
      // Preserve short musical breaths; clear the stage during a long instrumental gap.
      const end = next && next.start - line.end <= 1200 ? next.start : line.end
      const lead = Math.min(760, Math.max(1, line.end - line.start) * .38, previous ? (line.start - previous.start) * .5 : 760)
      const tail = Math.min(360, Math.max(1, end - line.start) * .2)
      if (reduced ? time < line.start || time >= end : time < line.start - lead || time >= end + tail) continue
      const current = i === index
      const duration = Math.max(1, end - line.start)
      const intro = reduced ? 1 : current ? .48 + .52 * smooth((time - line.start) / Math.min(300, duration * .18)) : smooth((time - line.start + lead) / lead)
      const closing = Math.min(170, duration * .12)
      const exit = reduced ? 0 : current ? smooth((time - end + closing) / closing) : smooth((time - end) / tail)
      const opacity = reduced ? 1 : (.65 + .35 * smooth((time - line.start) / 180)) * (1 - exit) ** 2
      const composition = this.layout(ctx, line, frame)
      if (!composition.rows.length) continue
      const pulse = reduced ? 0 : composition.rows.reduce((peak, row) => row.glyphs.reduce((peak, g) => Math.max(peak, pulseAt(time, g.start)), peak), 0)
      visible.push({ line, layout: composition, cue: { intro, exit, opacity, index: i, pulse, progress: clamp((time - line.start) / Math.max(1, line.end - line.start)) } })
    }
    if (!visible.length) return false
    if (!reduced) {
      const current = visible.find(v => v.cue.index === index) ?? visible[0]
      drawPrismaticLight(ctx, { ...frame, palette, energy: Math.max(...visible.map(v => v.cue.pulse)), progress: current.cue.progress })
    }
    // Neighboring cues animate the scenery; only the current sentence paints letters.
    for (const item of visible) if (item.cue.index === index) this.line(ctx, item.layout, frame, item.cue, palette)
    return visible.some(v => v.cue.index < index && v.cue.exit < 1)
  }

  private pose(g: Glyph, row: Row, composition: Layout, frame: Frame, cue: Cue) {
    const { width: w, height: h, mode, reduced } = frame
    if (reduced) return { x: g.x, y: g.y, angle: 0, scale: 1, reveal: 1 }
    const side = cue.index % 2 ? -1 : 1, enter = 1 - cue.intro
    const pulse = pulseAt(frame.time, g.start)
    if (mode === 'depth') {
      const distance = Math.max(w * .9, h * 2)
      const yaw = side * (.15 + enter * .36) * (g.row % 2 ? -.65 : 1)
      const z = (g.x - w / 2) * Math.sin(yaw) + enter * distance * .78 - cue.exit * distance * .27
        + (1 - cue.progress) * distance * .06 + g.row * composition.font * .20
      const perspective = distance / Math.max(distance * .5, distance + z)
      return { x: w / 2 + ((g.x - w / 2) * Math.cos(yaw) - side * enter * w * .12 + side * cue.progress * w * .018) * perspective,
        y: h / 2 + (g.y - h / 2 + enter * h * .14 - cue.exit * h * .72) * perspective - pulse * g.size * .025,
        angle: side * (enter * -.08 + cue.exit * .10) + (composition.compact ? 0 : (g.row % 2 ? -.018 : .018)),
        scale: perspective * (1 + pulse * .024), reveal: 1 }
    }
    const stagger = g.row * .10 + g.order / Math.max(1, row.glyphs.length - 1) * .12
    const reveal = smooth((cue.intro - stagger) / (1 - stagger))
    const moving = 1 - reveal, direction = (g.row + cue.index) % 2 ? 1 : -1
    const angle = (composition.compact ? 0 : [ -.025, .018, -.018 ][g.row]) + direction * (moving * .16 + cue.exit * .17)
    const local = g.x - (row.x + row.width / 2)
    return { x: row.x + row.width / 2 + local * Math.cos(angle) + direction * (moving * w * .20 + cue.exit * w * .09),
      y: row.y + local * Math.sin(angle) + moving * direction * (composition.compact ? h * .26 : g.size * .85) - cue.exit * direction * h * .72,
      angle, scale: 1 + pulse * .035 + cue.progress * .009, reveal }
  }

  private line(ctx: CanvasRenderingContext2D, composition: Layout, frame: Frame, cue: Cue, palette: LyricPalette) {
    const tint = palette.accent
    if (!frame.reduced) {
      this.rowAccents(ctx, composition, frame, cue, tint, palette)
    }
    for (const row of composition.rows) for (const g of row.glyphs) {
      if (g.hidden || !g.text.trim()) continue
      const pose = this.pose(g, row, composition, frame, cue)
      const sung = g.timed ? smooth((frame.time - g.start) / Math.max(1, g.end - g.start)) : frame.time >= g.start ? 1 : 0
      const word = row.glyphs.filter(item => item.start === g.start && item.end === g.end && !item.hidden)
      const first = word[0], last = word.at(-1)!
      const wordLeft = first.x - first.width / 2, wordWidth = last.x + last.width / 2 - wordLeft
      const progress = g.timed ? clamp((frame.time - g.start) / Math.max(1, g.end - g.start)) : clamp((frame.time - g.start) / 650)
      const active = frame.time >= g.start && frame.time < (g.timed ? g.end : g.start + 650)
      ctx.save(); ctx.translate(pose.x, pose.y); ctx.rotate(pose.angle); ctx.scale(pose.scale, pose.scale)
      ctx.font = lyricFont(g.size, frame.fontStyle, g.weight); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.globalAlpha = cue.opacity * g.opacity
      if (frame.mode === 'stage' && !frame.reduced && pose.reveal < 1) {
        ctx.beginPath(); ctx.rect(-g.width, -g.size * .75, g.width * 2, g.size * 1.5 * pose.reveal); ctx.clip()
      }
      if (frame.readability === 'contrast') {
        ctx.strokeStyle = palette.shadow; ctx.lineWidth = Math.max(2.4 / pose.scale, g.size * .035); ctx.lineJoin = 'round'; ctx.strokeText(g.text, 0, g.baseline)
      }
      ctx.fillStyle = lyricInk(ctx, palette, wordWidth, g.size, sung, progress, active, frame.reduced, g.x - wordLeft - wordWidth / 2)
      ctx.fillText(g.text, 0, g.baseline)
      // A narrow colored baseline reacts to declared words, never invented syllables.
      if (!frame.reduced && sung > .01 && frame.mode === 'stage') {
        const pulse = pulseAt(frame.time, g.start)
        ctx.globalAlpha = cue.opacity * (.13 + pulse * .48); ctx.fillStyle = tint
        ctx.fillRect(-g.width * .38, g.size * .55, g.width * .76 * sung, Math.max(.6, g.size * .018))
      }
      ctx.restore()
    }
  }

  private rowAccents(ctx: CanvasRenderingContext2D, composition: Layout, frame: Frame, cue: Cue, tint: string, palette: LyricPalette) {
    for (const row of composition.rows) {
      const center = { ...row.glyphs[0], x: row.x + row.width / 2, y: row.y }
      const pose = this.pose(center, row, composition, frame, cue), width = row.width, size = row.size
      ctx.save(); ctx.translate(pose.x, pose.y); ctx.rotate(pose.angle); ctx.scale(pose.scale, pose.scale)
      ctx.globalAlpha = cue.opacity * (.07 + cue.pulse * .07); ctx.fillStyle = tint
      if (frame.mode === 'stage' && (composition.compact || (row.glyphs[0].row + cue.index) % 2)) {
        ctx.beginPath(); ctx.moveTo(-width / 2 - size * .12, size * .13); ctx.lineTo(width / 2 + size * .18, size * .13)
        ctx.lineTo(width / 2 + size * .07, size * .48); ctx.lineTo(-width / 2 - size * .20, size * .48); ctx.closePath(); ctx.fill()
      }
      ctx.globalAlpha = cue.opacity * (.26 + cue.pulse * .38)
      if (frame.mode === 'stage') ctx.fillRect(-width / 2 - size * .22, -size * .35, Math.max(1, size * .028), size * .72)
      const gradient = ctx.createLinearGradient(-width / 2, 0, width / 2 + size, 0)
      gradient.addColorStop(0, palette.prism[0] + '00'); gradient.addColorStop(.25, palette.prism[0]); gradient.addColorStop(.65, palette.prism[1]); gradient.addColorStop(1, tint + '00')
      ctx.strokeStyle = gradient; ctx.lineWidth = Math.max(.7, size * .014)
      ctx.beginPath(); ctx.moveTo(-width / 2, size * .65); ctx.lineTo(width / 2 + size, size * .65); ctx.stroke()
      // Scan only across a declared word span. Line-only lyrics get one phrase flash.
      const active = row.glyphs.find(g => g.timed && !g.hidden && frame.time >= g.start && frame.time < g.end)
      if (active) {
        const wordEnd = row.glyphs.filter(g => g.start === active.start && g.end === active.end).at(-1)!
        const progress = clamp((frame.time - active.start) / Math.max(1, active.end - active.start))
        const x = active.x - active.width / 2 + (wordEnd.x + wordEnd.width / 2 - active.x + active.width / 2) * progress - row.x - width / 2
        ctx.globalAlpha = cue.opacity * .85; ctx.fillStyle = palette.sung
        ctx.shadowColor = palette.prism[0]; ctx.shadowBlur = size * .14
        ctx.fillRect(x, size * .61, Math.max(1.5, size * .05), Math.max(1, size * .04))
      }
      ctx.restore()
    }
  }

}
