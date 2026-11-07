import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import type { SceneBounds } from './model'

export interface SceneFocus {
  bounds: SceneBounds | null
  lineKey: string | null
  revision: number
}
export const emptySceneFocus = (): SceneFocus => ({bounds:null,lineKey:null,revision:0})
const Context=createContext<{current:SceneFocus}|null>(null)

/** Each preview/desktop surface owns its focus; no global state or persisted layout. */
export function SceneFocusProvider({children}:{children:ReactNode}) {
  const focus=useRef<SceneFocus>(emptySceneFocus())
  return <Context.Provider value={focus}>{children}</Context.Provider>
}
export const useSceneFocus=()=>useContext(Context)

/** Mounted only while readable lyrics are actually present, after obstacle avoidance. */
export function LyricSceneFocus({bounds,lineKey}:{bounds:SceneBounds;lineKey:string}) {
  const focus=useSceneFocus()
  useEffect(()=>{
    if(focus)focus.current={bounds:{...bounds},lineKey,revision:focus.current.revision+1}
  },[focus,bounds.x,bounds.y,bounds.width,bounds.height,lineKey])
  useEffect(()=>()=>{
    if(focus)focus.current={bounds:null,lineKey:null,revision:focus.current.revision+1}
  },[focus])
  return null
}
