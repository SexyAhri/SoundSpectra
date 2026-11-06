import { SettingToggle } from '@/components/ui/setting-toggle'
import { Button } from '@/components/ui/button'
import { Parameter } from '@/components/ui/parameter'
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
    <SettingToggle className="card-enable" label="歌词动效" description="动态构图 · 文字编排" accessibleLabel="显示桌面歌词" disabled={disabled} checked={lyrics.enabled} onChange={enabled => change({ enabled })} />
    {lyrics.enabled && <>
      <p className="lyric-status" role="status">{document.status === 'ready' ? '歌词已就绪' : document.message}</p>
      {document.issue && <p className="lyric-status" role="alert">{document.issue}</p>}
      <div className="lyric-style-options" role="group" aria-label="歌词动效样式">{[['depth', '文字漫游', '呼吸 · 推镜'], ['stage', '错落排版', '拆句 · 留白'], ['stardust', '弧形流转', '弧线 · 环游']].map(([motion, label, detail]) => <Button key={motion} variant="outline" className={`composition-option composition-option-${motion}`} disabled={disabled} aria-label={label} aria-pressed={lyrics.motion === motion} onClick={() => chooseComposition(motion as LyricSettings['motion'])}><span className="composition-mark" aria-hidden="true">{motion === 'depth' ? '风 光' : motion === 'stage' ? '听\n见' : '时 光'}</span><span>{label}</span><small>{detail}</small></Button>)}</div>
      <Parameter label="歌词字号" value={lyrics.fontSize} min={18} max={72} unit=" px" disabled={disabled} onChange={fontSize => change({ fontSize })} />
      <SettingToggle label="浅色壁纸增强" description="增加文字描边和轻底衬。" checked={lyrics.readability==='contrast'} disabled={disabled} onChange={value=>change({readability:value?'contrast':'soft'})} />
      <Parameter label="歌词背景" value={lyrics.backgroundOpacity} min={0} max={100} disabled={disabled} onChange={backgroundOpacity => change({ backgroundOpacity })} />
      <details className="inspector-advanced"><summary>位置与同步</summary>
      <Parameter label="歌词同步偏移" value={lyrics.offsetMs} min={-10000} max={10000} step={100} unit=" ms"
        format={value => `${value > 0 ? '+' : ''}${value}`} disabled={disabled} onChange={offsetMs => change({ offsetMs })} />
      <p className="lyric-status">歌词慢了向右调，歌词快了向左调。</p>
      <Parameter label="歌词区域宽度" value={lyrics.bounds.width * 100} min={25} max={100} disabled={disabled} onChange={value => bounds('width', value)} />
      <Parameter label="歌词距左侧" value={lyrics.bounds.x * 100} min={0} max={Math.round((1 - lyrics.bounds.width) * 100)} disabled={disabled} onChange={value => bounds('x', value)} />
      <Parameter label="歌词距顶部" value={lyrics.bounds.y * 100} min={0} max={Math.round((1 - lyrics.bounds.height) * 100)} disabled={disabled} onChange={value => bounds('y', value)} />
      <Button variant="ghost" className="reset-button" disabled={disabled} onClick={() => change({ bounds: { ...defaultLyrics.bounds } })}>恢复歌词位置</Button>
      <Button variant="ghost" className="reset-button" disabled={disabled || finding || !native} onClick={() => void findLocations()}>{finding ? '正在开始查找…' : '重新查找歌词目录'}</Button>
      {findMessage && <p className="lyric-status" role="status">{findMessage}</p>}
      </details>
    </>}
  </section>
}
