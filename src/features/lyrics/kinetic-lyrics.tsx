import { useEffect, useRef } from 'react'
import { activeLine, type LyricLine } from './model'
import { KineticComposition, type CompositionMode } from './kinetic-composition'
import type { LyricPalette } from './lyric-palette'

type Props={lines:LyricLine[];index:number;time:number;fontSize:number;regionWidth:number;mode:CompositionMode;reduced:boolean;
  backgroundOpacity?:number;palette?:LyricPalette;readability?:'soft'|'contrast';readTime?:()=>number}
export function KineticLyrics(props:Props){
  const canvas=useRef<HTMLCanvasElement>(null),engine=useRef(new KineticComposition()),latest=useRef(props),draw=useRef<()=>void>(()=>{})
  latest.current=props
  useEffect(()=>{
    const node=canvas.current!,context=node.getContext('2d');if(!context)return
    let width=0,height=0,frame=0,last=0
    draw.current=()=>{
      const p=latest.current;if(!width||!height)return
      const scale=Math.min(devicePixelRatio||1,2,Math.sqrt(2400000/(width*height)))
      const pw=Math.max(1,Math.round(width*scale)),ph=Math.max(1,Math.round(height*scale))
      if(node.width!==pw||node.height!==ph){node.width=pw;node.height=ph}
      const time=p.readTime?p.readTime():p.time,index=p.readTime?activeLine(p.lines,time):p.index
      context.setTransform(scale,0,0,scale,0,0)
      engine.current.draw(context,{...p,time,index,width,height,backgroundOpacity:p.backgroundOpacity??30})
      node.dataset.time=String(Math.round(time));node.dataset.composition=p.mode;node.dataset.line=String(index);node.dataset.backgroundOpacity=String(p.backgroundOpacity??30)
    }
    const measure=()=>{width=node.clientWidth;height=node.clientHeight;draw.current()}
    const observer=new ResizeObserver(measure);observer.observe(node);measure()
    const tick=(now:number)=>{if(latest.current.readTime&&now-last>=(latest.current.reduced?66:16)){draw.current();last=now}frame=requestAnimationFrame(tick)}
    frame=requestAnimationFrame(tick)
    return()=>{cancelAnimationFrame(frame);observer.disconnect();draw.current=()=>{}}
  },[])
  useEffect(()=>draw.current(),[props])
  return <canvas ref={canvas} className="kinetic-lyrics-canvas" aria-hidden="true" />
}
