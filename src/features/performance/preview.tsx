import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SpectrumCanvas } from '../spectrum/spectrum-canvas'
import { defaults } from '../spectrum/model'
import { PerformancePreview } from './runtime'
import { exampleShow, originalMapping, type Cue, type Show } from './model'

export function ShowPreview({show,selectedCue}:{show:Show;selectedCue?:Cue}){
  const [comparison,setComparison]=useState(false),[playing,setPlaying]=useState(false)
  const clock=useRef({position:0,at:performance.now(),playing:false}),slider=useRef<HTMLInputElement>(null),label=useRef<HTMLOutputElement>(null)
  const bands=useRef(new Float32Array(96)),receivedAt=useRef(0)
  const duration=Math.max(36000,...show.cues.map(c=>c.timeMs+(c.action.type==='camera'?c.action.durationMs:4000)))
  const time=useCallback(()=>Math.min(duration,clock.current.position+(clock.current.playing?performance.now()-clock.current.at:0)),[duration])
  const seek=(position:number)=>{clock.current={...clock.current,position,at:performance.now()}}
  useEffect(()=>{if(selectedCue)clock.current={...clock.current,position:selectedCue.timeMs,at:performance.now()}},[selectedCue?.id,selectedCue?.timeMs])
  useEffect(()=>{
    let raf=0
    const tick=()=>{const t=time();if(slider.current)slider.current.value=String(t);if(label.current)label.current.textContent=`${(t/1000).toFixed(1)} / ${(duration/1000).toFixed(0)} s`;raf=requestAnimationFrame(tick)}
    raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf)
  },[time,duration])
  const specimen=useMemo(()=>({...exampleShow(),id:'mapping-comparison',region:show.region,cues:[exampleShow().cues[0]]}),[show.region])
  const settings=useMemo(()=>({...structuredClone(defaults),enabled:true,effect:'tidal_knot' as const,quality:'balanced' as const,sceneMode:'immersive' as const,bounds:{x:0,y:0,width:1,height:1},opacity:90}),[])
  const canvas=<SpectrumCanvas regionId={show.region} settings={settings} demo bands={bands} receivedAt={receivedAt} interactive={false}/>
  return <div className="performance-preview" data-testid="performance-preview">
    <div className="performance-row"><button aria-pressed={!comparison} onClick={()=>setComparison(false)}>完整演出</button><button aria-pressed={comparison} onClick={()=>setComparison(true)}>同输入 · 映射对照</button><span>模拟音频 · 独立预演</span></div>
    {comparison?<div className="performance-comparison">{(['bend','unfold'] as const).map(target=><div key={target}><strong>{target==='bend'?'低频 → 路径弯曲':'低频 → 局部展开'}</strong><PerformancePreview show={specimen} time={time} mapping={{...originalMapping,preset:target,target,amount:1}}>{canvas}</PerformancePreview></div>)}</div>:
      <div className="performance-screen"><PerformancePreview show={show} time={time}>{canvas}</PerformancePreview></div>}
    <div className="performance-row"><button onClick={()=>{const position=time();clock.current={position,at:performance.now(),playing:!playing};setPlaying(!playing)}}>{playing?'暂停预演':'播放预演'}</button><button onClick={()=>seek(0)}>回到开头</button><output ref={label}/></div>
    <input ref={slider} aria-label="预演播放头" type="range" min="0" max={duration} step="50" defaultValue="0" onChange={e=>seek(Number(e.target.value))}/>
    <div className="performance-ticks">{show.cues.map(c=><button key={c.id} title={`${c.timeMs/1000} 秒`} onClick={()=>seek(c.timeMs)}>{(c.timeMs/1000).toFixed(1)} · {c.action.type==='scene'?c.action.name:c.action.type==='palette'?'配色':'运镜'}</button>)}</div>
    <p>拖动播放头查看任意时刻的画面，不会改变播放器进度。</p>
  </div>
}
