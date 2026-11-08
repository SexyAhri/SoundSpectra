import { useEffect, useRef } from 'react'
import { activeLine, type LyricLine } from './model'
import { KineticComposition, type CompositionMode } from './kinetic-composition'
import type { LyricPalette } from './lyric-palette'
import type { LyricFontStyle } from './lyric-typography'
import { useLyricFont } from './use-lyric-font'
import { quietLyricAudio, type LyricAudio } from './lyric-audio'
import type { RenderQuality } from '../spectrum/model'
import { FrameBudget } from '../spectrum/render-budget'
import { lyricRenderBudget } from './lyric-render-budget'

type Props={fontStyle?:LyricFontStyle;lines:LyricLine[];index:number;time:number;fontSize:number;regionWidth:number;mode:CompositionMode;reduced:boolean;
  quality?:RenderQuality;flow?:'flight'|'aurora'|'drift';backgroundOpacity?:number;palette?:LyricPalette;readability?:'soft'|'contrast';readTime?:()=>number;readAudio?:()=>Readonly<LyricAudio>;playing?:boolean;desktop?:boolean}
export function KineticLyrics(props:Props){
  const canvas=useRef<HTMLCanvasElement>(null),engine=useRef(new KineticComposition()),latest=useRef(props),draw=useRef<()=>void>(()=>{})
  const fontsReady=useLyricFont(props.lines,props.fontStyle)
  latest.current=props
  const ready=useRef(fontsReady);ready.current=fontsReady
  useEffect(()=>{
    const node=canvas.current!,context=node.getContext('2d');if(!context)return
    let width=0,height=0,painted:unknown[]=[]
    draw.current=()=>{
      const p=latest.current;if(!width||!height||!ready.current||!p.desktop&&document.hidden)return
      const budget=lyricRenderBudget(p.quality,p.reduced)
      const scale=Math.min(devicePixelRatio||1,budget.scale,Math.sqrt(budget.pixels/(width*height)),4096/Math.max(width,height))
      const pw=Math.max(1,Math.round(width*scale)),ph=Math.max(1,Math.round(height*scale))
      const time=p.readTime?p.readTime():p.time,index=p.readTime?activeLine(p.lines,time):p.index
      const audio = !p.reduced && p.playing !== false ? p.readAudio?.() ?? quietLyricAudio : quietLyricAudio
      // Media polling and accessibility updates must not repaint a paused lyric.
      const signature=[p.lines,time,index,p.fontSize,p.regionWidth,p.mode,p.fontStyle,p.reduced,p.backgroundOpacity??30,p.palette,p.readability,p.quality,p.flow,width,height,pw,ph,audio.bass,audio.body,audio.treble,audio.energy,audio.impact,audio.beatAge,audio.beatStrength]
      if(signature.every((value,index)=>Object.is(value,painted[index])))return
      if(node.width!==pw||node.height!==ph){node.width=pw;node.height=ph}
      context.setTransform(scale,0,0,scale,0,0)
      engine.current.draw(context,{...p,audio,time,index,width,height,backgroundOpacity:p.backgroundOpacity??30})
      painted=signature
      node.dataset.time=String(Math.round(time));node.dataset.composition=p.mode;node.dataset.line=String(index);node.dataset.backgroundOpacity=String(p.backgroundOpacity??30);node.dataset.transition=String(engine.current.isTransitioning)
      node.dataset.fontStyle=p.fontStyle??'modern';node.dataset.fontsReady='true'
      node.dataset.fontSize=String(p.fontSize);node.dataset.readability=p.readability??'soft'
      node.dataset.particles=String(engine.current.particles);node.dataset.quality=p.quality??'balanced';node.dataset.fps=String(budget.fps)
      if (import.meta.env.DEV) node.dataset.frames=String(Number(node.dataset.frames??0)+1)
      if (import.meta.env.DEV) node.dataset.audioImpact=audio.impact.toFixed(3)
    }
    const measure=()=>{width=node.clientWidth;height=node.clientHeight;draw.current()}
    const observer=new ResizeObserver(measure);observer.observe(node);measure()
    return()=>{observer.disconnect();draw.current=()=>{}}
  },[])
  useEffect(()=>draw.current(),[props,fontsReady])
  const live=!!props.readTime&&props.playing!==false
  useEffect(()=>{
    let frame=0
    const budget=new FrameBudget()
    const tick=(now:number)=>{
      const p=latest.current
      if(budget.due(now,lyricRenderBudget(p.quality,p.reduced).fps))draw.current()
      frame=requestAnimationFrame(tick)
    }
    const resume=()=>{
      cancelAnimationFrame(frame)
      // Desktop webviews may report hidden while embedded behind desktop icons.
      if(!props.desktop&&document.hidden)return
      draw.current()
      if(live)frame=requestAnimationFrame(tick)
    }
    resume();document.addEventListener('visibilitychange',resume)
    return()=>{cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',resume)}
  },[live,props.desktop])
  return <canvas ref={canvas} className="kinetic-lyrics-canvas" aria-hidden="true" />
}
