import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { RailGroup, RailItem } from './model'

export type RailPopup = {
  mode: 'menu' | 'more' | 'add' | 'note' | 'folder'
  item?: RailItem
  token?: string
  nativeWidth?: number
}
interface Request {
  token: string
  mode: RailPopup['mode']
  itemId: string | null
  left: number
  top: number
  width: number
}
export function useRailPopupWindow(
  role: 'source' | 'host' | undefined,
  group: RailGroup,
  requested: RailPopup | null,
  presented: RailPopup | null,
  setPopup: Dispatch<SetStateAction<RailPopup | null>>,
  layout: { left: number; top: number; width: number },
  panel: RefObject<HTMLElement | null>,
  choose: (id: string) => void,
  report: (error: string) => void,
) {
  const current = useRef({ group, requested, choose, report })
  current.current = { group, requested, choose, report }
  const lastToken = useRef<string | null>(null)
  if (requested?.token) lastToken.current = requested.token
  useEffect(() => {
    if (!role) return
    let disposed = false
    const stops: (() => void)[] = []
    const keep = (stop: () => void) => { if (disposed) stop(); else stops.push(stop) }
    if (role === 'source') {
      void listen<string>('rail-popup-closed', event => {
        setPopup(value => value?.token === event.payload ? null : value)
      }).then(keep).catch(error => { if (!disposed) current.current.report(String(error)) })
      void listen<string>('rail-select-item', event => current.current.choose(event.payload)).then(keep)
        .catch(error => { if (!disposed) current.current.report(String(error)) })
    } else {
      let received = 0
      const accept = (request: Request) => {
        if (disposed) return
        if (request.itemId) current.current.choose(request.itemId)
        setPopup({ mode: request.mode, token: request.token, nativeWidth: request.width,
          item: current.current.group.items.find(item => item.id === request.itemId) })
      }
      void listen<Request>('rail-popup-show', event => { received++; accept(event.payload) }).then(async stop => {
        keep(stop)
        const version = received
        const initial = await invoke<Request | null>('rail_popup_get')
        if (initial && received === version) accept(initial)
      }).catch(error => { if (!disposed) current.current.report(String(error)) })
    }
    return () => { disposed = true; stops.forEach(stop => stop()) }
  }, [role, group.id, setPopup])

  useEffect(() => {
    if (role !== 'source') return
    void invoke('rail_popup', { open: !!requested, request: requested ? {
      token: requested.token, mode: requested.mode, itemId: requested.item?.id ?? null, ...layout,
    } : null }).catch(error => current.current.report(String(error)))
  }, [role, requested?.token, layout.left, layout.top, layout.width])

  useEffect(() => {
    if (role !== 'host' || !presented || !panel.current) return
    const element = panel.current
    let last = ''
    const resize = () => {
      const popup = current.current.requested
      if (!popup?.token) return
      const width = element.offsetWidth, height = element.offsetHeight
      const next = `${popup.token}:${width}:${height}`
      if (next === last || !width || !height) return
      last = next
      void invoke('rail_popup_resize', { token: popup.token, width, height }).catch(error => current.current.report(String(error)))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [role, presented?.token, presented?.mode, panel])

  useEffect(() => {
    if (role !== 'host' || presented || !lastToken.current) return
    const token = lastToken.current
    void invoke('rail_popup_hide', { token }).catch(error => current.current.report(String(error)))
  }, [role, !!presented])
}
