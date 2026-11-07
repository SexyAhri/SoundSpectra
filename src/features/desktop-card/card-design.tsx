import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Disc3, Music2 } from 'lucide-react'
import type { DesktopCardSettings } from '../spectrum/model'
import type { NowPlaying } from './use-now-playing'
import { cardTrackKey, useCardCover } from './card-presentation'
import { useCardClock } from './card-clock'
import { CardMeter } from './card-meter'
import { CardTransport } from './card-transport'
import { mixColor } from './cover-colors'
import { luminance } from '../preview/wallpaper-palette'
import './card-design.css'
import '../../assets/fonts/music-fonts.css'
import './floating-card.css'
import './afternoon-card.css'
import './record-card.css'
import './compact-card.css'

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
  useCardClock(info, root, active && !controlsOnly, desktop, demo, settings.variant)
  useLayoutEffect(() => {
    if (previous.current === key) return
    previous.current = key
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const nodes = root.current?.closest('.mc-native-controls') ? undefined : root.current?.querySelectorAll('.mc-title, .mc-artist, .mc-sleeve, .mc-square, .mc-paper-photo, .mc-float-cover')
    nodes?.forEach(node => { node.getAnimations().forEach(animation => animation.cancel()); node.animate([{ opacity: .35 }, { opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.2,.7,.2,1)' }) })
  }, [key])
  const title = info.title || info.source || (demo ? '音乐信息预览' : '等待音乐')
  const artist = info.artist || (!info.title ? info.source ? '播放器未提供歌曲信息' : '打开音乐客户端，开始播放' : '')
  const stale = !info.updated || expiredAt === info.updated || Date.now() - info.updated > 4000
  const reportedPlaying = info.playing && info.playbackAvailable !== false && !stale && !info.issue
  const status = demo ? '模拟预览' : info.issue ? '连接中' : info.source && (info.playbackAvailable === false || stale) ? '媒体状态待确认' : reportedPlaying ? '播放中' : info.source ? '已暂停' : '音乐待机'
  const art = cover ? <img src={cover} alt="" /> : settings.variant === 'afternoon' ? <Music2 /> : <Disc3 />
  const meter = <CardMeter {...{ bands, receivedAt, desktop, demo }} active={active && !controlsOnly} variant={settings.variant} />
  const accent = settings.accentColor || color
  const buttonFill = mixColor(accent, '#f8f3e9', .23)
  const buttonInk = luminance([1, 3, 5].map(index => parseInt(buttonFill.slice(index, index + 2), 16) / 255) as [number, number, number]) > .19 ? '#14272c' : '#fffdf3'
  const progress = <div className="mc-progress" role="progressbar" aria-label="歌曲播放进度" aria-valuemin={0}><span className="mc-progress-fill" /></div>
  const inlineProgress = settings.variant !== 'compact'
  return <article ref={root} className={`music-card music-card-${settings.variant} mc mc-${settings.variant}`} data-playing={reportedPlaying && !demo && active && !controlsOnly} data-active={active} data-track={key} data-color-mode={settings.accentColor ? 'fixed' : 'scene'} aria-label="桌面音乐信息卡" style={{ '--mc-accent': accent, '--mc-button-fill': buttonFill, '--mc-button-ink': buttonInk } as CSSProperties}>
    <div className="mc-shell">
      {settings.variant === 'record' ? <div className="mc-record-art" aria-hidden="true"><span className="mc-record-plinth" /><div className="mc-disc-mount"><div className="vinyl-disc mc-disc"><div className="mc-label">{art}</div></div><span className="mc-sheen" /></div><div className="mc-sleeve">{art}<span className="mc-sleeve-edge" /></div></div>
        : settings.variant === 'floating' ? <div className="mc-float-art" aria-hidden="true"><span className="mc-float-halo" /><span className="mc-float-backing" /><div className="mc-float-cover">{art}<span className="mc-float-glass" /></div></div>
        : settings.variant === 'compact' ? <div className="mc-square" aria-hidden="true">{art}</div>
        : <div className="mc-paper-art" aria-hidden="true"><div className="mc-paper-photo">{art}</div><span className="mc-paper-tape" /><span className="mc-paper-caption">音乐藏书票</span></div>}
      <div className="mc-copy">
        <div className="mc-kicker"><span className="mc-status-dot" /><span>{status}</span><span className="mc-source" title={inlineProgress ? info.album || undefined : undefined}>{inlineProgress ? info.album : info.title ? info.source : ''}</span></div>
        <div className="mc-title" title={title}>{title}</div>
        <div className="mc-artist" title={artist || undefined} aria-hidden={!artist || undefined}>{artist}</div>
        <div className="mc-footer"><CardTransport info={info} disabled={controlsDisabled || !active || stale} demo={demo} />{meter}<span className="mc-time" /></div>
        {inlineProgress && progress}
      </div>
      {!inlineProgress && progress}
    </div>
  </article>
}
