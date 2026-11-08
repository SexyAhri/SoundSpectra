import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import type { SceneBounds } from './model'

export interface SceneFocus {
  bounds: SceneBounds | null
  lineKey: string | null
  revision: number
  backgroundOpacity: number
}
export const emptySceneFocus = (): SceneFocus => ({bounds:null,lineKey:null,revision:0,backgroundOpacity:0})
const Context=createContext<{current:SceneFocus}|null>(null)

/** Each preview/desktop surface owns its focus; no global state or persisted layout. */
export function SceneFocusProvider({children}:{children:ReactNode}) {
  const focus=useRef<SceneFocus>(emptySceneFocus())
  return <Context.Provider value={focus}>{children}</Context.Provider>
}
export const useSceneFocus=()=>useContext(Context)

/** Mounted only while readable lyrics are actually present, after obstacle avoidance. */
export function LyricSceneFocus({bounds,lineKey,backgroundOpacity}:{bounds:SceneBounds;lineKey:string;backgroundOpacity:number}) {
  const focus=useSceneFocus()
  useEffect(()=>{
    if(focus)focus.current={bounds:{...bounds},lineKey,backgroundOpacity,revision:focus.current.revision+1}
  },[focus,bounds.x,bounds.y,bounds.width,bounds.height,lineKey,backgroundOpacity])
  useEffect(()=>()=>{
    if(focus)focus.current={bounds:null,lineKey:null,backgroundOpacity:0,revision:focus.current.revision+1}
  },[focus])
  return null
}
