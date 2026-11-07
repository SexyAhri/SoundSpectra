import { isLyricBreakMark, type LyricLine } from './model'

export interface TimedGlyph { text: string; start: number; end: number; timed: boolean; hidden?: boolean }
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })

export function hasTimedWords(line: LyricLine) {
  if (!line.words.length || line.words.map(word => word.text).join('') !== line.text) return false
  let previous = line.start
  return line.words.every(word => {
    const valid = word.start >= line.start && word.end > word.start && word.end <= line.end && word.start >= previous
    previous = word.end
    return valid
  })
}

export function timedGlyphs(line: LyricLine): TimedGlyph[] {
  const timed = hasTimedWords(line)
  const words = timed ? line.words : [{ text: line.text, start: line.start, end: line.end }]
  const glyphs = words.flatMap(word => {
    const letters = [...segmenter.segment(word.text)].map(item => item.segment)
    return letters.map(text => ({ text, start: word.start, end: word.end, timed }))
  })
  return glyphs.map((glyph, index) => ({ ...glyph, hidden: isLyricBreakMark(glyph.text, glyphs[index - 1]?.text, glyphs[index + 1]?.text) }))
}

/** Prefer punctuation/word boundaries; Chinese passages split at balanced glyph counts. */
export function phrases(glyphs: TimedGlyph[], count: number): TimedGlyph[][] {
  const groups: TimedGlyph[][] = []; let cursor = 0
  let glyphCount = 0
  const boundaries = [...wordSegmenter.segment(glyphs.map(glyph => glyph.text).join(''))].map(word => {
    glyphCount += [...segmenter.segment(word.segment)].length
    return glyphCount
  })
  for (let row = 0; row < count - 1; row++) {
    const target = cursor + Math.ceil((glyphs.length - cursor) / (count - row))
    let cut = glyphs.length, distance = Infinity
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
