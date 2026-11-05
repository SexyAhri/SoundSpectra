import { useState, type CSSProperties, type RefObject } from 'react'
import { AudioLines, Disc3 } from 'lucide-react'
import type { DesktopCardSettings } from '../spectrum/model'
import { LiveMeter } from './live-meter'
import type { NowPlaying } from './use-now-playing'
import './music-card.css'

const stamp = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`
export function MusicCard({ info, settings, color, bands, receivedAt, demo = false, active = true, desktop = false }: {
  info: NowPlaying; settings: DesktopCardSettings; color: string;
  bands: RefObject<Float32Array>; receivedAt: RefObject<number>; demo?: boolean; active?: boolean; desktop?: boolean;
}) {
  const [failedCover, setFailedCover] = useState<string | null>(null)
  const cover = info.cover !== failedCover ? info.cover : null
  const title = info.title || info.source || (demo ? '音乐信息预览' : '等待音乐')
  const subtitle = info.artist || (info.title ? info.source : info.source ? '播放器未提供歌曲信息' : demo ? '在客户端中显示当前歌曲' : '打开音乐客户端，开始播放')
  const progress = info.duration > 0 ? Math.min(1, Math.max(0, info.position / info.duration)) : 0
  const afternoon = settings.variant === 'afternoon'
  return <article className={`music-card music-card-${settings.variant} ${info.playing && !demo ? 'is-playing' : ''}`} aria-label="桌面音乐信息卡" style={{ '--card-accent': afternoon ? '#849576' : color } as CSSProperties}>
    <div className="music-card-shell">
      <div className="music-card-art" aria-hidden="true"><div className="vinyl-disc"><div className="vinyl-label">{cover ? <img src={cover} alt="" onError={() => setFailedCover(cover)} /> : <Disc3 />}</div></div>{cover && <img className="music-card-cover" src={cover} alt="" onError={() => setFailedCover(cover)} />}</div>
      <div className="music-card-content">
        <div className="music-card-kicker"><AudioLines /><span>{afternoon ? demo ? '午后电台 · 预览' : info.playing ? '午后电台 · 播放中' : info.source ? '午后电台 · 暂停' : '午后电台' : demo ? '模拟预览' : info.playing ? '正在播放' : info.source ? '音乐暂停' : '音乐待机'}</span><span className="music-card-source">{info.title ? info.source : 'SOUNDSPECTRA'}</span></div>
        <div className="music-card-title" title={title}>{title}</div>
        <div className="music-card-artist" title={subtitle}>{subtitle}</div>
        <div className="music-card-bottom"><LiveMeter bands={bands} receivedAt={receivedAt} demo={demo} active={active} desktop={desktop} />{info.duration > 0 && <span className="music-card-time">{stamp(info.position)} <i>/ {stamp(info.duration)}</i></span>}</div>
      </div>
      {info.duration > 0 && <div className="music-card-progress" aria-label="歌曲播放进度" role="progressbar" aria-valuemin={0} aria-valuemax={Math.round(info.duration)} aria-valuenow={Math.round(info.position)}><span style={{ transform: `scaleX(${progress})` }} /></div>}
    </div>
  </article>
}
