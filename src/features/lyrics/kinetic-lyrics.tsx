import { useEffect, useRef } from 'react'
import { activeLine, type LyricLine } from './model'
import { KineticComposition, type CompositionMode } from './kinetic-composition'
import type { LyricPalette } from './lyric-palette'
import type { LyricFontStyle } from './lyric-typography'
import { useLyricFont } from './use-lyric-font'

type Props={fontStyle?:LyricFontStyle;lines:LyricLine[];index:number;time:number;fontSize:number;regionWidth:number;mode:CompositionMode;reduced:boolean;
  backgroundOpacity?:number;palette?:LyricPalette;readability?:'soft'|'contrast';readTime?:()=>number;playing?:boolean;desktop?:boolean}
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
      const scale=Math.min(devicePixelRatio||1,2,Math.sqrt(2400000/(width*height)))
      const pw=Math.max(1,Math.round(width*scale)),ph=Math.max(1,Math.round(height*scale))
      const time=p.readTime?p.readTime():p.time,index=p.readTime?activeLine(p.lines,time):p.index
      // Media polling and accessibility updates must not repaint a paused lyric.
      const signature=[p.lines,time,index,p.fontSize,p.regionWidth,p.mode,p.fontStyle,p.reduced,p.backgroundOpacity??30,p.palette,p.readability,width,height,pw,ph]
      if(signature.every((value,index)=>Object.is(value,painted[index])))return
      if(node.width!==pw||node.height!==ph){node.width=pw;node.height=ph}
      context.setTransform(scale,0,0,scale,0,0)
      engine.current.draw(context,{...p,time,index,width,height,backgroundOpacity:p.backgroundOpacity??30})
      painted=signature
      node.dataset.time=String(Math.round(time));node.dataset.composition=p.mode;node.dataset.line=String(index);node.dataset.backgroundOpacity=String(p.backgroundOpacity??30);node.dataset.transition=String(engine.current.isTransitioning)
      node.dataset.fontStyle=p.fontStyle??'modern';node.dataset.fontsReady='true'
      node.dataset.fontSize=String(p.fontSize);node.dataset.readability=p.readability??'soft'
    }
    const measure=()=>{width=node.clientWidth;height=node.clientHeight;draw.current()}
    const observer=new ResizeObserver(measure);observer.observe(node);measure()
    return()=>{observer.disconnect();draw.current=()=>{}}
  },[])
  useEffect(()=>draw.current(),[props,fontsReady])
  const live=!!props.readTime&&props.playing!==false
  useEffect(()=>{
    let frame=0,last=0
    const tick=(now:number)=>{
      if(now-last>=(latest.current.reduced?66:16)){draw.current();last=now}
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
