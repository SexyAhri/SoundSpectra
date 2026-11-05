import { useEffect, useState, type CSSProperties } from 'react'
import type { LyricSettings, SceneBounds } from '../spectrum/model'
import { relativeBounds } from '../spectrum/regions'
import type { NowPlaying } from '../desktop-card/use-now-playing'
import { activeLine, demoLyrics, playbackPosition, trackKey, lyricDisplayText, type LyricDocument } from './model'
import './lyrics.css'
import { KineticLyrics } from './kinetic-lyrics'
import { useLyricPlacement } from './use-lyric-placement'

export function LyricLayer({ settings, document, info, demo = false, active = true, desktop = false, host, onBoundsChange, draggable = false, onSelect }: {
  settings: LyricSettings; document: LyricDocument; info: NowPlaying; demo?: boolean; active?: boolean; desktop?: boolean; host?: SceneBounds;
  onBoundsChange?: (bounds: SceneBounds, resized?: boolean) => void; draggable?: boolean;
  onSelect?: () => void;
}) {
  const movable = draggable && !desktop && !!onBoundsChange
  const placement = useLyricPlacement(settings.bounds, movable, onBoundsChange)
  const [clock, setClock] = useState(Date.now()), [demoStart] = useState(Date.now)
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)'), change = () => setReduced(media.matches)
    change(); media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    if (!active || !settings.enabled) return
    let frame = 0, last = 0
    const tick = (now: number) => { if (now - last >= (reduced ? 66 : 16)) { setClock(Date.now()); last = now }; frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active, settings.enabled, reduced])
  if (!settings.enabled || !active) return null
  const simulated = demo && !desktop
  const synced = playbackPosition(info, clock)
  const valid = document.key === trackKey(info) && document.status === 'ready'
  const lines = simulated ? demoLyrics : valid ? document.lines : []
  const demoDuration = (demoLyrics.at(-1)?.end ?? 19200) + 800
  const time = (simulated ? (clock - demoStart) % demoDuration : synced ?? 0) + settings.offsetMs
  const index = activeLine(lines, time), line = lines[index]
  const canShow = simulated || valid && synced !== null
  if (desktop && !canShow) return null
  const b = host ? relativeBounds(placement.bounds, host) : placement.bounds
  const displayFontSize = Math.max(18, Math.min(72, settings.fontSize * Math.sqrt(placement.bounds.width * placement.bounds.height / (settings.bounds.width * settings.bounds.height))))
  return <div className={`lyric-layer lyric-motion-${settings.motion}${movable ? ' is-draggable' : ''}`} data-testid="lyric-layer" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.width * 100}%`, height: `${b.height * 100}%` } as CSSProperties}
    role={movable ? 'group' : undefined} tabIndex={movable ? 0 : undefined} aria-label={movable ? '歌词位置，拖动或方向键移动' : undefined}
    onFocus={movable ? onSelect : undefined} onPointerDown={event => placement.begin(event)} onPointerMove={placement.moving} onPointerUp={event => placement.end(event)} onPointerCancel={event => placement.end(event, true)} onLostPointerCapture={event => placement.end(event, true)} onKeyDown={placement.keyboard}>
    {canShow ? <>
      <KineticLyrics lines={lines} index={index} time={time} fontSize={displayFontSize} regionWidth={placement.bounds.width} mode={settings.motion} reduced={reduced} backgroundOpacity={settings.backgroundOpacity} />
      <span className="sr-only" aria-label="当前歌词">{line ? lyricDisplayText(line.text) : '前奏'}</span>
      {simulated && <span className="lyric-demo-label">模拟歌词</span>}
    </> : <p className="lyric-empty">{valid && synced === null ? '播放器未提供有效播放进度，暂不能同步歌词' : document.message}</p>}
    {movable && <><span className="lyric-drag-hint" aria-hidden="true">拖动歌词</span><button className="lyric-resize" aria-label="缩放歌词" title="拖动缩放歌词区域" onPointerDown={event => placement.begin(event, true)} /></>}
  </div>
}
