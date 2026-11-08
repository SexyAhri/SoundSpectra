import { defaultLyricPalette, type LyricPalette } from './lyric-palette'
import { lyricDisplayText, type LyricLine } from './model'
import { timedGlyphs, type TimedGlyph } from './lyric-glyphs'
import { ExpressiveComposition } from './expressive-composition'
import { lyricFont, lyricInk, lyricWeight, measureLyricGlyphs, type LyricFontStyle } from './lyric-typography'
import type { LyricAudio } from './lyric-audio'
import type { RenderQuality } from '../spectrum/model'
import { lyricOrbit, lyricRelease } from './lyric-motion'
import { GlyphDust } from './glyph-dust'
import { lyricRenderBudget } from './lyric-render-budget'
import { lyricAccent } from './lyric-audio'
export { hasTimedWords, timedGlyphs, type TimedGlyph } from './lyric-glyphs'

export type CompositionMode = 'depth' | 'stardust' | 'stage'
interface PlacedGlyph extends TimedGlyph { size: number; width: number; arcAngle: number; weight: number; baseline: number; opacity: number }
interface Composition { glyphs: PlacedGlyph[] }
export interface CompositionFrame {
  lines: LyricLine[]; index: number; time: number; width: number; height: number;
  fontSize: number; regionWidth: number; mode: CompositionMode; reduced: boolean;
  backgroundOpacity: number; fontStyle?: LyricFontStyle; palette?:LyricPalette;readability?:'soft'|'contrast';
  audio?: Readonly<LyricAudio>;
  quality?: RenderQuality; flow?: 'flight' | 'aurora' | 'drift';
}

const clamp = (n: number) => Math.max(0, Math.min(1, n))
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t) }
function compose(context: CanvasRenderingContext2D, line: LyricLine, frame: CompositionFrame): Composition {
  const { width: w, height: h } = frame, letters = timedGlyphs(line), style = frame.fontStyle ?? 'modern'
  const desired = 72 * w / (1920 * frame.regionWidth) * 2.35
  let base = Math.min(desired, h * .48)
  const weight = lyricWeight(style, base, 'stardust')
  let metrics = measureLyricGlyphs(context, letters, base, style, 'stardust', weight)
  const fit = base * Math.min(1, w * .60 / Math.max(1, metrics.reduce((sum, metric) => sum + metric.advance, 0)))
  const largest = Math.min(72 * w / (1920 * frame.regionWidth) * 2.35, fit)
  const smallest = Math.min(18 * w / (1920 * frame.regionWidth) * 2.35, largest * .65)
  base = smallest + (largest - smallest) * clamp((frame.fontSize - 18) / 54)
  metrics = measureLyricGlyphs(context, letters, base, style, 'stardust', weight)
  const total = metrics.reduce((sum, metric) => sum + metric.advance, 0)
  let cursor = 0
  const glyphs = letters.map((glyph, index) => {
    const metric = metrics[index], width = metric.advance
    const t = (cursor + metric.leading + metric.width / 2) / Math.max(1, total)
    cursor += width
    return { ...glyph, arcAngle: t, size: base * metric.scale, width,
      weight, baseline: metric.baseline, opacity: metric.opacity }
  })
  return { glyphs }
}

export class KineticComposition {
  private expressive = new ExpressiveComposition()
  private cache = new Map<string,Composition>()
  private dust = new GlyphDust()
  private document?: LyricLine[]
  particles = 0
  private transitioning = false
  get isTransitioning() { return this.transitioning }
  private composition(context:CanvasRenderingContext2D,line:LyricLine,frame:CompositionFrame){
    const key=`${frame.fontStyle}|${frame.mode}|${frame.width}|${frame.height}|${frame.fontSize}|${frame.regionWidth}|${line.start}|${line.end}|${line.text}|${line.words.map(w=>`${w.text}:${w.start}:${w.end}`).join(',')}`
    let composition=this.cache.get(key)
    if(!composition){composition=compose(context,line,frame);this.cache.set(key,composition);if(this.cache.size>4)this.cache.delete(this.cache.keys().next().value!)
      for(const glyph of composition.glyphs)if(!glyph.hidden&&glyph.text.trim())this.dust.prepare(glyph.text,frame.fontStyle??'modern',glyph.weight)}
    return composition
  }
  private continuousHandoff(frame: CompositionFrame) {
    const previous = frame.lines[frame.index - 1]
    const release = previous ? lyricRelease(previous.start, Math.min(previous.end, frame.lines[frame.index].start), frame.time) : 1
    this.transitioning = !frame.reduced && release > 0 && release < 1
    return this.transitioning ? previous : undefined
  }
  private pose(glyph: PlacedGlyph, frame: CompositionFrame, progress: number, exit = 0) {
    const pose = lyricOrbit(glyph.arcAngle, progress, frame.width, frame.height, frame.reduced)
    return { x: pose.x, y: pose.y - exit * frame.height * .12, angle: pose.angle,
      scale: pose.scale * (.65 + .35 * (1 - Math.abs(glyph.arcAngle * 2 - 1))) }
  }
  private drawLine(context: CanvasRenderingContext2D, composition: Composition, line: LyricLine, frame: CompositionFrame,
    progress: number, opacity: number, release = 0, letters = true) {
    const { reduced } = frame, palette = frame.palette ?? defaultLyricPalette
    const age = frame.time - line.start
    const reveal = reduced ? 1 : .86 + .14 * smooth(age / 140)
    const count = composition.glyphs.filter(g => !g.hidden && g.text.trim()).length
    const perGlyph = Math.floor(lyricRenderBudget(frame.quality).particles / Math.max(1, count))
    context.save()
    for (const glyph of composition.glyphs) {
      if (glyph.hidden) continue
      const pose = this.pose(glyph, frame, progress, release)
      const sung = glyph.timed ? smooth((frame.time - glyph.start) / Math.max(1, glyph.end - glyph.start)) : 0
      context.save(); context.translate(pose.x, pose.y); context.rotate(pose.angle); context.scale(pose.scale, pose.scale)
      context.font = lyricFont(glyph.size, frame.fontStyle, glyph.weight)
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.globalAlpha = opacity * reveal * glyph.opacity
      context.save()
      if (release > 0) {
        const cut = clamp(release / .32)
        const inkWidth = this.dust.prepare(glyph.text, frame.fontStyle ?? 'modern', glyph.weight).width * glyph.size / 64
        context.beginPath(); context.rect(-inkWidth / 2 + cut * inkWidth, -glyph.size, (1 - cut) * inkWidth, glyph.size * 2); context.clip()
      }
      if (letters && frame.readability === 'contrast') {
        context.strokeStyle = palette.shadow; context.lineWidth = Math.max(1, glyph.size * .045); context.lineJoin = 'round'
        context.strokeText(glyph.text, 0, glyph.baseline)
      }
      const members = composition.glyphs.filter(g => g.start === glyph.start && g.end === glyph.end && !g.hidden)
      const wordWidth = members.reduce((sum, g) => sum + g.width, 0)
      const offset = members.slice(0, members.indexOf(glyph)).reduce((sum, g) => sum + g.width, 0) + glyph.width / 2 - wordWidth / 2
      const wordProgress = glyph.timed ? clamp((frame.time - glyph.start) / Math.max(1, glyph.end - glyph.start)) : clamp((frame.time - glyph.start) / 650)
      const active = frame.time >= glyph.start && frame.time < (glyph.timed ? glyph.end : glyph.start + 650)
      context.fillStyle = lyricInk(context, palette, wordWidth, glyph.size, glyph.timed ? sung : 1, wordProgress, active, reduced, offset)
      if (letters) context.fillText(glyph.text, 0, glyph.baseline)
      context.restore()
      if (!reduced) this.particles += this.dust.draw(context, glyph.text, glyph.size, frame.fontStyle ?? 'modern', glyph.weight,
        release, palette, perGlyph, lyricAccent(frame.audio), frame.flow)
      context.restore()
    }
    context.restore()
  }
  draw(context: CanvasRenderingContext2D, frame: CompositionFrame) {
    const {width:w,height:h,lines,index,time,mode,reduced}=frame,palette=frame.palette??defaultLyricPalette
    this.particles = 0
    this.transitioning = false
    if (this.document !== lines) { this.cache.clear(); this.dust.clear(); this.document = lines }
    context.clearRect(0,0,w,h)
    this.background(context,frame,palette)
    if (mode !== 'stardust') {
      this.transitioning = this.expressive.draw(context, frame)
      this.particles = this.expressive.particles
      return
    }
    const line=lines[index]
    if(!line){context.save();context.fillStyle=palette.unsung;context.font=lyricFont(Math.min(h*.14,w*.05),frame.fontStyle);context.textAlign='center';context.textBaseline='middle';context.fillText('·  ·  ·',w*.5,h*.48);context.restore();return}
    if(time>=Math.min(line.end,lines[index+1]?.start??Infinity)+(reduced?0:430)){this.transitioning=false;return}
    const composition=this.composition(context,line,frame),age=time-line.start
    const progress=clamp(age/Math.max(1,line.end-line.start))
    const outgoing = this.continuousHandoff(frame)
    const release = reduced ? 0 : lyricRelease(line.start, Math.min(line.end, lines[index + 1]?.start ?? Infinity), time)
    if(!reduced)this.contextLines(context, frame, progress, palette, !!outgoing)
    if (outgoing && release === 0) {
      const exit = lyricRelease(outgoing.start, Math.min(outgoing.end, line.start), time)
      const outgoingProgress = clamp((time - outgoing.start) / Math.max(1, outgoing.end - outgoing.start))
      this.drawLine(context, this.composition(context, outgoing, frame), outgoing, frame, outgoingProgress, 1, exit, false)
    }
    if (time < line.end + (reduced ? 0 : 430)) this.drawLine(context, composition, line, frame, progress, 1, release)
    if(mode==='stardust'){
      const audio = reduced ? undefined : frame.audio
      context.save();context.strokeStyle=palette.accent;context.globalAlpha=.18+(audio?.impact??0)*.38;context.lineWidth=.7+(audio?.treble??0)*.7;context.beginPath()
      for(let i=0;i<=70;i++){const p=lyricOrbit(i/70,progress,w,h,reduced),x=p.x,y=p.y+h*.17;if(i)context.lineTo(x,y);else context.moveTo(x,y)}context.stroke()
      if(!reduced){
        const p=lyricOrbit(progress,progress,w,h,false);context.globalAlpha=.65;context.fillStyle=palette.accent;context.beginPath();context.arc(p.x,p.y+h*.17,1.6,0,Math.PI*2);context.fill()
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
