import { createTimeline } from 'animejs'

export interface Word { text: string; start?: number; end?: number }
export interface Phrase { words: Word[] }
export interface Line { start: number; end: number; phrases: Phrase[] }
// Original score. Explicit unequal cues, never inferred from text length or audio level.
const phrase = (words: [string, number, number][]): Phrase => ({ words: words.map(([text, start, end]) => ({ text, start, end })) })
export const score: Line[] = [
  { start: 1800, end: 6000, phrases: [phrase([['把暮色',1800,2900],['轻轻',3100,3650]]), phrase([['折进',3850,4550],['窗边',4700,6000]])] },
  { start: 6500, end: 10900, phrases: [phrase([['留一道',6500,7600],['空白',7850,8700]]), phrase([['让风',8950,9600],['经过',9800,10900]])] },
  { start: 11400, end: 16000, phrases: [phrase([['Stay ',11400,12200],['with ',12300,13000],['the light',13100,14000]]), phrase([['等回声',14200,15100],['慢慢落下',15200,16000]])] },
  { start: 16200, end: 17350, phrases: [phrase([['别回头',16200,16700]]), phrase([['向前走',16700,17350]])] },
  { start: 17600, end: 23200, phrases: [phrase([['那些',17600,18300],['没有说完的',18400,19600]]), phrase([['温柔',19700,20500],['还停在',20700,21600]]), phrase([['下一页',21800,22500],['天亮之前',22600,23200]])] },
  { start: 24500, end: 29600, phrases: [phrase([['当所有',24500,25500],['折痕',25700,26800]]), phrase([['重新',27200,28000],['成为光',28200,29600]])] },
]
export const duration = 31500
export const sentenceScore: Line[] = score.map(line => ({...line,phrases:line.phrases.map(p=>({words:p.words.map(w=>({text:w.text}))}))}))
export const lineText = (line: Line) => line.phrases.map(p => p.words.map(w => w.text).join('')).join('　')
export function createChoreography(line: Line, nextStart = Infinity) {
  const pose = { enter: 0, exit: 0 }
  const lead = Math.min(1400, (line.end - line.start) * .65)
  const tail = Math.max(80,Math.min(1000, (line.end - line.start) * .4, (nextStart-line.end)*.85))
  const origin = line.start - lead
  const timeline = createTimeline({ autoplay: false })
    .add(pose, { enter: [0, 1], duration: lead, ease: 'inOutCubic' }, 0)
    .add(pose, { exit: [0, 1], duration: tail, ease: 'outCubic' }, line.end - origin)
  return { pose, lead, tail, evaluate(time: number) { timeline.seek(Math.max(0, Math.min(timeline.duration, time - origin)), true); return pose }, dispose() { timeline.cancel() } }
}

// One transport shared by controls, choreography and word highlighting.
export class ScoreClock {
  private position = 0
  private anchor = performance.now()
  playing = false
  offset = 0
  private listeners = new Set<() => void>()
  read = () => Math.min(duration, Math.max(0, this.position + (this.playing ? performance.now() - this.anchor : 0)))
  lyricTime = () => this.read() + this.offset
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit() { this.listeners.forEach(listener => listener()) }
  seek(time: number) { this.position = Math.min(duration, Math.max(0,time)); this.anchor = performance.now(); this.emit() }
  play(playing: boolean) { this.position = this.read(); this.anchor = performance.now(); this.playing = playing; this.emit() }
  setOffset(offset: number) { this.offset = offset; this.emit() }
}
