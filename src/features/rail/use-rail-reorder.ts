import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { RailChange, RailGroup } from './model'

// Keep local reordering separate from WebView2's native file-drop handler.
export function useRailReorder(groups: RailGroup[], move: (change: RailChange) => void) {
  const gesture = useRef<{ id: string; pointer: number; x: number; y: number; source: HTMLElement; dragging: boolean } | null>(null)
  const suppressClick = useRef(false)
  const [target, setTarget] = useState<string | null>(null)
  const cancel = () => {
    const current = gesture.current
    gesture.current = null
    if (current?.source.hasPointerCapture(current.pointer)) current.source.releasePointerCapture(current.pointer)
    setTarget(null)
  }
  useEffect(() => {
    window.addEventListener('blur', cancel)
    return () => { window.removeEventListener('blur', cancel); cancel() }
  }, [])
  const destination = (event: PointerEvent) => {
    const element = document.elementFromPoint(event.clientX, event.clientY)
    if (element?.closest('.rail-popup:not(.rail-popup-more)')) return null
    const group = groups.find(value => value.id === element?.closest<HTMLElement>('[data-rail-group]')?.dataset.railGroup)
    if (!group) return null
    const item = element?.closest<HTMLElement>('[data-rail-item]')?.dataset.railItem
    const index = item ? group.items.findIndex(value => value.id === item) : group.items.length
    return index < 0 ? null : { group, item, index }
  }
  const preventClick = (event: MouseEvent) => {
    if (!suppressClick.current) return
    event.preventDefault()
    event.stopPropagation()
  }
  return {
    target,
    events: {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || !event.isPrimary) return
        suppressClick.current = false
        const source = (event.target as Element).closest<HTMLElement>('.rail-item')
        const id = source?.closest<HTMLElement>('[data-rail-item]')?.dataset.railItem
        if (source && id) gesture.current = { id, source, pointer: event.pointerId, x: event.clientX, y: event.clientY, dragging: false }
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const current = gesture.current
        if (!current || current.pointer !== event.pointerId) return
        if (!(event.buttons & 1)) { cancel(); return }
        if (!current.dragging && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return
        if (!current.dragging) {
          current.dragging = true
          suppressClick.current = true
          current.source.setPointerCapture(current.pointer)
        }
        event.preventDefault()
        const next = destination(event)
        setTarget(next?.item ?? null)
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        const current = gesture.current
        if (!current || current.pointer !== event.pointerId) return
        const next = current.dragging ? destination(event) : null
        cancel()
        if (next && next.item !== current.id) move({ type: 'move', id: current.id, groupId: next.group.id, index: next.index })
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onKeyDown(event: KeyboardEvent<HTMLDivElement>) { if (event.key === 'Escape') cancel() },
      onClickCapture: preventClick,
      onDoubleClickCapture: preventClick,
    },
  }
}
