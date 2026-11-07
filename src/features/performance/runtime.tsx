import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { native } from '../spectrum/bridge'
import { emit, listen } from '@tauri-apps/api/event'
import { cardPosition } from '../desktop-card/card-clock'
import type { NowPlaying } from '../desktop-card/use-now-playing'
import type { SpectrumSettings } from '../spectrum/model'
import { applyShow, emptyPerformance, originalMapping, parsePerformance, recordingKey, showState, snapshotKeys, type Mapping, type PerformanceConfig, type Show, type TransitionSettings } from './model'

export const performanceKey='soundspectra.performance.v1'
let config=emptyPerformance, loaded=false,loadIssue=''
const subscribers=new Set<()=>void>()
export function readPerformance(){
  if(!loaded){loaded=true;try{config=parsePerformance(JSON.parse(localStorage.getItem(performanceKey)??JSON.stringify(emptyPerformance)))}catch{loadIssue='已保存的演出配置无法读取；下次成功保存前会先备份原数据。'}}
  return config
}
function publish(){for(const cb of subscribers)cb()}
export const performanceLoadIssue=()=>loadIssue
export function savePerformance(next: PerformanceConfig){
  const value=parsePerformance(next)
  // Persist before publishing; quota/disk failure leaves the running show untouched.
  if(loadIssue){const raw=localStorage.getItem(performanceKey);if(raw!==null)localStorage.setItem(`${performanceKey}.backup.${Date.now()}`,raw)}
  localStorage.setItem(performanceKey,JSON.stringify(value));config=value;loaded=true;loadIssue='';publish()
}
const subscribe=(cb:()=>void)=>{subscribers.add(cb);return()=>{subscribers.delete(cb)}}
if(typeof window!=='undefined')window.addEventListener('storage',event=>{
  if(event.key===performanceKey){try{config=parsePerformance(JSON.parse(event.newValue??'null'));loaded=true;publish()}catch{/* Ignore incomplete/invalid external updates. */}}
})
export function usePerformanceConfig(){return useSyncExternalStore(subscribe,readPerformance)}
export interface PerformanceSession { showId: string; track: string; playerSession?: string }
interface Controller { config: PerformanceConfig; info: {current:NowPlaying}; session: PerformanceSession|null; arm:(value:PerformanceSession|null)=>void; preview?: {show:Show; time:()=>number} }
const Context=createContext<Controller|null>(null)
export function PerformanceProvider({info,children}:{info:NowPlaying;children:ReactNode}){
  const config=usePerformanceConfig(),latest=useRef(info);latest.current=info
  const [session,setSession]=useState<PerformanceSession|null>(null)
  const liveSession=useRef(session);liveSession.current=session
  useEffect(()=>{
    if(!native)return
    let disposed=false;const stops:(()=>void)[]=[]
    const add=async()=>{
      const a=await listen<PerformanceSession|null>('performance-session',e=>{if(!disposed){liveSession.current=e.payload;setSession(current=>JSON.stringify(current)===JSON.stringify(e.payload)?current:e.payload)}})
      const b=await listen('performance-request',()=>{if(liveSession.current)void emit('performance-session',liveSession.current)})
      if(disposed){a();b()}else{stops.push(a,b);await emit('performance-request')}
    };void add();return()=>{disposed=true;stops.forEach(s=>s())}
  },[])
  // Active windows answer a newly created workspace/overlay only after it subscribes.
  // Inactive windows do not overwrite a live session with their initial null state.
  const arm=(next:PerformanceSession|null)=>{liveSession.current=next;setSession(next);if(native)void emit('performance-session',next)}
  useEffect(()=>{
    const key=recordingKey(info)
    if(session&&(key!==null&&key!==session.track||session.playerSession&&info.sessionId&&info.sessionId!==session.playerSession))arm(null)
  },[info,session])
  return <Context.Provider value={{config,info:latest,session,arm}}>{children}</Context.Provider>
}
export function PerformancePreview({show,time,children,mapping}:{show:Show;time:()=>number;children:ReactNode;mapping?:Mapping}){
  const parent=useContext(Context)
  const fallback=useRef({} as NowPlaying)
  const value=useMemo(()=>{const cfg=parent?.config??readPerformance();return {...parent!,config:mapping?{...cfg,mappings:{...cfg.mappings,...Object.fromEntries(['tidal_knot','layered_tides','echo_corridor'].map(e=>[`${show.region}--${e}`,mapping]))}}:cfg,info:parent?.info??fallback,session:null,arm:()=>{},preview:{show,time}}},[parent,show,time,mapping])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export const usePerformance=()=>useContext(Context)
export function performanceStatus(controller:Controller|null){
  if(!controller?.session)return '演出未开启'
  const info=controller.info.current
  if(recordingKey(info)===null)return '播放器信息不可用，自动编排已停用'
  if(recordingKey(info)!==controller.session.track)return '曲目不匹配，自动编排已停用'
  return cardPosition(info,Date.now())===null?'播放器时间不可用，自动编排已停用':'跟随播放器时间 · 手动编辑优先至下一场景标记'
}
/** Per-canvas state, sampled by the existing render loop. No React setState or persistence. */
export class PerformanceFrame {
  private previousBase?:SpectrumSettings
  private signature=''
  private manual=new Set<string>()
  private previousTime:number|null=null
  private previousClock=0
  private lastSettings?:SpectrumSettings
  private lastShow?:Show
  private lastProjection=''
  private lastMapping?:Mapping
  private lastCamera=false
  resolve(controller:Controller|null,base:SpectrumSettings,region:string,reduced:boolean){
    const cfg=controller?.config??readPerformance(),preview=controller?.preview
    const info=controller?.info.current,session=controller?.session
    const show=preview?.show??(session?cfg.shows.find(s=>s.id===session.showId&&s.track===session.track):undefined)
    const time=preview?preview.time():session&&info&&recordingKey(info)===session.track&&(!session.playerSession||session.playerSession===info.sessionId)?cardPosition(info,Date.now()):null
    const current=performance.now(),jump=time!==null&&this.previousTime!==null&&Math.abs(time-this.previousTime-(current-this.previousClock))>450
    this.previousClock=current;this.previousTime=time
    let settings=base,transition=cfg.transition,animate=!jump
    if(show&&show.region===region&&time!==null){
      const state=showState(show,time,reduced),signature=`${show.id}:${state.signature}`
      if(signature!==this.signature){this.manual.clear();this.signature=signature}
      else if(this.previousBase&&this.previousBase!==base)for(const key of snapshotKeys){
        const a=base[key],b=this.previousBase[key]
        if(a&&b&&typeof a==='object'&&typeof b==='object'){
          for(const child of Object.keys(a))if((a as unknown as Record<string,unknown>)[child]!== (b as unknown as Record<string,unknown>)[child])this.manual.add(`${key}.${child}`)
        }else if(a!==b)this.manual.add(key)
      }
      const projection=`${signature}:${state.palette??''}:${[...this.manual].join(',')}`
      if(!state.camera&&!this.lastCamera&&this.lastShow===show&&this.previousBase===base&&this.lastProjection===projection)settings=this.lastSettings??base
      else{
        settings=applyShow(base,state)
        for(const path of this.manual){
          const [key,child]=path.split('.') as [typeof snapshotKeys[number],string|undefined]
          if(child){const original=base[key] as unknown as Record<string,unknown>;Object.assign(settings,{[key]:{...settings[key] as object,[child]:original[child]}})}
          else Object.assign(settings,{[key]:base[key]})
        }
      }
      this.lastShow=show;this.lastProjection=projection;this.lastCamera=!!state.camera
      transition=state.scene?.transition??transition
      // A late enable or a seek reconstructs directly; do not replay a historical entrance.
      if(state.sceneTime!==undefined&&time-state.sceneTime>transition.durationMs+500)animate=false
    }else{this.signature='';this.manual.clear();this.lastShow=undefined;this.lastCamera=false}
    const mapping:Mapping=cfg.mappings[`${region}--${settings.effect}`]??originalMapping
    // Ordinary props already invalidate via the canvas's visual signature.
    // Media polls can recreate base without changing any visual value; only a
    // performance projection (including its removal) needs this extra redraw.
    const wasProjected=this.lastSettings!==undefined&&this.lastSettings!==this.previousBase
    const changed=(settings!==base||wasProjected)&&settings!==this.lastSettings||mapping!==this.lastMapping
    this.previousBase=base
    this.lastSettings=settings;this.lastMapping=mapping
    return {settings,transition,animate,mapping,changed}
  }
}
export type FrameOptions={transition:TransitionSettings;animate:boolean;mapping:Mapping}
