import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import type { DesktopCardSettings, SceneBounds } from '../spectrum/model'
import { relativeBounds } from '../spectrum/regions'
import type { NowPlaying } from './use-now-playing'
import { MusicCard } from './music-card'

export function CardLayer({ settings, info, color, bands, receivedAt, demo = false, active = true, desktop = false, host, arranging = false, onChange, onSelect }: {
  settings: DesktopCardSettings; info: NowPlaying; color: string; bands: RefObject<Float32Array>; receivedAt: RefObject<number>;
  demo?: boolean; active?: boolean; desktop?: boolean; host?: SceneBounds; arranging?: boolean; onChange?: (bounds: SceneBounds) => void;
  onSelect?: () => void;
}) {
  const [draft, setDraft] = useState<SceneBounds | null>(null)
  const drag = useRef<{ id: number; x: number; y: number; width: number; height: number; start: SceneBounds; next: SceneBounds } | null>(null)
  useEffect(() => { if (!arranging) { drag.current = null; setDraft(null) } }, [arranging])
  const move = (b: SceneBounds, dx: number, dy: number) => ({ ...b, x: Math.max(0, Math.min(1 - b.width, b.x + dx)), y: Math.max(0, Math.min(1 - b.height, b.y + dy)) })
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (!arranging || event.button !== 0 || drag.current) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus()
    const rect = event.currentTarget.parentElement!.getBoundingClientRect()
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, start: settings.bounds, next: settings.bounds }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moving = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    current.next = move(current.start, (event.clientX - current.x) / current.width, (event.clientY - current.y) / current.height)
    setDraft(current.next)
  }
  const end = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancel) onChange?.(current.next)
    setDraft(null)
  }
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!arranging) return
    if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); drag.current = null; setDraft(null); return }
    if (!event.key.startsWith('Arrow') || drag.current) return
    event.preventDefault(); event.stopPropagation()
    const step = event.shiftKey ? .02 : .002
    onChange?.(move(settings.bounds, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0))
  }
  const b = host ? relativeBounds(draft ?? settings.bounds, host) : draft ?? settings.bounds
  return <div className={`music-card-layer ${arranging ? 'arrange-card' : ''}`} data-testid="music-card-layer" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.width * 100}%`, height: `${b.height * 100}%` }} role={arranging ? 'group' : undefined} tabIndex={arranging ? 0 : undefined} aria-label={arranging ? '音乐卡片位置，方向键移动' : undefined} onFocus={arranging ? onSelect : undefined} onPointerDown={begin} onPointerMove={moving} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)} onKeyDown={keyboard}>
    <MusicCard info={info} settings={settings} color={color} bands={bands} receivedAt={receivedAt} demo={demo} active={active} desktop={desktop} />
  </div>
}
