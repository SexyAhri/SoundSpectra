import { useEffect, useRef } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { native } from '../spectrum/bridge'
import type { RailController } from './use-rail'
export function useRailDrop(controller: RailController, selected: string | null, active: boolean) {
  const current = useRef({ controller, selected, active }); current.current = { controller, selected, active }
  useEffect(() => {
    if (!native) return
    let disposed = false, stop: (() => void) | undefined
    void getCurrentWebview().onDragDropEvent(event => {
      if (event.payload.type !== 'drop' || !current.current.active) return
      const { position, paths } = event.payload, ratio = window.devicePixelRatio
      const hovered = document.elementFromPoint(position.x / ratio, position.y / ratio)?.closest<HTMLElement>('[data-rail-group]')?.dataset.railGroup
      const group = hovered ?? current.current.selected ?? current.current.controller.settings.groups[0]?.id
      if (group) void current.current.controller.add(group, paths).catch(() => {})
    }).then(unsubscribe => { if (disposed) unsubscribe(); else stop = unsubscribe }).catch(() => {})
    return () => { disposed = true; stop?.() }
  }, [])
}
