import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Disc3 } from 'lucide-react'
import type { DesktopCardSettings } from '../spectrum/model'
import type { NowPlaying } from './use-now-playing'
import { cardTrackKey, useCardCover } from './card-presentation'
import { useCardClock } from './card-clock'
import { CardMeter } from './card-meter'
import { CardTransport } from './card-transport'
import './card-design.css'

export function MusicCard({ info, settings, color, bands, receivedAt, demo = false, active = true, desktop = false, controlsDisabled = false, controlsOnly = false }: { info: NowPlaying; settings: DesktopCardSettings; color: string; bands: RefObject<Float32Array>; receivedAt: RefObject<number>; demo?: boolean; active?: boolean; desktop?: boolean; controlsDisabled?: boolean; controlsOnly?: boolean }) {
  const root = useRef<HTMLElement>(null)
  const cover = useCardCover(controlsOnly ? { ...info, cover: null } : info)
  const key = cardTrackKey(info)
  const previous = useRef(key)
  const [expiredAt, setExpiredAt] = useState(0)
  useEffect(() => {
    if (!info.updated) return
    const timer = window.setTimeout(() => setExpiredAt(info.updated), Math.max(0, 4001 - (Date.now() - info.updated)))
    return () => clearTimeout(timer)
  }, [info.updated])
  useCardClock(info, root, active && !controlsOnly, desktop, demo)
  useLayoutEffect(() => {
    if (previous.current === key) return
    previous.current = key
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const nodes = root.current?.closest('.mc-native-controls') ? undefined : root.current?.querySelectorAll('.mc-title, .mc-artist, .mc-sleeve, .mc-square, .mc-paper-art')
    nodes?.forEach(node => { node.getAnimations().forEach(animation => animation.cancel()); node.animate([{ opacity: .35 }, { opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.2,.7,.2,1)' }) })
  }, [key])
  const title = info.title || info.source || (demo ? '音乐信息预览' : '等待音乐')
  const artist = info.artist || (!info.title ? info.source ? '播放器未提供歌曲信息' : '打开音乐客户端，开始播放' : '')
  const stale = !info.updated || expiredAt === info.updated || Date.now() - info.updated > 4000
  const reportedPlaying = info.playing && info.playbackAvailable !== false && !stale && !info.issue
  const status = demo ? '模拟预览' : info.issue ? '连接中' : info.source && (info.playbackAvailable === false || stale) ? '媒体状态待确认' : reportedPlaying ? '播放中' : info.source ? '已暂停' : '音乐待机'
  const art = cover ? <img src={cover} alt="" /> : <Disc3 />
  const meter = <CardMeter {...{ bands, receivedAt, desktop, demo }} active={active && !controlsOnly} variant={settings.variant} />
  const accent = settings.accentColor || color
  return <article ref={root} className={`music-card music-card-${settings.variant} mc mc-${settings.variant}`} data-playing={reportedPlaying && !demo && active && !controlsOnly} data-active={active} data-track={key} aria-label="桌面音乐信息卡" style={{ '--mc-accent': accent } as CSSProperties}>
    <div className="mc-shell">
      {settings.variant === 'record' ? <div className="mc-record-art" aria-hidden="true"><div className="mc-disc-mount"><div className="vinyl-disc mc-disc"><div className="mc-label">{art}</div></div><span className="mc-sheen" /></div><div className="mc-sleeve">{art}<span>STEREO · 33⅓</span></div></div>
        : settings.variant === 'compact' ? <div className="mc-square" aria-hidden="true">{art}</div>
        : <div className="mc-paper-art" aria-hidden="true"><span className="mc-paper-side">SIDE A</span><div className="mc-small-disc"><div className="mc-small-label">{art}</div></div><span className="mc-paper-mark">SOUNDSPECTRA</span></div>}
      <div className="mc-copy">
        <div className="mc-kicker"><span className="mc-status-dot" /><span>{status}</span><span className="mc-source">{info.title ? info.source : ''}</span></div>
        <div className="mc-title" title={title}>{title}</div>
        <div className="mc-artist" title={artist || undefined} aria-hidden={!artist || undefined}>{artist}</div>
        <div className="mc-footer"><CardTransport info={info} disabled={controlsDisabled || !active || stale} demo={demo} />{meter}<span className="mc-time" /></div>
      </div>
      <div className="mc-progress" role="progressbar" aria-label="歌曲播放进度" aria-valuemin={0}><span className="mc-progress-fill" /></div>
    </div>
  </article>
}
