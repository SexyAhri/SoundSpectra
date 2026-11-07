import { defaultLyricPalette, type LyricPalette } from './lyric-palette'
import { isLyricBreakMark, lyricDisplayText, type LyricLine } from './model'

export type CompositionMode = 'depth' | 'stardust' | 'stage'
export interface TimedGlyph { text: string; start: number; end: number; timed: boolean; hidden?: boolean }
interface PlacedGlyph extends TimedGlyph { x: number; y: number; size: number; angle: number; row: number; width: number; arcAngle?:number }
interface Composition { glyphs: PlacedGlyph[]; font: number; rows: number }
export interface CompositionFrame {
  lines: LyricLine[]; index: number; time: number; width: number; height: number;
  fontSize: number; regionWidth: number; mode: CompositionMode; reduced: boolean;
  backgroundOpacity: number; palette?:LyricPalette;readability?:'soft'|'contrast';
}

const face = '"Microsoft YaHei UI", "Segoe UI", "Noto Sans CJK SC", sans-serif'
const clamp = (n: number) => Math.max(0, Math.min(1, n))
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t) }
const font = (size: number, weight = 500) => `${weight} ${size}px ${face}`
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
  return glyphs.reduce((sum, glyph) => sum + (glyph.hidden ? size * .18 : context.measureText(glyph.text).width), 0)
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
      const width = glyph.hidden ? base * .18 : context.measureText(glyph.text).width
      const t = (cursor + width / 2) / Math.max(1, total), angle = (t - .5) * 1.5
      placed.push({ ...glyph, x: w * (.5 + Math.sin(angle) / Math.sin(.75) * .40),
        y: h * (.42 + (1 - Math.cos(angle)) / (1 - Math.cos(.75)) * .22),
        angle: angle * .42, arcAngle:angle, size: base, row: 0, width }); cursor += width
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
      const width = glyph.hidden ? size * .18 : context.measureText(glyph.text).width
      const angle = 0
      placed.push({ ...glyph, x: x + width / 2, y: y + (x - left + width / 2 - rowWidth / 2) * Math.tan(angle), size, width, row, angle }); x += width
    }
  })
  return { glyphs: placed, font: base, rows: groups.length }
}

export class KineticComposition {
  private cache = new Map<string,Composition>()
  private glow: HTMLCanvasElement | null = null
  private previous?: Pick<CompositionFrame, 'lines' | 'index' | 'time' | 'width' | 'height' | 'fontSize' | 'regionWidth' | 'mode' | 'reduced'>
  private handoff?: LyricLine
  private transitioning = false
  get isTransitioning() { return this.transitioning }
  private composition(context:CanvasRenderingContext2D,line:LyricLine,frame:CompositionFrame){
    const key=`${frame.mode}|${frame.width}|${frame.height}|${frame.fontSize}|${frame.regionWidth}|${line.start}|${line.end}|${line.text}|${line.words.map(w=>`${w.text}:${w.start}:${w.end}`).join(',')}`
    let composition=this.cache.get(key)
    if(!composition){composition=compose(context,line,frame);this.cache.set(key,composition);if(this.cache.size>4)this.cache.delete(this.cache.keys().next().value!)}
    return composition
  }
  private continuousHandoff(frame: CompositionFrame) {
    const previous = this.previous
    const compatible = previous && previous.lines === frame.lines && previous.mode === frame.mode && previous.reduced === frame.reduced &&
      previous.width === frame.width && previous.height === frame.height && previous.fontSize === frame.fontSize && previous.regionWidth === frame.regionWidth
    const continuous = compatible && frame.time >= previous.time && frame.time - previous.time <= 280 && frame.index === previous.index + 1
    const continuing = compatible && frame.time >= previous.time && frame.time - previous.time <= 280 && frame.index === previous.index
    if (continuous && !frame.reduced) this.handoff = frame.lines[previous.index]
    const age = frame.time - (frame.lines[frame.index]?.start ?? frame.time)
    if (!continuous && !continuing) this.handoff = undefined
    if (age < 0 || age >= 360) this.handoff = undefined
    this.transitioning = !!this.handoff
    this.previous = { lines: frame.lines, index: frame.index, time: frame.time, width: frame.width, height: frame.height,
      fontSize: frame.fontSize, regionWidth: frame.regionWidth, mode: frame.mode, reduced: frame.reduced }
    return this.handoff
  }
  private pose(glyph: PlacedGlyph, frame: CompositionFrame, progress: number, exit = 0) {
    const { width: w, height: h, mode } = frame
    let x = glyph.x, y = glyph.y, angle = glyph.angle, scale = 1
    if (mode === 'depth') {
      scale = .99 + progress * .035
      x = w / 2 + (x - w / 2) * scale
      y = h / 2 + (y - h / 2) * scale + glyph.size * .14 * exit
    } else if (mode === 'stardust') {
      const arc = (glyph.arcAngle ?? 0) + (progress - .5) * .18 + exit * .12
      x = w * (.5 + Math.sin(arc) / Math.sin(.95) * .40)
      y = h * (.40 + (1 - Math.cos(arc)) / (1 - Math.cos(.95)) * .22)
      angle = Math.atan2(h * .22 * Math.sin(arc) / (1 - Math.cos(.95)), w * .40 * Math.cos(arc) / Math.sin(.95))
    } else {
      const direction = glyph.row % 2 ? 1 : -1
      x += direction * glyph.size * .08 * exit
      y += glyph.size * (.04 * progress + .14 * exit)
    }
    return { x, y, angle, scale }
  }
  private drawLine(context: CanvasRenderingContext2D, composition: Composition, line: LyricLine, frame: CompositionFrame,
    progress: number, opacity: number, exit = 0, lightOnly = false) {
    const { mode, reduced } = frame, palette = frame.palette ?? defaultLyricPalette
    const age = frame.time - line.start
    const reveal = reduced ? 1 : .86 + .14 * smooth(age / 140)
    context.save()
    for (const glyph of composition.glyphs) {
      if (glyph.hidden) continue
      const pose = this.pose(glyph, frame, progress, exit)
      const sung = glyph.timed ? smooth((frame.time - glyph.start) / Math.max(1, glyph.end - glyph.start)) : 0
      context.save(); context.translate(pose.x, pose.y); context.rotate(pose.angle); context.scale(pose.scale, pose.scale)
      context.font = font(glyph.size, mode === 'stage' && glyph.row === 1 ? 600 : 500)
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.globalAlpha = opacity * reveal
      if (!lightOnly) {
        if (frame.readability === 'contrast') { context.strokeStyle = palette.shadow; context.lineWidth = Math.max(1, glyph.size * .045); context.lineJoin = 'round'; context.strokeText(glyph.text, 0, 0) }
        context.fillStyle = palette.unsung; context.fillText(glyph.text, 0, 0)
      }
      if (sung > 0) {
        context.fillStyle = lightOnly ? palette.glow : palette.sung
        context.globalAlpha = opacity * reveal * (lightOnly ? .62 : 1) * (.26 + sung * .74)
        context.fillText(glyph.text, 0, 0)
      }
      context.restore()
    }
    context.restore()
  }
  draw(context: CanvasRenderingContext2D, frame: CompositionFrame) {
    const {width:w,height:h,lines,index,time,mode,reduced}=frame,palette=frame.palette??defaultLyricPalette
    context.clearRect(0,0,w,h)
    this.background(context,frame,palette)
    const line=lines[index]
    if(!line){context.save();context.fillStyle=palette.unsung;context.font=font(Math.min(h*.14,w*.05));context.textAlign='center';context.textBaseline='middle';context.fillText('·  ·  ·',w*.5,h*.48);context.restore();return}
    const composition=this.composition(context,line,frame),age=time-line.start
    const progress=clamp(age/Math.max(1,line.end-line.start))
    const outgoing = this.continuousHandoff(frame)
    this.contextLines(context, frame, progress, palette, !!outgoing)
    if (outgoing) {
      const exit = smooth(age / 360)
      const outgoingProgress = clamp((time - outgoing.start) / Math.max(1, outgoing.end - outgoing.start))
      this.drawLine(context, this.composition(context, outgoing, frame), outgoing, frame, outgoingProgress, (1 - exit) * .46, exit)
    }
    // One half-resolution emissive layer and two whole-layer blurs replace per-glyph shadows.
    const glow=this.glow??=document.createElement('canvas'),gw=Math.max(1,Math.round(w/2)),gh=Math.max(1,Math.round(h/2))
    if(glow.width!==gw||glow.height!==gh){glow.width=gw;glow.height=gh}
    const gc=glow.getContext('2d')!
    gc.setTransform(gw/w,0,0,gh/h,0,0);gc.clearRect(0,0,w,h);this.drawLine(gc, composition, line, frame, progress, 1, 0, true)
    context.save();context.globalAlpha=.23;context.filter=`blur(${composition.font*.35}px)`;context.drawImage(glow,0,0,w,h)
    context.globalAlpha=.10;context.filter=`blur(${composition.font*.9}px)`;context.drawImage(glow,0,0,w,h);context.restore()
    this.drawLine(context, composition, line, frame, progress, 1)
    if(mode==='stardust'){
      context.save();context.strokeStyle=palette.accent;context.globalAlpha=.18;context.lineWidth=.7;context.beginPath()
      for(let i=0;i<=70;i++){const a=(i/70-.5)*1.8,x=w*(.5+Math.sin(a)/Math.sin(.95)*.43),y=h*(.63+(1-Math.cos(a))/(1-Math.cos(.95))*.16);if(i)context.lineTo(x,y);else context.moveTo(x,y)}context.stroke()
      if(!reduced){
        const a=(progress-.5)*1.8;context.globalAlpha=.65;context.fillStyle=palette.accent;context.beginPath();context.arc(w*(.5+Math.sin(a)/Math.sin(.95)*.43),h*(.63+(1-Math.cos(a))/(1-Math.cos(.95))*.16),1.6,0,Math.PI*2);context.fill()
      }
      context.restore()
    }
  }
  private contextLines(ctx:CanvasRenderingContext2D,frame:CompositionFrame,progress:number,palette:LyricPalette,handoff:boolean){
    const {width:w,height:h,lines,index,reduced}=frame
    ctx.save();ctx.fillStyle=palette.unsung;ctx.textBaseline='middle'
    for(const [delta,y,align]of [[-1,.10,'left'],[1,.91,'right']] as const){
      const line=lines[index+delta];if(!line)continue
      if(delta<0&&handoff)continue
      const alpha=delta<0 ? .18*smooth(progress/.12) : .15+.22*smooth((progress-.42)/.48)
      let size=Math.min(h*.09,w*.028)*(delta<0?.82:.95)
      const text=lyricDisplayText(line.text),limit=w*.76
      ctx.font=font(size,400)
      while(size>h*.038&&ctx.measureText(text).width>limit){size*=.92;ctx.font=font(size,400)}
      ctx.globalAlpha=reduced?Math.min(alpha,.3):alpha;ctx.textAlign=align
      ctx.fillText(text,w*(delta<0?.1:.9),h*y,limit)
    }ctx.restore()
  }
  private background(ctx:CanvasRenderingContext2D,frame:CompositionFrame,palette:LyricPalette){
    const alpha=clamp(frame.backgroundOpacity/100),{width:w,height:h}=frame
    if(!alpha&&frame.readability!=='contrast')return
    ctx.save();ctx.translate(w/2,h/2);ctx.scale(w/2,h/2)
    const shade=ctx.createRadialGradient(0,0,0,0,0,1)
    const rgb=[1,3,5].map(i=>parseInt(palette.shadow.slice(i,i+2),16)).join(',')
    const opacity=Math.max(alpha,frame.readability==='contrast'?.16:0)
    shade.addColorStop(0,`rgba(${rgb},${opacity})`);shade.addColorStop(.65,`rgba(${rgb},${opacity*.38})`);shade.addColorStop(1,`rgba(${rgb},0)`)
    ctx.fillStyle=shade;ctx.fillRect(-1,-1,2,2);ctx.restore()
  }
}
