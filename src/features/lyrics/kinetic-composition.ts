import { isLyricBreakMark, lyricDisplayText, type LyricLine } from './model'

export type CompositionMode = 'depth' | 'stardust' | 'stage'
export interface TimedGlyph { text: string; start: number; end: number; hidden?: boolean }
interface PlacedGlyph extends TimedGlyph { x: number; y: number; size: number; angle: number; row: number; width: number }
interface Composition { glyphs: PlacedGlyph[]; font: number; rows: number }
export interface CompositionFrame {
  lines: LyricLine[]; index: number; time: number; width: number; height: number;
  fontSize: number; regionWidth: number; mode: CompositionMode; reduced: boolean;
  backgroundOpacity: number;
}

const face = '"Georgia", "Noto Serif CJK SC", "SimSun", serif'
const clamp = (n: number) => Math.max(0, Math.min(1, n))
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t) }
const easeOut = (n: number) => 1 - (1 - clamp(n)) ** 3
const font = (size: number, weight = 500) => `${weight} ${size}px ${face}`
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })

export function timedGlyphs(line: LyricLine): TimedGlyph[] {
  const words = line.words.length && line.words.map(word => word.text).join('') === line.text
    ? line.words : [{ text: line.text, start: line.start, end: line.end }]
  const glyphs = words.flatMap(word => {
    const letters = [...segmenter.segment(word.text)].map(item => item.segment)
    return letters.map((text, i) => ({ text, start: word.start + (word.end - word.start) * i / letters.length,
      end: word.start + (word.end - word.start) * (i + 1) / letters.length }))
  })
  return glyphs.map((glyph, index) => ({ ...glyph, hidden: isLyricBreakMark(glyph.text, glyphs[index - 1]?.text, glyphs[index + 1]?.text) }))
}

/** Prefer punctuation/word boundaries; Chinese passages split at balanced glyph counts. */
function phrases(glyphs: TimedGlyph[], count: number): TimedGlyph[][] {
  const groups: TimedGlyph[][] = []; let cursor = 0
  let glyphCount = 0
  const boundaries = [...wordSegmenter.segment(glyphs.map(glyph => glyph.text).join(''))].map(word => {
    glyphCount += [...segmenter.segment(word.segment)].length
    return glyphCount
  })
  for (let row = 0; row < count - 1; row++) {
    const target = cursor + Math.ceil((glyphs.length - cursor) / (count - row))
    let cut = target, distance = Infinity
    for (const boundary of boundaries) {
      if (boundary <= cursor || boundary > glyphs.length - 2 * (count - row - 1)) continue
      if (/^[一不的在和与把将为向被从]$/u.test(glyphs[boundary - 1].text)) continue
      if (Math.abs(boundary - target) < distance) { cut = boundary; distance = Math.abs(boundary - target) }
    }
    distance = Infinity
    for (let i = Math.max(cursor + 2, target - 2); i < Math.min(glyphs.length - 1, target + 3); i++) {
      if (/^[\s，。！？、,.!?;；]$/u.test(glyphs[i].text) && Math.abs(i - target) < distance) { cut = i + 1; distance = Math.abs(i - target) }
    }
    if (cut > cursor + 1 && /^[一不的在和与把将为向被从]$/u.test(glyphs[cut - 1].text)) cut--
    groups.push(glyphs.slice(cursor, cut)); cursor = cut
  }
  groups.push(glyphs.slice(cursor)); return groups.filter(group => group.some(glyph => !glyph.hidden && glyph.text.trim()))
}

function textWidth(context: CanvasRenderingContext2D, glyphs: TimedGlyph[], size: number) {
  context.font = font(size)
  return glyphs.reduce((sum, glyph) => sum + (glyph.hidden ? size * .18 : context.measureText(glyph.text).width + size * .025), 0)
}

function compose(context: CanvasRenderingContext2D, line: LyricLine, frame: CompositionFrame): Composition {
  const { width: w, height: h, mode } = frame, letters = timedGlyphs(line)
  const desired = frame.fontSize * w / (1920 * frame.regionWidth) * 2.35
  const visibleCount = letters.filter(glyph => !glyph.hidden && glyph.text.trim()).length
  const groups = phrases(letters, mode === 'stage' ? visibleCount > 8 ? 3 : 2 : visibleCount > 7 ? 2 : 1)
  let base = Math.min(desired, mode === 'stage' ? h * .22 : h * .30)
  const placed: PlacedGlyph[] = []
  if (mode === 'stardust') {
    base = Math.min(desired, h * .32)
    base *= Math.min(1, w * .82 / Math.max(1, textWidth(context, letters, base)))
    const total = textWidth(context, letters, base); let cursor = 0
    context.font = font(base)
    for (const glyph of letters) {
      const width = glyph.hidden ? base * .18 : context.measureText(glyph.text).width + base * .025
      const t = (cursor + width / 2) / Math.max(1, total), angle = (t - .5) * 1.5
      placed.push({ ...glyph, x: w * (.5 + Math.sin(angle) / Math.sin(.75) * .40),
        y: h * (.42 + (1 - Math.cos(angle)) / (1 - Math.cos(.75)) * .22),
        angle: angle * .42, size: base, row: 0, width }); cursor += width
    }
    return { glyphs: placed, font: base, rows: 1 }
  }
  const parity = Math.floor(line.start / 1000) % 2
  const scales = mode === 'stage' ? [1, 1.22, .91] : [1, .93]
  const maxWidth = w * (mode === 'stage' ? .66 : .80)
  groups.forEach((group, row) => { base *= Math.min(1, maxWidth / Math.max(1, textWidth(context, group, base * (scales[row] ?? 1)))) })
  groups.forEach((group, row) => {
    const size = base * (scales[row] ?? 1), rowWidth = textWidth(context, group, size)
    const left = mode === 'stage' ? [w * .10, w * .28, w * .16][row]
      : row % 2 === parity ? w * .10 : w * .90 - rowWidth
    const y = mode === 'stage' ? (groups.length === 2 ? [.35, .67] : [.24, .50, .76])[row] * h
      : (groups.length === 1 ? .51 : [.37, .68][row]) * h
    let x = left
    context.font = font(size)
    for (const glyph of group) {
      const width = glyph.hidden ? size * .18 : context.measureText(glyph.text).width + size * .025
      const angle = mode === 'stage' ? [-.09, .025, -.035][row] : 0
      placed.push({ ...glyph, x: x + width / 2, y: y + (x - left + width / 2 - rowWidth / 2) * Math.tan(angle), size, width, row, angle }); x += width
    }
  })
  return { glyphs: placed, font: base, rows: groups.length }
}

export class KineticComposition {
  private key = ''
  private current: Composition = { glyphs: [], font: 0, rows: 0 }

  draw(context: CanvasRenderingContext2D, frame: CompositionFrame) {
    const { width: w, height: h, lines, index, time, mode, reduced } = frame
    context.clearRect(0, 0, w, h)
    this.background(context, w, h, frame.backgroundOpacity)
    const line = lines[index]
    if (!line) { this.waiting(context, frame); return }
    const key = `${mode}|${w}|${h}|${frame.fontSize}|${frame.regionWidth}|${line.start}|${line.end}|${line.text}|${line.words.map(word => `${word.start}:${word.end}`).join(',')}`
    if (this.key !== key) { this.current = compose(context, line, frame); this.key = key }
    const progress = clamp((time - line.start) / Math.max(1, line.end - line.start))
    const age = time - line.start, entry = reduced ? 1 : easeOut(age / 850)
    const nextStart = lines[index + 1]?.start ?? line.end + 7000
    const release = reduced ? 1 : 1 - smooth((time - Math.max(line.end, nextStart - 550)) / 550) * .45

    this.contextLines(context, frame, progress)
    if (!reduced && index > 0 && age >= 0 && age < 600) {
      const outgoing = compose(context, lines[index - 1], frame), exit = smooth(age / 600)
      context.save(); context.translate(-w * (.04 + exit * .07), -h * (.08 + exit * .15)); context.scale(.92 - exit * .08, .92 - exit * .08)
      context.globalAlpha = (1 - exit) * .52; context.fillStyle = '#d3c7ac'; context.textAlign = 'center'; context.textBaseline = 'middle'
      for (const glyph of outgoing.glyphs) { if (glyph.hidden) continue; context.save(); context.translate(glyph.x, glyph.y); context.rotate(glyph.angle); context.font = font(glyph.size); context.fillText(glyph.text, 0, 0); context.restore() }
      context.restore()
    }

    context.save()
    if (!reduced) {
      const pan = (progress - .5) * (mode === 'stage' ? .018 : .045)
      context.translate(w * (.5 + pan), h * (.5 + (1 - entry) * .07))
      context.rotate(mode === 'stardust' ? (progress - .5) * -.07 : mode === 'depth' ? (progress - .5) * .025 : 0)
      const zoom = .97 + entry * .03 + progress * .018
      context.scale(zoom, zoom); context.translate(-w * .5, -h * .5)
    }
    if (mode === 'stardust') this.arc(context, w, h, progress)
    for (let i = 0; i < this.current.glyphs.length; i++) {
      const glyph = this.current.glyphs[i], lead = Math.min(1100, 450 + i * 36)
      if (glyph.hidden) continue
      const arriving = reduced ? 1 : easeOut((time - glyph.start + lead) / lead)
      const sung = clamp((time - glyph.start) / Math.max(1, glyph.end - glyph.start))
      const singing = time >= glyph.start && time < glyph.end
      const emphasis = singing ? Math.sin(sung * Math.PI) : 0
      context.save()
      const rise = reduced ? 0 : (1 - arriving) * glyph.size * .58 - emphasis * glyph.size * .09
      context.translate(glyph.x + (reduced ? 0 : (1 - arriving) * glyph.size * (i % 2 ? .22 : -.22)), glyph.y + rise)
      context.rotate(glyph.angle + (reduced ? 0 : (1 - arriving) * (i % 2 ? -.12 : .12)))
      const scale = reduced ? 1 : .9 + arriving * .1 + emphasis * (mode === 'stage' ? .10 : .055)
      context.scale(scale, scale)
      context.font = font(glyph.size, mode === 'stage' && glyph.row === 1 ? 650 : 500)
      context.textAlign = 'center'; context.textBaseline = 'middle'
      context.globalAlpha = (.19 + arriving * .81) * release * (.25 + entry * .75)
      context.fillStyle = sung > 0 ? '#f4ead5' : '#a7b7be'
      context.shadowColor = '#02060c'; context.shadowBlur = glyph.size * .10; context.shadowOffsetY = 2
      context.fillText(glyph.text, 0, 0)
      if (sung > 0) {
        context.save(); context.beginPath(); context.rect(-glyph.width * .6, -glyph.size, glyph.width * 1.2 * sung, glyph.size * 2); context.clip()
        context.fillStyle = mode === 'stardust' ? '#d5eee9' : '#e4bd7b'
        context.shadowColor = mode === 'stardust' ? '#a3c9d4' : '#d5ae6b'; context.shadowBlur = singing ? glyph.size * .14 : 0
        context.fillText(glyph.text, 0, 0); context.restore()
      }
      context.restore()
    }
    context.restore()
    this.punctuation(context, frame, progress)
  }

  private contextLines(context: CanvasRenderingContext2D, frame: CompositionFrame, progress: number) {
    const { width: w, height: h, lines, index, mode, reduced } = frame
    const previous = lyricDisplayText(lines[index - 1]?.text ?? ''), next = lyricDisplayText(lines[index + 1]?.text ?? '')
    context.save(); context.textBaseline = 'middle'; context.fillStyle = '#d5e0df'; context.font = font(Math.min(h * .075, w * .027), 400)
    if (mode === 'stage') {
      if (previous && h > 100) {
        context.save(); context.translate(w * .035, h * .77); context.rotate(-Math.PI / 2); context.globalAlpha = .18
        context.textAlign = 'left'; context.fillText(previous, 0, 0, h * .60); context.restore()
      }
      if (next) { context.globalAlpha = .30; context.textAlign = 'right'; context.fillText(next, w * .91, h * .94, w * .55) }
    } else {
      if (previous) { context.globalAlpha = .16; context.textAlign = 'left'; context.fillText(previous, w * .10, h * (.085 - (reduced ? 0 : progress * .02)), w * .64) }
      if (next) { context.globalAlpha = .24 + progress * .11; context.textAlign = 'right'; context.fillText(next, w * .90, h * .92, w * .64) }
    }
    context.restore()
  }

  private arc(context: CanvasRenderingContext2D, w: number, h: number, progress: number) {
    context.save(); context.lineWidth = .7; context.strokeStyle = '#b7d1d22b'; context.beginPath()
    for (let i = 0; i <= 80; i++) { const t = i / 80, a = (t - .5) * 1.5, x = w * (.5 + Math.sin(a) / Math.sin(.75) * .43), y = h * (.63 + (1 - Math.cos(a)) / (1 - Math.cos(.75)) * .17); if (!i) context.moveTo(x, y); else context.lineTo(x, y) }
    context.stroke()
    const angle = (progress - .5) * 1.5, x = w * (.5 + Math.sin(angle) / Math.sin(.75) * .43), y = h * (.63 + (1 - Math.cos(angle)) / (1 - Math.cos(.75)) * .17)
    context.fillStyle = '#cce4df'; context.beginPath(); context.arc(x, y, 2.1, 0, Math.PI * 2); context.fill(); context.restore()
  }

  private punctuation(context: CanvasRenderingContext2D, frame: CompositionFrame, progress: number) {
    const { width: w, height: h, mode } = frame
    context.save(); context.strokeStyle = '#d5b47a65'; context.lineWidth = .8
    if (mode === 'stage') {
      context.beginPath(); context.moveTo(w * .81, h * .14); context.lineTo(w * .90, h * .14); context.stroke()
      context.globalAlpha = .5; context.font = font(h * .075); context.fillStyle = '#ddc8a6'; context.textAlign = 'right'
      context.fillText(String(frame.index + 1).padStart(2, '0'), w * .90, h * .095)
    } else if (mode === 'depth') {
      context.beginPath(); context.moveTo(w * .08, h * .85); context.lineTo(w * (.08 + .08 * progress), h * .85); context.stroke()
      context.beginPath(); context.arc(w * .915, h * .13, h * .024, -.5 * Math.PI, -.5 * Math.PI + Math.PI * 2 * progress); context.stroke()
    }
    context.restore()
  }

  private waiting(context: CanvasRenderingContext2D, frame: CompositionFrame) {
    const { width: w, height: h, lines } = frame
    context.save(); context.font = font(Math.min(h * .2, w * .06)); context.textAlign = 'center'; context.textBaseline = 'middle'
    context.fillStyle = '#d5c7aa9c'; context.fillText('·  ·  ·', w * .5, h * .46)
    if (lines[0]) { context.font = font(Math.min(h * .07, w * .025)); context.fillStyle = '#d5e0df60'; context.fillText(lyricDisplayText(lines[0].text), w * .5, h * .72, w * .8) }
    context.restore()
  }

  private background(context: CanvasRenderingContext2D, width: number, height: number, opacity: number) {
    const alpha = clamp(opacity / 100)
    if (!alpha) return
    context.save(); context.translate(width / 2, height / 2); context.scale(width / 2, height / 2)
    const shade = context.createRadialGradient(0, 0, 0, 0, 0, 1)
    shade.addColorStop(0, `rgba(5,11,21,${alpha})`); shade.addColorStop(.65, `rgba(5,11,21,${alpha * .38})`); shade.addColorStop(1, 'rgba(5,11,21,0)')
    context.fillStyle = shade; context.fillRect(-1, -1, 2, 2); context.restore()
  }
}
