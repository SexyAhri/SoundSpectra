import { defaultLyricPalette, type LyricPalette } from './lyric-palette'
import { lyricDisplayText, type LyricLine } from './model'
import { timedGlyphs, type TimedGlyph } from './lyric-glyphs'
import { ExpressiveComposition } from './expressive-composition'
import { lyricFont, lyricInk, lyricWeight, measureLyricGlyphs, type LyricFontStyle } from './lyric-typography'
import type { LyricAudio } from './lyric-audio'
export { hasTimedWords, timedGlyphs, type TimedGlyph } from './lyric-glyphs'

export type CompositionMode = 'depth' | 'stardust' | 'stage'
interface PlacedGlyph extends TimedGlyph { x: number; y: number; size: number; angle: number; row: number; width: number; arcAngle?:number; weight: number; baseline: number; opacity: number }
interface Composition { glyphs: PlacedGlyph[]; font: number; rows: number }
export interface CompositionFrame {
  lines: LyricLine[]; index: number; time: number; width: number; height: number;
  fontSize: number; regionWidth: number; mode: CompositionMode; reduced: boolean;
  backgroundOpacity: number; fontStyle?: LyricFontStyle; palette?:LyricPalette;readability?:'soft'|'contrast';
  audio?: Readonly<LyricAudio>;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n))
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t) }
function compose(context: CanvasRenderingContext2D, line: LyricLine, frame: CompositionFrame): Composition {
  const { width: w, height: h } = frame, letters = timedGlyphs(line), style = frame.fontStyle ?? 'modern'
  const desired = frame.fontSize * w / (1920 * frame.regionWidth) * 2.35
  let base = Math.min(desired, h * .32)
  const weight = lyricWeight(style, base, 'stardust')
  let metrics = measureLyricGlyphs(context, letters, base, style, 'stardust', weight)
  base *= Math.min(1, w * .82 / Math.max(1, metrics.reduce((sum, metric) => sum + metric.advance, 0)))
  metrics = measureLyricGlyphs(context, letters, base, style, 'stardust', weight)
  const total = metrics.reduce((sum, metric) => sum + metric.advance, 0)
  let cursor = 0
  const glyphs = letters.map((glyph, index) => {
    const metric = metrics[index], width = metric.advance
    const t = (cursor + metric.leading + metric.width / 2) / Math.max(1, total), angle = (t - .5) * 1.5
    cursor += width
    return { ...glyph, x: w * (.5 + Math.sin(angle) / Math.sin(.75) * .40),
      y: h * (.42 + (1 - Math.cos(angle)) / (1 - Math.cos(.75)) * .22),
      angle: angle * .42, arcAngle: angle, size: base * metric.scale, row: 0, width,
      weight, baseline: metric.baseline, opacity: metric.opacity }
  })
  return { glyphs, font: base, rows: 1 }
}

export class KineticComposition {
  private expressive = new ExpressiveComposition()
  private cache = new Map<string,Composition>()
  private previous?: Pick<CompositionFrame, 'lines' | 'index' | 'time' | 'width' | 'height' | 'fontSize' | 'regionWidth' | 'mode' | 'reduced' | 'fontStyle'>
  private handoff?: LyricLine
  private transitioning = false
  get isTransitioning() { return this.transitioning }
  private composition(context:CanvasRenderingContext2D,line:LyricLine,frame:CompositionFrame){
    const key=`${frame.fontStyle}|${frame.mode}|${frame.width}|${frame.height}|${frame.fontSize}|${frame.regionWidth}|${line.start}|${line.end}|${line.text}|${line.words.map(w=>`${w.text}:${w.start}:${w.end}`).join(',')}`
    let composition=this.cache.get(key)
    if(!composition){composition=compose(context,line,frame);this.cache.set(key,composition);if(this.cache.size>4)this.cache.delete(this.cache.keys().next().value!)}
    return composition
  }
  private continuousHandoff(frame: CompositionFrame) {
    const previous = this.previous
    const compatible = previous && previous.lines === frame.lines && previous.mode === frame.mode && previous.fontStyle === frame.fontStyle && previous.reduced === frame.reduced &&
      previous.width === frame.width && previous.height === frame.height && previous.fontSize === frame.fontSize && previous.regionWidth === frame.regionWidth
    const continuous = compatible && frame.time >= previous.time && frame.time - previous.time <= 280 && frame.index === previous.index + 1
    const continuing = compatible && frame.time >= previous.time && frame.time - previous.time <= 280 && frame.index === previous.index
    if (continuous && !frame.reduced) this.handoff = frame.lines[previous.index]
    const age = frame.time - (frame.lines[frame.index]?.start ?? frame.time)
    if (!continuous && !continuing) this.handoff = undefined
    if (age < 0 || age >= 360) this.handoff = undefined
    this.transitioning = !!this.handoff
    this.previous = { lines: frame.lines, index: frame.index, time: frame.time, width: frame.width, height: frame.height,
      fontSize: frame.fontSize, regionWidth: frame.regionWidth, mode: frame.mode, fontStyle: frame.fontStyle, reduced: frame.reduced }
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
    progress: number, opacity: number, exit = 0) {
    const { reduced } = frame, palette = frame.palette ?? defaultLyricPalette
    const age = frame.time - line.start
    const reveal = reduced ? 1 : .86 + .14 * smooth(age / 140)
    context.save()
    for (const glyph of composition.glyphs) {
      if (glyph.hidden) continue
      const pose = this.pose(glyph, frame, progress, exit)
      const sung = glyph.timed ? smooth((frame.time - glyph.start) / Math.max(1, glyph.end - glyph.start)) : 0
      context.save(); context.translate(pose.x, pose.y); context.rotate(pose.angle); context.scale(pose.scale, pose.scale)
      context.font = lyricFont(glyph.size, frame.fontStyle, glyph.weight)
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.globalAlpha = opacity * reveal * glyph.opacity
      if (frame.readability === 'contrast') {
        context.strokeStyle = palette.shadow; context.lineWidth = Math.max(1, glyph.size * .045); context.lineJoin = 'round'
        context.strokeText(glyph.text, 0, glyph.baseline)
      }
      const members = composition.glyphs.filter(g => g.start === glyph.start && g.end === glyph.end && !g.hidden)
      const wordWidth = members.reduce((sum, g) => sum + g.width, 0)
      const offset = members.slice(0, members.indexOf(glyph)).reduce((sum, g) => sum + g.width, 0) + glyph.width / 2 - wordWidth / 2
      const wordProgress = glyph.timed ? clamp((frame.time - glyph.start) / Math.max(1, glyph.end - glyph.start)) : clamp((frame.time - glyph.start) / 650)
      const active = frame.time >= glyph.start && frame.time < (glyph.timed ? glyph.end : glyph.start + 650)
      context.fillStyle = lyricInk(context, palette, wordWidth, glyph.size, glyph.timed ? sung : 1, wordProgress, active, reduced, offset)
      context.fillText(glyph.text, 0, glyph.baseline)
      context.restore()
    }
    context.restore()
  }
  draw(context: CanvasRenderingContext2D, frame: CompositionFrame) {
    const {width:w,height:h,lines,index,time,mode,reduced}=frame,palette=frame.palette??defaultLyricPalette
    context.clearRect(0,0,w,h)
    this.background(context,frame,palette)
    if (mode !== 'stardust') {
      this.previous = undefined; this.handoff = undefined
      this.transitioning = this.expressive.draw(context, frame)
      return
    }
    const line=lines[index]
    if(!line){context.save();context.fillStyle=palette.unsung;context.font=lyricFont(Math.min(h*.14,w*.05),frame.fontStyle);context.textAlign='center';context.textBaseline='middle';context.fillText('·  ·  ·',w*.5,h*.48);context.restore();return}
    const composition=this.composition(context,line,frame),age=time-line.start
    const progress=clamp(age/Math.max(1,line.end-line.start))
    const outgoing = this.continuousHandoff(frame)
    this.contextLines(context, frame, progress, palette, !!outgoing)
    if (outgoing) {
      const exit = smooth(age / 360)
      const outgoingProgress = clamp((time - outgoing.start) / Math.max(1, outgoing.end - outgoing.start))
      this.drawLine(context, this.composition(context, outgoing, frame), outgoing, frame, outgoingProgress, (1 - exit) * .46, exit)
    }
    this.drawLine(context, composition, line, frame, progress, 1)
    if(mode==='stardust'){
      const audio = reduced ? undefined : frame.audio
      context.save();context.strokeStyle=palette.accent;context.globalAlpha=.18+(audio?.impact??0)*.38;context.lineWidth=.7+(audio?.treble??0)*.7;context.beginPath()
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
      ctx.font=lyricFont(size,frame.fontStyle,lyricWeight(frame.fontStyle??'modern',size,'stardust'))
      while(size>h*.038&&ctx.measureText(text).width>limit){size*=.92;ctx.font=lyricFont(size,frame.fontStyle,lyricWeight(frame.fontStyle??'modern',size,'stardust'))}
      ctx.globalAlpha=reduced?Math.min(alpha,.3):alpha;ctx.textAlign=align
      ctx.fillText(text,w*(delta<0?.1:.9),h*y,limit)
    }ctx.restore()
  }
  private background(ctx:CanvasRenderingContext2D,frame:CompositionFrame,palette:LyricPalette){
    const opacity=clamp(frame.backgroundOpacity/100),{width:w,height:h}=frame
    if(!opacity)return
    ctx.save();ctx.translate(w/2,h/2);ctx.scale(w/2,h/2)
    const shade=ctx.createRadialGradient(0,0,0,0,0,1)
    const rgb=[1,3,5].map(i=>parseInt(palette.shadow.slice(i,i+2),16)).join(',')
    shade.addColorStop(0,`rgba(${rgb},${opacity})`);shade.addColorStop(.65,`rgba(${rgb},${opacity*.38})`);shade.addColorStop(1,`rgba(${rgb},0)`)
    ctx.fillStyle=shade;ctx.fillRect(-1,-1,2,2);ctx.restore()
  }
}
