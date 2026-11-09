import { SettingToggle } from '@/components/ui/setting-toggle'
import { Button } from '@/components/ui/button'
import { Parameter } from '@/components/ui/parameter'
import { defaultLyrics, type LyricSettings, type SpectrumSettings, type SettingsUpdate } from '../spectrum/model'
import type { LyricDocument } from './model'
import './lyrics.css'
import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { native } from '../spectrum/bridge'
import { StylePicker } from '@/components/ui/style-picker'
import { LyricStylePreview } from './lyric-style-preview'

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
    change({ motion })
  }
  const bounds = (key: 'x' | 'y' | 'width', value: number) => {
    const b = { ...lyrics.bounds, [key]: value / 100 }
    b.x = Math.max(0, Math.min(1 - b.width, b.x)); b.y = Math.max(0, Math.min(1 - b.height, b.y))
    change({ bounds: b })
  }
  return <section className="inspector-content lyric-controls" aria-label="歌词动效设置">
    <SettingToggle className="module-enable" label="显示歌词" accessibleLabel="显示桌面歌词" disabled={disabled} checked={lyrics.enabled} onChange={enabled => change({ enabled })} />
    <>
      {lyrics.enabled && <p className="lyric-status" role="status">{document.status === 'ready' ? '歌词已就绪' : document.message}</p>}
      {document.issue && <p className="lyric-status" role="alert">{document.issue}</p>}
      <StylePicker label="歌词编排" value={lyrics.motion} disabled={disabled} onChange={motion => chooseComposition(motion as LyricSettings['motion'])}
        options={([[ 'depth', '文字漫游', '镜域 · 穿行' ], [ 'stage', '错落排版', '切片 · 撞版' ], [ 'stardust', '弧形流转', '弧线 · 环游' ], [ 'folded', '折幕字场', '棱镜 · 翻幕' ]] as const).map(([value, label, detail]) => ({ value, label, detail,
          preview: <LyricStylePreview motion={value} /> }))} />
      <section className="module-section" aria-label="歌词阅读"><h3>文字与可读性</h3>
      <Parameter label="歌词字号" value={lyrics.fontSize} min={18} max={72} unit=" px" disabled={disabled} onChange={fontSize => change({ fontSize })} />
      <div className="lyric-font-options" role="group" aria-label="歌词字体风格">
        {([['modern', '现代黑体'], ['poetry', '唱片诗页']] as const).map(([fontStyle, label]) =>
          <Button key={fontStyle} variant="outline" className={`lyric-font-option lyric-font-${fontStyle}`} disabled={disabled} aria-pressed={(lyrics.fontStyle ?? 'modern') === fontStyle} onClick={() => change({ fontStyle })}>
            <span>{label}</span>
          </Button>)}
      </div>
      <SettingToggle label="浅色壁纸增强" description="增强文字描边，底衬由歌词背景控制。" checked={lyrics.readability==='contrast'} disabled={disabled} onChange={value=>change({readability:value?'contrast':'soft'})} />
      <Parameter label="歌词背景" value={lyrics.backgroundOpacity} min={0} max={100} disabled={disabled} onChange={backgroundOpacity => change({ backgroundOpacity })} />
      </section>
      <section className="module-section" aria-label="歌词同步"><h3>同步</h3>
      <div className="lyric-sync-actions" role="group" aria-label="歌词同步微调">
        <Button size="sm" variant="outline" disabled={disabled || lyrics.offsetMs >= 10000} onClick={() => update(current => ({ lyrics: { ...current.lyrics, offsetMs: Math.min(10000, current.lyrics.offsetMs + 100) } }))}>提前 0.1 秒</Button>
        <Button size="sm" variant="outline" disabled={disabled || lyrics.offsetMs <= -10000} onClick={() => update(current => ({ lyrics: { ...current.lyrics, offsetMs: Math.max(-10000, current.lyrics.offsetMs - 100) } }))}>延后 0.1 秒</Button>
        <Button size="sm" variant="ghost" disabled={disabled || lyrics.offsetMs === 0} onClick={() => change({ offsetMs: 0 })}>归零</Button>
      </div>
      <Parameter label="歌词同步偏移" value={lyrics.offsetMs} min={-10000} max={10000} step={100} unit=" ms"
        format={value => `${value > 0 ? '+' : ''}${value}`} disabled={disabled} onChange={offsetMs => change({ offsetMs })} />
      <p className="lyric-status">歌词慢了向右调，歌词快了向左调。</p>
      </section>
      <details className="inspector-advanced"><summary>位置与高级设置</summary>
      <Parameter label="歌词区域宽度" value={lyrics.bounds.width * 100} min={25} max={100} disabled={disabled} onChange={value => bounds('width', value)} />
      <Parameter label="歌词距左侧" value={lyrics.bounds.x * 100} min={0} max={Math.round((1 - lyrics.bounds.width) * 100)} disabled={disabled} onChange={value => bounds('x', value)} />
      <Parameter label="歌词距顶部" value={lyrics.bounds.y * 100} min={0} max={Math.round((1 - lyrics.bounds.height) * 100)} disabled={disabled} onChange={value => bounds('y', value)} />
      <Button variant="ghost" className="reset-button" disabled={disabled} onClick={() => change({ bounds: { ...defaultLyrics.bounds } })}>恢复歌词位置</Button>
      <Button variant="ghost" className="reset-button" disabled={disabled || finding || !native} onClick={() => void findLocations()}>{finding ? '正在开始查找…' : '重新查找歌词目录'}</Button>
      {findMessage && <p className="lyric-status" role="status">{findMessage}</p>}
      </details>
    </>
  </section>
}
