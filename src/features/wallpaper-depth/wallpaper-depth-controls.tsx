import { useRef, useState } from 'react'
import { Image, ImagePlus, Monitor, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingToggle } from '@/components/ui/setting-toggle'
import { Parameter } from '@/components/ui/parameter'
import { ChoiceSelect } from '@/components/ui/choice-select'
import type { WallpaperDepthSettings } from '../spectrum/model'
import { saveDepthImage, useDepthImage } from './image-store'
import './wallpaper-depth.css'
import { StylePicker } from '@/components/ui/style-picker'

const areas = [
  { name: '上方留白', bounds: { x: .08, y: .06, width: .84, height: .42 } },
  { name: '下方留白', bounds: { x: .08, y: .58, width: .84, height: .36 } },
  { name: '左侧留白', bounds: { x: .04, y: .12, width: .38, height: .76 } },
  { name: '右侧留白', bounds: { x: .58, y: .12, width: .38, height: .76 } },
]

export function WallpaperDepthControls({ settings, onChange, disabled }: { settings: WallpaperDepthSettings; onChange: (value: WallpaperDepthSettings) => void; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const image = useDepthImage(settings.revision), current = useRef(settings); current.current = settings
  const patch = (value: Partial<WallpaperDepthSettings>) => onChange({ ...current.current, ...value })
  const locked = disabled || busy
  const custom = settings.source === 'custom'
  const canDepth = custom && !!image.image && settings.fit === 'cover'
  const importFile = async (file: File) => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const value = await saveDepthImage(file)
      patch({ source: 'custom', revision: value.revision, enabled: false, focusX: 50, focusY: 50 })
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return <section className="wallpaper-depth-controls" aria-label="壁纸设置">
    <div className="wallpaper-control-section">
      <StylePicker label="壁纸来源" value={settings.source} disabled={locked} onChange={source => source === 'system' ? patch({ source, enabled: false }) : settings.revision ? patch({ source: 'custom' }) : input.current?.click()}
        options={[{ value: 'system', label: '跟随系统', detail: '保留当前系统壁纸', preview: <Monitor size={30} /> }, { value: 'custom', label: '自选图片', detail: '选择自己的图片作为桌面背景', preview: image.image ? <img className="effect-art" alt="" src={image.image.dataUrl} /> : <Image size={30} /> }]} />
      {custom && <Button className="wallpaper-image-action" variant="outline" disabled={locked} onClick={() => input.current?.click()}><ImagePlus size={14} />{busy ? '正在导入…' : settings.revision ? '更换图片' : '选择图片'}</Button>}
      <input ref={input} hidden type="file" accept="image/jpeg,image/png,image/webp" aria-label="壁纸图片文件" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file) }} />
      <p>{custom ? '自选图片随“显示到桌面”一起显示，关闭视差仍保留图片。' : '保留系统壁纸，可叠加局部微光。'}</p>
      {(error || custom && image.error) && <p role="alert">{error ?? image.error}</p>}
    </div>
    <div className="wallpaper-control-section">
      <div className="wallpaper-section-heading"><h3>画面调整</h3><Button size="sm" variant="ghost" disabled={locked} aria-label="还原壁纸画面" onClick={() => patch({ brightness: 100, saturation: 100, focusX: 50, focusY: 50, fit: 'cover' })}><RotateCcw size={13} />还原</Button></div>
      {custom && <label className="wallpaper-choice"><span>图片适配</span><ChoiceSelect label="图片适配" value={settings.fit} disabled={locked} options={[{ value: 'cover', label: '填满屏幕' }, { value: 'contain', label: '完整显示' }]} onChange={fit => patch({ fit: fit as WallpaperDepthSettings['fit'], ...(fit === 'contain' ? { enabled: false } : {}) })} /></label>}
      <Parameter label="壁纸亮度" value={settings.brightness} min={30} max={130} disabled={locked} onChange={brightness => patch({ brightness })} />
      <Parameter label="壁纸饱和度" value={settings.saturation} min={0} max={150} disabled={locked} onChange={saturation => patch({ saturation })} />
      {custom && <details className="inspector-advanced"><summary>构图位置</summary>
        <Parameter label="壁纸水平位置" value={settings.focusX} min={0} max={100} disabled={locked} onChange={focusX => patch({ focusX })} />
        <Parameter label="壁纸垂直位置" value={settings.focusY} min={0} max={100} disabled={locked} onChange={focusY => patch({ focusY })} />
        <p>填满时选择保留的画面，完整显示时调整图片在留白中的位置。</p>
      </details>}
    </div>
    <div className="wallpaper-control-section">
      <SettingToggle label="局部音乐微光" description="在留白处随音乐轻轻浮动，暂停后逐渐消退" checked={settings.ambientEnabled} disabled={locked} onChange={ambientEnabled => patch({ ambientEnabled })} />
      {settings.ambientEnabled && <>
        <Parameter label="微光强度" value={settings.ambientAmount} min={0} max={100} disabled={locked} onChange={ambientAmount => patch({ ambientAmount })} />
        <label className="wallpaper-choice"><span>微光颜色</span><input type="color" aria-label="微光颜色" value={settings.ambientColor} disabled={locked} onChange={event => patch({ ambientColor: event.target.value })} /></label>
        <div className="wallpaper-area-choices" role="group" aria-label="微光区域预设">{areas.map(area => <Button key={area.name} size="sm" variant="outline" disabled={locked} aria-pressed={JSON.stringify(settings.ambientBounds) === JSON.stringify(area.bounds)} onClick={() => patch({ ambientBounds: { ...area.bounds } })}>{area.name}</Button>)}</div>
        <p>在预览中拖动微光区域，右下角缩放；用顶部“遮罩”避开人物、文字等主体。浅色壁纸可选择较深的微光颜色。</p>
      </>}
    </div>
    <details className="wallpaper-control-section wallpaper-depth-advanced" open={settings.enabled || undefined}>
      <summary>空间视差 · 可选增强</summary>
      <SettingToggle label="立体壁纸" description="随鼠标移动产生轻微视差" checked={settings.enabled} disabled={locked || !canDepth} onChange={enabled => patch({ enabled })} />
      <p>适合有远近层次的风景图。需选择自选图片并填满屏幕；人像、文字和极简壁纸建议保持静态。</p>
      {settings.enabled && <>
        <Parameter label="壁纸视差强度" value={settings.amount} min={0} max={100} disabled={locked} onChange={amount => patch({ amount })} />
        <label className="wallpaper-choice"><span>景深近似</span><ChoiceSelect label="壁纸构图" value={settings.profile} disabled={locked} options={[{ value: 'landscape', label: '山水远景' }, { value: 'left-foreground', label: '左侧近景' }]} onChange={profile => patch({ profile: profile as WallpaperDepthSettings['profile'] })} /></label>
        <p>按构图近似远近，不会自动识别人像或建筑轮廓。</p>
      </>}
    </details>
  </section>
}
