import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { SceneBounds } from '../spectrum/model'
import { moveBounds, resizeBounds } from '../preview/preview-geometry'

export function WallpaperAreaEditor({ bounds, onChange }: { bounds: SceneBounds; onChange: (value: SceneBounds) => void }) {
  const [draft, setDraft] = useState<SceneBounds | null>(null)
  const gesture = useRef<{ pointer: number; x: number; y: number; width: number; height: number; start: SceneBounds; next: SceneBounds; resize: boolean } | null>(null)
  useEffect(() => { gesture.current = null; setDraft(null) }, [bounds])
  const begin = (event: PointerEvent<HTMLElement>, resize: boolean) => {
    if (event.button !== 0 || gesture.current) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus()
    const box = event.currentTarget.closest('.desktop-preview')!.getBoundingClientRect()
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, width: box.width, height: box.height, start: bounds, next: bounds, resize }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const g = gesture.current
    if (!g || g.pointer !== event.pointerId) return
    g.next = (g.resize ? resizeBounds : moveBounds)(g.start, (event.clientX - g.x) / g.width, (event.clientY - g.y) / g.height)
    setDraft(g.next)
  }
  const finish = (event: PointerEvent<HTMLElement>, cancelled = false) => {
    const g = gesture.current
    if (!g || g.pointer !== event.pointerId) return
    gesture.current = null; setDraft(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancelled) onChange(g.next)
  }
  const keyboard = (event: KeyboardEvent<HTMLElement>, resize: boolean) => {
    if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); gesture.current = null; setDraft(null); return }
    if (gesture.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const step = event.shiftKey ? .02 : .002
    onChange((resize ? resizeBounds : moveBounds)(bounds, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0))
  }
  const b = draft ?? bounds
  return <div className="wallpaper-area-editor" role="group" aria-label="微光区域，方向键移动" tabIndex={0}
    style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.width * 100}%`, height: `${b.height * 100}%` }}
    onPointerDown={event => begin(event, false)} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)} onKeyDown={event => keyboard(event, false)}>
    <span className="wallpaper-area-label">微光区域 · 拖动位置</span>
    <button className="preview-resize" aria-label="缩放微光区域" onPointerDown={event => begin(event, true)} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)} onKeyDown={event => keyboard(event, true)} />
  </div>
}
