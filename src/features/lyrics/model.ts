import type { NowPlaying } from '../desktop-card/use-now-playing'

export interface LyricWord { text: string; start: number; end: number }
export interface LyricLine { text: string; start: number; end: number; words: LyricWord[] }
export interface LyricDocument { key: string; status: string; message: string; file: string | null; lines: LyricLine[]; issue?: string | null }
export const trackKey = (info: Pick<NowPlaying, 'title' | 'artist' | 'album'>) => `${info.title}\u001f${info.artist}\u001f${info.album}`
export const emptyLyrics: LyricDocument = { key: '', status: 'waiting', message: '等待播放器提供歌曲信息', file: null, lines: [] }
export function playbackPosition(info: NowPlaying, now: number) {
  if (!info.updated || now - info.updated > 4000 || !info.timelineAvailable || info.duration <= 0) return null
  return Math.min(info.duration, Math.max(0, info.position + (info.playing ? Math.max(0, now - info.updated) / 1000 : 0))) * 1000
}
export function activeLine(lines: LyricLine[], time: number) {
  let low = 0, high = lines.length
  while (low < high) { const middle = (low + high) >>> 1; if (lines[middle].start <= time) low = middle + 1; else high = middle }
  return low - 1
}
export const wordProgress = (word: LyricWord, time: number) => Math.max(0, Math.min(1, (time - word.start) / Math.max(1, word.end - word.start)))
export function isLyricBreakMark(text: string, previous = '', next = '') {
  if (!/^[，。！？、；,.!?;]$/u.test(text)) return false
  // Decimal/grouping separators and initials belong to the lyric, not to phrasing.
  if ((text === '.' || text === ',') && /\d/u.test(previous) && /\d/u.test(next)) return false
  if (text === '.' && /[A-Za-z]/u.test(previous) && /[A-Za-z]/u.test(next)) return false
  return true
}
export function lyricDisplayText(text: string) {
  const chars = [...text]
  return chars.map((char, index) => isLyricBreakMark(char, chars[index - 1], chars[index + 1]) ? ' ' : char).join('').replace(/\s+/gu, ' ').trim()
}
// Original preview text, never substituted for a missing real lyric.
export const demoLyrics: LyricLine[] = ['风把晚霞 折成一页信', '你听见 光落下的声音', '漫长夜色 缓缓经过掌心', '把未说出口的话 交给星群', '我沿着回声 向你靠近', '在时间停驻之前 再唱一遍'].map((text, index) => ({
  text, start: index * 5000, end: index * 5000 + 4200,
  words: [...text].map((text, i, chars) => ({ text, start: index * 5000 + i * 4200 / chars.length, end: index * 5000 + (i + 1) * 4200 / chars.length })),
}))
