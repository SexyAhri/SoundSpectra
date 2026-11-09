import type { ReactNode } from 'react'
import { Music2 } from 'lucide-react'
import type { DesktopCardSettings } from '../spectrum/model'
import type { NowPlaying } from './use-now-playing'
import './card-design.css'
import '../../assets/fonts/music-fonts.css'
import './floating-card.css'
import './afternoon-card.css'
import './record-card.css'
import './compact-card.css'
import './card-atmosphere.css'

/** Shared visual structure for the live card and its noninteractive style preview. */
export function CardFace({ variant, info, art, title, artist, status, transport, meter, time, standby = false }: {
  variant: DesktopCardSettings['variant']; info: Pick<NowPlaying, 'source' | 'album' | 'duration' | 'title'>;
  art: ReactNode; title: string; artist: string; status: string;
  transport: ReactNode; meter: ReactNode; time?: string; standby?: boolean;
}) {
  const progress = <div className={`mc-progress${variant === 'record' ? ' mc-record-progress' : ''}`} role="progressbar" aria-label="歌曲播放进度" aria-valuemin={0}>
    {variant === 'record' && <svg viewBox="0 0 100 100" aria-hidden="true"><path className="mc-arc-track" d="M77 14 A45 45 0 0 1 77 86" /><path className="mc-arc-fill" d="M77 14 A45 45 0 0 1 77 86" pathLength="1" /></svg>}
    <span className="mc-progress-fill" />
  </div>
  const inlineProgress = variant !== 'compact'
  const duration = Number.isFinite(info.duration) && info.duration > 0 ? `${Math.floor(info.duration / 60)}:${String(Math.floor(info.duration % 60)).padStart(2, '0')}` : '—'
  return (
    <div className="mc-shell">
      <span className="mc-material-light" aria-hidden="true" />
      {variant === 'record' ? <div className="mc-record-art"><span className="mc-record-plinth" /><div className="mc-disc-mount"><div className="vinyl-disc mc-disc" aria-hidden="true"><div className="mc-label">{art}</div></div><span className="mc-sheen" />{progress}</div><div className="mc-sleeve" aria-hidden="true">{art}<span className="mc-sleeve-edge" /></div></div>
        : variant === 'floating' ? <><span className="mc-float-clip" aria-hidden="true" /><div className="mc-float-art" aria-hidden="true"><div className="mc-float-cover">{art}<span className="mc-float-glass" /></div></div></>
        : variant === 'compact' ? <div className="mc-square" aria-hidden="true">{art}</div>
        : <div className="mc-paper-art" aria-hidden="true"><div className="mc-paper-photo">{art}</div><span className="mc-paper-caption">音乐藏书票</span></div>}
      <div className="mc-copy">
        <div className="mc-kicker"><span className="mc-status-dot" /><span>{status}</span><span className={`mc-source${variant === 'floating' ? ' mc-source-badge' : ''}`} title={variant === 'floating' ? info.source || undefined : inlineProgress ? info.album || undefined : undefined}>{variant === 'floating' ? info.source : inlineProgress ? info.album : info.title ? info.source : ''}</span></div>
        <div className="mc-title" title={title}>{title}</div>
        <div className="mc-artist" title={artist || undefined} aria-hidden={!artist || undefined}>{artist}</div>
        <div className="mc-footer">{transport}{meter}<span className="mc-time">{time}</span></div>
        {inlineProgress && variant !== 'record' && progress}
      </div>
      {!inlineProgress && progress}
      {variant === 'afternoon' && <aside className="mc-ticket-stub" aria-label="音乐票根"><span className="mc-ticket-mark" aria-hidden="true"><Music2 size={14} /></span><span className="mc-ticket-source" title={info.source || undefined}>{info.source || '声音收藏'}</span><span className="mc-ticket-duration" title={standby ? undefined : '歌曲总时长'}>{standby ? '待启' : duration}</span></aside>}
    </div>
  )
}
