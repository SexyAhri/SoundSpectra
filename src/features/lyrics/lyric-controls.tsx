import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Parameter } from '../settings/appearance-panel'
import { defaultLyrics, type LyricSettings, type SpectrumSettings, type SettingsUpdate } from '../spectrum/model'
import type { LyricDocument } from './model'
import './lyrics.css'
import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { native } from '../spectrum/bridge'

export function LyricControls({ settings, document, update, disabled }: { settings: SpectrumSettings; document: LyricDocument; update: SettingsUpdate; disabled: boolean }) {
  const lyrics = settings.lyrics
  const [finding, setFinding] = useState(false), [findMessage, setFindMessage] = useState('')
  const findLocations = async () => {
    if (finding) return
    setFinding(true); setFindMessage('')
    try { await invoke('rescan_lyric_locations'); setFindMessage('已开始后台重新查找，找到的目录会自动保存。') }
    catch { setFindMessage('暂时无法开始查找，请稍后重试。') }
    finally { setFinding(false) }
  }
  const change = (patch: Partial<LyricSettings>) => update(current => ({ lyrics: { ...current.lyrics, ...patch } }))
  const chooseComposition = (motion: LyricSettings['motion']) => {
    const b = lyrics.bounds
    const oldDefault = b.x === .14 && b.width === .72 && ((b.y === .56 && b.height === .22) || (b.y === .60 && b.height === .18))
    change({ motion, ...(oldDefault ? { bounds: { ...defaultLyrics.bounds }, fontSize: 64 } : {}) })
  }
  const bounds = (key: 'x' | 'y' | 'width', value: number) => {
    const b = { ...lyrics.bounds, [key]: value / 100 }
    b.x = Math.max(0, Math.min(1 - b.width, b.x)); b.y = Math.max(0, Math.min(1 - b.height, b.y))
    change({ bounds: b })
  }
  return <section className="inspector-content lyric-controls" aria-label="歌词动效设置">
    <label className="card-enable"><span>歌词动效<small>动态构图 · 文字编排</small></span><Switch aria-label="显示桌面歌词" disabled={disabled} checked={lyrics.enabled} onCheckedChange={enabled => change({ enabled })} /></label>
    {lyrics.enabled && <>
      <p className="lyric-status" role="status">{document.status === 'ready' ? '歌词已就绪' : document.message}</p>
      {document.issue && <p className="lyric-status" role="alert">{document.issue}</p>}
      <div className="lyric-style-options" role="group" aria-label="歌词动效样式">{[['depth', '文字漫游', '呼吸 · 推镜'], ['stage', '错落排版', '拆句 · 留白'], ['stardust', '弧形流转', '弧线 · 环游']].map(([motion, label, detail]) => <Button key={motion} variant="outline" className={`composition-option composition-option-${motion}`} disabled={disabled} aria-label={label} aria-pressed={lyrics.motion === motion} onClick={() => chooseComposition(motion as LyricSettings['motion'])}><span className="composition-mark" aria-hidden="true">{motion === 'depth' ? '风 光' : motion === 'stage' ? '听\n见' : '时 光'}</span><span>{label}</span><small>{detail}</small></Button>)}</div>
      <Button variant="outline" className="lyric-stage-expand" disabled={disabled} onClick={() => change({ bounds: { ...defaultLyrics.bounds }, fontSize: 64 })}>展开歌词舞台</Button>
      <Parameter label="歌词字号" value={lyrics.fontSize} min={18} max={72} unit=" px" disabled={disabled} onChange={fontSize => change({ fontSize })} />
      <Parameter label="歌词背景" value={lyrics.backgroundOpacity} min={0} max={100} disabled={disabled} onChange={backgroundOpacity => change({ backgroundOpacity })} />
      <p className="lyric-status">0% 为完全透明，数值越大背景越深。</p>
      <p className="lyric-status">在预览中拖动歌词，右下角缩放。</p>
      <details className="inspector-advanced"><summary>位置与同步</summary>
      <div className="parameter"><div className="parameter-label"><span>歌词同步偏移</span><output>{lyrics.offsetMs > 0 ? '+' : ''}{lyrics.offsetMs} ms</output></div>
        <Slider aria-label="歌词同步偏移" min={-10000} max={10000} step={100} value={[lyrics.offsetMs]} disabled={disabled} onValueChange={([offsetMs]) => change({ offsetMs })} /></div>
      <p className="lyric-status">歌词慢了向右调，歌词快了向左调。</p>
      <Parameter label="歌词区域宽度" value={lyrics.bounds.width * 100} min={25} max={100} disabled={disabled} onChange={value => bounds('width', value)} />
      <Parameter label="歌词距左侧" value={lyrics.bounds.x * 100} min={0} max={Math.round((1 - lyrics.bounds.width) * 100)} disabled={disabled} onChange={value => bounds('x', value)} />
      <Parameter label="歌词距顶部" value={lyrics.bounds.y * 100} min={0} max={Math.round((1 - lyrics.bounds.height) * 100)} disabled={disabled} onChange={value => bounds('y', value)} />
      <Button variant="ghost" className="reset-button" disabled={disabled} onClick={() => change({ bounds: { ...defaultLyrics.bounds }, offsetMs: 0 })}>恢复歌词位置与同步</Button>
      <Button variant="ghost" className="reset-button" disabled={disabled || finding || !native} onClick={() => void findLocations()}>{finding ? '正在开始查找…' : '重新查找歌词目录'}</Button>
      {findMessage && <p className="lyric-status" role="status">{findMessage}</p>}
      </details>
      <p className="lyric-status">联网和已记忆的缓存目录同时查找，先找到即使用；未完成的查找会取消。</p>
    </>}
  </section>
}
