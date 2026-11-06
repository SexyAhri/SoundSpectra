import { ModalContent } from '@/components/ui/modal'
import { IconButton } from '@/components/ui/icon-button'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { Bookmark, Download, Upload, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { SpectrumSettings } from '../spectrum/model'
import { wallpaperPlacement, type DesktopBackground, type PreviewImage, type ScreenRect } from './background'
import { readWallpaperPixels } from './wallpaper-palette'
import { analyzeWallpaper } from './scene-suggestions'
import { readLibrary, writeLibrary, recoverLibrary, importScene, exportScene, rememberScene, type SceneLayout, type SavedScene } from './scene-library'
import { desktopLayout, desktopPresets, scenePatch } from './desktop-scenes'

interface Props {
  settings: SpectrumSettings; image: PreviewImage | null; desktop: DesktopBackground | null; screen: ScreenRect;
  available: boolean; demo: boolean; disabled: boolean;
  renderPreview: (settings: SpectrumSettings, demo: boolean) => ReactNode;
  onClose: () => void; onReturnFocus: () => void; onApply: (scene: SceneLayout) => Promise<void>;
}
export function SceneLibraryDialog(props: Props) {
  const [items, setItems] = useState<SavedScene[]>([]), [selected, select] = useState<string | null>(null)
  const [tab, setTab] = useState<'featured' | 'saved'>('featured')
  const [presetId, selectPreset] = useState<string | null>(null)
  const [name, setName] = useState(props.settings.regionName), [matching, setMatching] = useState(false)
  const [ready, setReady] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState('')
  const [source, setSource] = useState<{ key: string; wallpaper: string | null; error?: string } | null>(null)
  const [saving, setSaving] = useState(false), [simulate, setSimulate] = useState(props.demo), [removed, setRemoved] = useState<SavedScene | null>(null)
  const savingRef = useRef(false), fileInput = useRef<HTMLInputElement>(null)
  const placement = props.image ? wallpaperPlacement(props.image, props.desktop, props.screen) : null
  const sourceKey = JSON.stringify([props.image?.url, placement, props.screen, props.desktop?.color, props.available])
  const sourceReady = !props.available || source?.key === sourceKey
  const wallpaper = props.available && source?.key === sourceKey ? source.wallpaper : null
  const reload = () => {
    try {
      const saved = readLibrary()
      setItems(saved); setReady(true); setError(null)
      if (saved.length) setTab('saved')
      try {
        const last = JSON.parse(localStorage.getItem('soundspectra.scene-last-used.v1') ?? 'null')
        const recent = desktopPresets.find(value => value.id === last?.id) ?? saved.find(value => value.id === last?.id)
        if (recent) {
          setName(recent.name)
          if (desktopPresets.some(value => value.id === recent.id)) { setTab('featured'); selectPreset(recent.id) }
          else select(recent.id)
        }
      } catch { /* An optional recent-use hint must not block the collection. */ }
    }
    catch (reason) { setReady(false); setError(`场景库读取失败：${reason instanceof Error ? reason.message : reason}`) }
  }
  useEffect(reload, [])
  useEffect(() => {
    if (!props.available) return
    let cancelled = false
    void readWallpaperPixels(props.image, placement, props.screen, props.desktop?.color ?? '#25232c').then(pixels => {
      if (!cancelled) setSource({ key: sourceKey, wallpaper: analyzeWallpaper(pixels.data, pixels.width, pixels.height).key })
    }).catch(reason => { if (!cancelled) setSource({ key: sourceKey, wallpaper: null, error: `壁纸关联失败：${String(reason)}` }) })
    return () => { cancelled = true }
  }, [sourceKey])
  const visible = items.filter(item => !matching || !!wallpaper && item.wallpaper === wallpaper)
    .sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0) || Number(b.wallpaper === wallpaper && !!wallpaper) - Number(a.wallpaper === wallpaper && !!wallpaper) || b.updated - a.updated)
  const item = tab === 'saved' ? visible.find(value => value.id === selected) ?? null : null
  const preset = tab === 'featured' ? desktopPresets.find(value => value.id === presetId) : undefined
  const chosen = preset ?? item
  const preview = chosen ? { ...props.settings, ...scenePatch(props.settings, chosen.scene) } : props.settings
  const locked = props.disabled || saving
  const choose = (item: SavedScene) => { setTab('saved'); select(item.id); setName(item.name); setError(null); setNotice('') }
  const persist = (next: SavedScene[]) => { writeLibrary(next); setItems(next); setError(null) }
  const attempt = (operation: () => void) => { try { operation() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } }
  const save = (copy: boolean) => attempt(() => {
    if (!name.trim()) throw new Error('请填写场景名称。')
    if (name.trim().length > 40) throw new Error('场景名称最多 40 个字符。')
    const next: SavedScene = { id: !copy && item ? item.id : crypto.randomUUID(), name: name.trim(), wallpaper, updated: Date.now(), scene: desktopLayout(copy ? preview : props.settings) }
    // Read fresh data so another settings window cannot be silently overwritten.
    const current = readLibrary()
    persist([next, ...current.filter(value => value.id !== next.id)])
    setTab('saved'); select(next.id); setNotice('已保存灯效、歌词和音乐卡片的展示配置。'); setRemoved(null)
  })
  const apply = async () => {
    if (!chosen || savingRef.current || locked) return
    savingRef.current = true; setSaving(true); setError(null)
    try {
      await props.onApply(chosen.scene)
      try {
        rememberScene(chosen.id, chosen.name)
        props.onClose()
      } catch { setNotice('桌面方案已应用，最近使用记录未能保存。可以关闭此窗口。') }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { savingRef.current = false; setSaving(false) }
  }
  const importFile = async (file: File) => {
    if (savingRef.current) return
    savingRef.current = true; setSaving(true); setError(null)
    try {
      if (file.size > 262144) throw new Error('场景文件超过 256 KB。')
      const imported = importScene(await file.text())
      const next = { ...imported, id: crypto.randomUUID(), wallpaper: null, updated: Date.now() }
      persist([next, ...readLibrary()]); setMatching(false); choose(next); setNotice('已导入收藏，尚未应用到桌面。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { savingRef.current = false; setSaving(false) }
  }
  const exportSelected = async () => {
    if (!item || savingRef.current) return
    savingRef.current = true; setSaving(true)
    try { setNotice(await exportScene(item)); setError(null) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { savingRef.current = false; setSaving(false) }
  }
  return <Dialog.Root open onOpenChange={open => { if (!open && !savingRef.current) props.onClose() }}>
    <ModalContent className="auto-scene-dialog" onEscapeKeyDown={event => { if (savingRef.current) event.preventDefault() }} onCloseAutoFocus={event => { event.preventDefault(); props.onReturnFocus() }}>
      <div className="auto-scene-heading"><div><Dialog.Title><Bookmark size={17} />场景收藏</Dialog.Title><Dialog.Description>一套搭配，收好灯效、歌词和音乐卡片。</Dialog.Description></div><Dialog.Close asChild><IconButton aria-label="关闭场景收藏" disabled={locked}><X size={18} /></IconButton></Dialog.Close></div>
      <div className="auto-scene-body">
        <div className="auto-scene-preview">
          {props.renderPreview(preview, simulate)}
          <label className="auto-scene-demo">模拟音频<Switch aria-label="收藏模拟音频" checked={simulate} onCheckedChange={setSimulate} disabled={locked} /></label>
        </div>
        <div className="auto-scene-options scene-library-options">
          <div className="library-filter library-sections" role="group" aria-label="桌面方案分类">
            <Button size="sm" variant="ghost" aria-pressed={tab === 'featured'} disabled={locked} onClick={() => setTab('featured')}>精选搭配</Button>
            <Button size="sm" variant="ghost" aria-pressed={tab === 'saved'} disabled={locked} onClick={() => setTab('saved')}>我的收藏</Button>
          </div>
          {tab === 'featured' ? <div className="library-featured">
            {desktopPresets.map(value => <button key={value.id} className="auto-scene-choice desktop-scene-choice" aria-pressed={presetId === value.id} disabled={locked}
              onClick={() => { selectPreset(value.id); setName(value.name); setError(null); setNotice('') }}>
              <span className="auto-scene-choice-heading"><span>{value.name}</span><i className="palette-color-dot" style={{ background: value.color }} /></span>
              <span>{value.description}</span>
            </button>)}
            <p className="preview-message">点选只预览，满意后再应用。</p>
          </div> : <>
          <div className="library-filter" role="group" aria-label="收藏筛选"><Button size="sm" variant="ghost" disabled={locked} aria-pressed={!matching} onClick={() => { setMatching(false); select(null) }}>全部</Button><Button size="sm" variant="ghost" disabled={locked || !wallpaper} aria-pressed={matching} onClick={() => { setMatching(true); select(null) }}>当前壁纸</Button><span>{items.length}/40</span></div>
          <div className="library-items">{visible.map(value => <button className="auto-scene-choice" key={value.id} disabled={locked} aria-pressed={item?.id === value.id} onClick={() => choose(value)}><span className="auto-scene-choice-heading">{value.name}</span><span>{value.wallpaper === wallpaper && wallpaper ? '当前壁纸' : value.wallpaper ? '其他壁纸' : '未关联壁纸'} · {value.usedAt ? '最近使用 ' : ''}{new Date(value.usedAt ?? value.updated).toLocaleDateString()}</span></button>)}
            {ready && !visible.length && <p className="preview-message">{matching ? '这张壁纸还没有收藏。' : '还没有收藏，先保存当前场景。'}</p>}</div>
          </>}
          <label className="library-name">场景名称<input aria-label="收藏名称" maxLength={40} value={name} disabled={locked || !ready} onChange={event => setName(event.target.value)} /></label>
          <div className="library-actions"><Button size="sm" variant="outline" disabled={locked || !ready || !sourceReady} onClick={() => save(false)}>保存当前</Button><Button size="sm" variant="outline" disabled={locked || !ready || !sourceReady} onClick={() => save(true)}>另存为</Button></div>
          <p className="preview-message">{item ? '保存当前会更新所选收藏；另存为保留原收藏。' : chosen ? '另存为会收藏正在预览的搭配。' : '保存当前桌面上的整套搭配。'}{!sourceReady ? '正在关联壁纸…' : ''}</p>
          {source?.key === sourceKey && source.error && <p className="preview-message" role="alert">{source.error}</p>}
          <div className="library-actions"><Button size="sm" variant="ghost" disabled={locked || !ready} onClick={() => fileInput.current?.click()}><Upload size={13} />导入</Button><Button size="sm" variant="ghost" title="导出灯效、布局与遮罩" disabled={locked || !item} onClick={() => void exportSelected()}><Download size={13} />导出</Button><Button size="sm" variant="ghost" aria-label="删除所选收藏" disabled={locked || !item} onClick={() => attempt(() => { if (!item) return; persist(readLibrary().filter(value => value.id !== item.id)); setRemoved(item); select(null); setNotice('收藏已删除，可撤销。') })}><Trash2 size={13} /></Button></div>
          {removed && <Button size="sm" variant="ghost" disabled={locked} onClick={() => attempt(() => { persist([removed, ...readLibrary().filter(value => value.id !== removed.id)]); select(removed.id); setRemoved(null); setNotice('已恢复收藏。') })}>撤销删除</Button>}
          {!ready && <div className="library-actions"><Button size="sm" variant="outline" onClick={reload}>重试读取</Button><Button size="sm" variant="outline" onClick={() => attempt(() => { recoverLibrary(); reload(); setNotice('原始数据已在本机备份，场景库已重建。') })}>备份并重建</Button></div>}
          <input ref={fileInput} type="file" accept="application/json,.json" hidden aria-label="导入场景文件" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file) }} />
        </div>
      </div>
      <div className="auto-scene-footer"><div><p>{chosen?.scene.desktop ? '应用灯效、歌词和音乐卡片。保留个人文件、歌词目录和同步偏移，可撤销。' : '应用动效、布局和遮罩，保留其他模块，可撤销。'} 导出仍仅包含灯效。</p>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}</div><Button disabled={locked || !chosen} onClick={() => void apply()}>{saving ? '正在处理…' : '应用此场景'}</Button></div>
    </ModalContent>
  </Dialog.Root>
}
