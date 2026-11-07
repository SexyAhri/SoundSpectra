import { ModalContent } from '@/components/ui/modal'
import { IconButton } from '@/components/ui/icon-button'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject, type ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { ImagePlus, Maximize2, Monitor, Move, RefreshCw, Scan, Sparkles, Undo2, X, Bookmark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { native } from '../spectrum/bridge'
import type { SpectrumSettings, SettingsUpdate } from '../spectrum/model'
import type { AnalysisSnapshot } from '../spectrum/spectrum-canvas'
import { SpectrumCanvas } from '../spectrum/spectrum-canvas'
import { referenceScreen, wallpaperStyle, type DesktopBackground, type PreviewImage, type ScreenRect } from './background'
import { moveBounds, resizeBounds, snapBounds, type Bounds } from './preview-geometry'
import { PreviewObjectList } from './preview-object-list'
import { useBackground } from './use-background'
import { LayoutPresets } from './layout-presets'
import { sceneRegions, regionPatch, settingsForRegion } from '../spectrum/regions'
import { MaskEditor } from './mask-editor'
import { MaskControls } from './mask-controls'
import { AutoSceneDialog } from './auto-scene-dialog'
import { composition, rememberChoice, type SceneComposition } from './scene-suggestions'
import { SceneLibraryDialog } from './scene-library-dialog'
import { layout, type SceneLayout } from './scene-library'
import { desktopLayout } from './desktop-scenes'
import { CardLayer } from '../desktop-card/card-layer'
import { emptyNowPlaying, type NowPlaying } from '../desktop-card/use-now-playing'
import { WallpaperSurface, wallpaperFilter } from '../wallpaper-depth/wallpaper-surface'
import { WallpaperAreaEditor } from '../wallpaper-depth/wallpaper-area-editor'
import { useDepthImage } from '../wallpaper-depth/image-store'
import { customWallpaperBackground } from '../wallpaper-depth/wallpaper-layout'
import { LyricLayer } from '../lyrics/lyric-layer'
import { emptyLyrics, type LyricDocument } from '../lyrics/model'
import { RailLayer } from '../rail/rail-layer'
import type { RailController } from '../rail/use-rail'
import { useCoverColors } from '../desktop-card/use-cover-colors'
import { CoverColorControl } from '../desktop-card/cover-color-control'
import { useSceneShortcuts } from './use-scene-shortcuts'
import { ContextMenu } from '@/components/ui/context-menu'
import { layerIndex } from './scene-layers'
import { previewObjectActions } from './preview-object-actions'
import { railObstacles } from '../lyrics/avoid-rail'
import { railPlacementActions } from '../rail/rail-placement-actions'
import { SceneFocusProvider } from '../spectrum/scene-focus'

interface Props {
  settings: SpectrumSettings; update: SettingsUpdate;
  commitScene: (patch: Partial<SceneLayout>) => Promise<SpectrumSettings>;
  bands: RefObject<Float32Array>; receivedAt: RefObject<number>; analysis: RefObject<AnalysisSnapshot>;
  demo: boolean; onDemoChange: (value: boolean) => void; running: boolean;
  disabled: boolean; active: boolean;
  selectedRegion: string; onSelectRegion: (id: string) => void; arrangeRequest: number;
  nowPlaying?: NowPlaying;
  lyricDocument?: LyricDocument;
  onEditLyrics?: () => void; onEditCard?: () => void;
  rail?: RailController; selectedRail?: string | null; railEditing?: boolean;
  onSelectRail?: (groupId: string, itemId?: string) => void;
  onShow?: () => void;
  wallpaperEditing?: boolean;
  activePanel?: string;
  libraryRequest?: number;
  editActions?: ReactNode;
  sceneActions?: ReactNode;
}
interface StageProps extends Props {
  viewPreviewOnly?: boolean;
  screen: ScreenRect; desktop: DesktopBackground | null; image: PreviewImage | null;
  arranging: boolean; expanded: boolean;
  masking: boolean; selectedMask: string | null; onSelectMask: (id: string) => void;
  selection: string; selectObject: (key: string, itemId?: string) => void;
}

function PreviewStage(props: StageProps) {
  const { settings, update, screen, desktop, image, arranging, expanded, disabled } = props
  const colors = useCoverColors(settings, props.nowPlaying ?? emptyNowPlaying, props.active)
  const selectedObject = props.selection
  const selectRail = useCallback((groupId: string, itemId?: string) => {
    props.selectObject(`rail:${groupId}`, itemId)
  }, [arranging, props.onSelectRail, props.selectObject])
  const selectObject = props.selectObject
  const menu = selectedObject.startsWith('rail:') && props.rail
    ? railPlacementActions(props.rail, selectedObject.slice(5), () => selectObject(selectedObject))
    : previewObjectActions(settings, selectedObject, update, selectObject)
  const logicalScreen = { width: screen.width / window.devicePixelRatio, height: screen.height / window.devicePixelRatio }
  const obstacles = railObstacles(props.rail?.settings, logicalScreen)
  const holder = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [draft, setDraft] = useState<{ region: string; bounds: Bounds } | null>(null)
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const gesture = useRef<{ id: number; region: string; x: number; y: number; width: number; height: number; start: Bounds; next: Bounds; resize: boolean } | null>(null)
  useLayoutEffect(() => {
    let frame = 0
    const measure = () => {
      const available = holder.current!.clientWidth
      const maxHeight = expanded || window.innerWidth > 760 ? Math.max(1, holder.current!.clientHeight) : Infinity
      const width = Math.min(available, maxHeight * screen.width / screen.height)
      const height = width * screen.height / screen.width
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height })
    }
    // The holder is the source of truth. A window listener also measured the
    // same layout and synchronously rendered the whole preview a second time.
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    const observer = new ResizeObserver(schedule)
    observer.observe(holder.current!)
    measure()
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [screen.width, screen.height, expanded])
  useEffect(() => { if (disabled || !arranging) { gesture.current = null; setDraft(null); setGuides({ x: null, y: null }) } }, [disabled, arranging])
  const begin = (event: PointerEvent<HTMLElement>, resize: boolean, region: string) => {
    if (!arranging || disabled || event.button !== 0 || gesture.current) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus()
    const rect = surface.current!.getBoundingClientRect()
    const bounds = settingsForRegion(settings, region).bounds
    selectObject(`effect:${region}`)
    gesture.current = { id: event.pointerId, region, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, start: { ...bounds }, next: { ...bounds }, resize }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current
    if (!current || current.id !== event.pointerId) return
    const dx = (event.clientX - current.x) / current.width, dy = (event.clientY - current.y) / current.height
    const bounds = (current.resize ? resizeBounds : moveBounds)(current.start, dx, dy)
    const targets = sceneRegions(settings).filter(region => region.id !== current.region && region.visible).map(region => region.bounds)
    if (settings.desktopCard.enabled) targets.push(settings.desktopCard.bounds)
    if (settings.lyrics.enabled) targets.push(settings.lyrics.bounds)
    const snapped = !current.resize && !event.altKey ? snapBounds(bounds, current.width, current.height, targets) : { bounds, x: null, y: null }
    current.next = snapped.bounds; setGuides({ x: snapped.x, y: snapped.y })
    setDraft({ region: current.region, bounds: current.next })
  }
  const finish = (event: PointerEvent<HTMLElement>, cancelled = false) => {
    const current = gesture.current
    if (!current || current.id !== event.pointerId) return
    gesture.current = null
    setGuides({ x: null, y: null })
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancelled) update(latest => regionPatch(latest, current.region, { bounds: current.next }))
    setDraft(null)
  }
  const keyboard = (event: KeyboardEvent<HTMLElement>, resize: boolean, region: string) => {
    if (event.key === 'Escape' && gesture.current) {
      event.preventDefault(); event.stopPropagation(); gesture.current = null; setDraft(null); setGuides({ x: null, y: null }); return
    }
    if (disabled || !arranging || gesture.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const step = event.shiftKey ? .02 : .002
    props.onSelectRegion(region)
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
    update(latest => regionPatch(latest, region, { bounds: (resize ? resizeBounds : moveBounds)(settingsForRegion(latest, region).bounds, dx, dy) }))
  }
  const regions = sceneRegions(settings), count = Math.max(1, regions.filter(region => region.visible).length)
  return <SceneFocusProvider><div className="preview-stage-holder" ref={holder}>
    <ContextMenu {...menu} disabled={!arranging || disabled || props.viewPreviewOnly} onReturnFocus={() => {
      surface.current?.querySelector<HTMLElement>(`[data-preview-object="${CSS.escape(selectedObject)}"]`)?.focus({ preventScroll: true })
    }}>
    <div className={`desktop-preview${arranging ? ' arranging' : ''}`} ref={surface} style={{ width: size.width || '100%', height: size.width ? size.height : undefined, aspectRatio: `${screen.width} / ${screen.height}` }}
      onContextMenu={event => {
        const target = (event.target as Element).closest<HTMLElement>('[data-preview-object]')
        if (!arranging || disabled || !target || gesture.current) { event.preventDefault(); return }
        selectObject(target.dataset.previewObject!)
      }}>
      <div className="preview-wallpaper" data-testid="preview-wallpaper" style={{ ...wallpaperStyle(image, desktop, screen, size.width), filter: wallpaperFilter(settings.wallpaperDepth) }} />
      <WallpaperSurface settings={settings.wallpaperDepth} masks={settings.masks} analysis={props.analysis} image={image} background={desktop} screen={screen} paintImage={false} active={props.active} demo={props.demo} host={surface} />
      <div className="preview-corner"><span className={props.demo ? 'demo-dot' : props.running ? 'live-dot' : 'idle-dot'} />{props.demo ? '模拟音频' : props.running ? '实时输入' : '等待音乐播放'}</div>
      {regions.filter(region => region.visible || arranging).map(region => {
        const bounds = draft?.region === region.id ? draft.bounds : region.bounds
        const selected = arranging ? selectedObject === `effect:${region.id}` : props.selectedRegion === region.id
        return <div key={region.id} className={`preview-spectrum${selected ? ' selected' : ''}${selected && regions.length > 1 && !arranging && !props.viewPreviewOnly ? ' region-edit-target' : ''}${region.visible ? '' : ' region-hidden'}`} data-region-id={region.id} data-preview-object={`effect:${region.id}`} data-selected={selectedObject === `effect:${region.id}` || undefined} style={{ left: `${bounds.x * 100}%`, top: `${bounds.y * 100}%`, width: `${bounds.width * 100}%`, height: `${bounds.height * 100}%`, zIndex: layerIndex(settings, `effect:${region.id}`), pointerEvents: arranging || selected ? undefined : 'none' }}
        role={arranging ? 'group' : undefined} tabIndex={arranging && !disabled ? 0 : undefined}
        aria-label={arranging ? `${regions.length > 1 ? region.name + '，' : ''}动效位置，方向键移动，Shift 加速` : undefined}
        onFocus={() => { if (arranging) selectObject(`effect:${region.id}`) }} onPointerDown={event => begin(event, false, region.id)} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)} onKeyDown={event => keyboard(event, false, region.id)}>
        {region.visible && <SpectrumCanvas regionId={region.id} settings={{ ...settingsForRegion(colors.settings, region.id), bounds }} regionCount={count} bands={props.bands} receivedAt={props.receivedAt} analysis={props.analysis} demo={props.demo} active={props.active} interactive={!disabled && !arranging && !props.masking && selected}
          onViewChange={props.viewPreviewOnly ? undefined : view => update(latest => regionPatch(latest, region.id, { view }))} />}
        {selected && regions.length > 1 && !arranging && !props.viewPreviewOnly && <span className="region-edit-label">正在调整：{region.name}</span>}
        {arranging && <>
          <span className="preview-bounds-label" aria-hidden="true">{regions.length > 1 ? `${region.name}${region.visible ? '' : ' · 隐藏'} · ` : ''}{Math.round(bounds.width * 100)}% × {Math.round(bounds.height * 100)}%</span>
          <button className="preview-resize" aria-label="缩放动效" title="以中心缩放；方向键微调" disabled={disabled}
            onPointerDown={event => begin(event, true, region.id)} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)} onKeyDown={event => keyboard(event, true, region.id)} />
        </>}
      </div>})}
      {settings.desktopCard.enabled && <CardLayer onSnap={setGuides} zIndex={layerIndex(settings, 'card')} selected={selectedObject === 'card'} settings={settings.desktopCard} info={props.nowPlaying ?? emptyNowPlaying} color={colors.cardColor} bands={props.bands} receivedAt={props.receivedAt} demo={props.demo} active={props.active} previewSize={{ width: logicalScreen.width * settings.desktopCard.bounds.width, height: logicalScreen.height * settings.desktopCard.bounds.height, scale: size.width / logicalScreen.width }} arranging={arranging && !disabled} onSelect={() => selectObject('card')} onChange={bounds => update({ desktopCard: { ...settings.desktopCard, bounds } })} />}
      {settings.lyrics.enabled && <LyricLayer onSnap={arranging ? setGuides : undefined} settings={settings.lyrics} appearance={colors.settings} cardAccent={settings.desktopCard.enabled ? settings.desktopCard.accentColor : undefined} document={props.lyricDocument ?? emptyLyrics} info={props.nowPlaying ?? emptyNowPlaying} demo={props.demo} active={props.active}
        obstacles={obstacles} zIndex={layerIndex(settings, 'lyrics')} selected={selectedObject === 'lyrics'} draggable={!disabled && !props.masking && !props.viewPreviewOnly} onSelect={() => selectObject('lyrics')} onBoundsChange={(bounds, resized) => update(current => ({ lyrics: { ...current.lyrics, bounds,
          fontSize: resized ? Math.round(Math.max(18, Math.min(72, current.lyrics.fontSize * Math.sqrt(bounds.width * bounds.height / (current.lyrics.bounds.width * current.lyrics.bounds.height))))) : current.lyrics.fontSize } }))} />}
      {props.rail && !props.viewPreviewOnly && <RailLayer desktopWidth={logicalScreen.width} controller={props.rail} selected={arranging ? selectedObject.startsWith('rail:') ? selectedObject.slice(5) : null : props.selectedRail ?? null} arranging={arranging && !disabled} editing={!!props.railEditing && !disabled} interactive={!props.masking && !disabled} onSelect={selectRail} />}
      {props.masking && <MaskEditor masks={settings.masks} selected={props.selectedMask} onSelect={props.onSelectMask} disabled={disabled} onChange={masks => update({ masks })} />}
      {arranging && (guides.x !== null || guides.y !== null) && <div className="preview-alignment-guides" aria-hidden="true">
        {guides.x !== null && <i className="guide-x" style={{ left: `${guides.x * 100}%` }} />}
        {guides.y !== null && <i className="guide-y" style={{ top: `${guides.y * 100}%` }} />}
      </div>}
      {props.wallpaperEditing && settings.wallpaperDepth.ambientEnabled && !disabled && !arranging && !props.masking && !props.viewPreviewOnly && <WallpaperAreaEditor bounds={settings.wallpaperDepth.ambientBounds} onChange={ambientBounds => update(latest => ({ wallpaperDepth: { ...latest.wallpaperDepth, ambientBounds } }))} />}
    </div>
    </ContextMenu>
  </div>{!props.viewPreviewOnly && <CoverColorControl settings={settings} display={colors.settings} message={colors.message} available={colors.available} disabled={disabled} update={update} />}</SceneFocusProvider>
}

export function DesktopPreview(props: Props) {
  const background = useBackground()
  const wallpaper = props.settings.wallpaperDepth
  const custom = useDepthImage(wallpaper.source === 'custom' ? wallpaper.revision : '')
  const [arranging, setArranging] = useState(false), [expanded, setExpanded] = useState(false)
  const [selection, setSelection] = useState(`effect:${props.selectedRegion}`)
  useEffect(() => {
    if (props.activePanel === 'lyrics') setSelection('lyrics')
    else if (props.activePanel === 'card') setSelection('card')
    else if (props.activePanel === 'scene') setSelection(`effect:${props.selectedRegion}`)
  }, [props.activePanel, props.selectedRegion])
  const selectObject = (key: string, itemId?: string) => {
    setSelection(key)
    if (key === 'lyrics') props.onEditLyrics?.()
    else if (key === 'card') props.onEditCard?.()
    else if (key.startsWith('rail:')) props.onSelectRail?.(key.slice(5), itemId)
    else if (key.startsWith('effect:')) props.onSelectRegion(key.slice(7))
  }
  const [masking, setMasking] = useState(false), [selectedMask, selectMask] = useState<string | null>(null)
  const [autoOpen, setAutoOpen] = useState(false)
  const autoTrigger = useRef<HTMLButtonElement>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const libraryTrigger = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (props.libraryRequest) { setExpanded(false); setAutoOpen(false); setLibraryOpen(true) } }, [props.libraryRequest])
  const [history, setHistory] = useState<{ before: SceneComposition | SceneLayout; after: string; masks: boolean; desktop?: boolean } | null>(null)
  const [sceneNotice, setSceneNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [undoing, setUndoing] = useState(false)
  const canUndo = history && history.after === JSON.stringify(history.desktop ? desktopLayout(props.settings) : history.masks ? layout(props.settings) : composition(props.settings))
  useEffect(() => {
    if (history && !canUndo && !undoing) { setHistory(null); setSceneNotice(null) }
  }, [history, canUndo, undoing])
  const applyScene = async (scene: SceneComposition, choice: { key: string; id: string; strength: number }) => {
    const before = composition(props.settings)
    const saved = await props.commitScene(scene)
    setHistory({ before, after: JSON.stringify(composition(saved)), masks: false })
    props.onSelectRegion('primary'); setArranging(false); setMasking(false)
    try { rememberChoice(choice); setSceneNotice({ text: '搭配已应用，可撤销。', error: false }) }
    catch { setSceneNotice({ text: '搭配已应用，但未能记住这张壁纸的方案偏好。', error: true }) }
  }
  const applySavedScene = async (scene: SceneLayout) => {
    const capture = scene.desktop ? desktopLayout : layout
    const before = capture(props.settings)
    const saved = await props.commitScene(scene)
    setHistory({ before, after: JSON.stringify(capture(saved)), masks: true, desktop: !!scene.desktop })
    props.onSelectRegion('primary'); setArranging(false); setMasking(false)
    setSceneNotice({ text: '收藏场景已应用，可撤销。', error: false })
  }
  const undoScene = async () => {
    if (!history || !canUndo || undoing || props.disabled) return
    setUndoing(true)
    try { await props.commitScene(history.before); setHistory(null); setSceneNotice({ text: '已恢复应用前的搭配。', error: false }) }
    catch (error) { setSceneNotice({ text: `撤销失败：${error instanceof Error ? error.message : String(error)}`, error: true }) }
    finally { setUndoing(false) }
  }
  useSceneShortcuts({ disabled: props.disabled, apply: applySavedScene,
    show: () => props.onShow?.(), open: () => { setExpanded(false); setAutoOpen(false); setLibraryOpen(true) },
    report: text => setSceneNotice({ text, error: true }) })
  const maskSelection = props.settings.masks.some(mask => mask.id === selectedMask) ? selectedMask : props.settings.masks[0]?.id ?? null
  useEffect(() => { if (props.arrangeRequest) { setArranging(true); setMasking(false) } }, [props.arrangeRequest])
  const fileInput = useRef<HTMLInputElement>(null)
  const screen = background.desktop?.screen ?? referenceScreen
  const systemPreview = props.wallpaperEditing || background.mode === 'desktop'
  const image = wallpaper.source === 'custom' ? custom.image ? { url: custom.image.dataUrl, width: custom.image.width, height: custom.image.height } : null : systemPreview ? background.systemImage : background.image
  const desktop = wallpaper.source === 'custom' ? customWallpaperBackground(wallpaper, screen) : systemPreview ? background.desktop : null
  const available = wallpaper.source === 'custom' ? !!custom.image : systemPreview ? !!background.desktop && !background.error && !background.loading : background.mode === 'plain' || background.mode === 'custom' && !!background.image
  const stageProps: StageProps = { ...props, selection, selectObject, screen, desktop, image, arranging: arranging && !props.disabled, expanded, masking: masking && !props.disabled, selectedMask: maskSelection, onSelectMask: selectMask }
  const status = wallpaper.source === 'custom' ? custom.error ?? (custom.loading ? '正在读取自选壁纸…' : null) : systemPreview
    ? background.loading ? '正在读取壁纸…' : !native ? props.wallpaperEditing ? '浏览器无法读取系统壁纸，请在右侧选择自选图片预览。' : '浏览器无法读取系统壁纸，可选择参考图片。' : background.error
    : background.mode === 'custom' && !background.image ? '请选择参考图片。' : null
  const stage = <PreviewStage {...stageProps} />
  const selectedSettings = settingsForRegion(props.settings, props.selectedRegion)
  const updateSelected = (patch: Partial<SpectrumSettings>) => props.update(latest => regionPatch(latest, props.selectedRegion, patch))
  const arrangementButton = <Button size="sm" variant="ghost" disabled={props.disabled} aria-pressed={arranging} onClick={() => { setArranging(value => !value); setMasking(false) }}><Move size={14} />{arranging ? '完成布置' : '布置'}</Button>
  const maskButton = <Button size="sm" variant="ghost" disabled={props.disabled} aria-pressed={masking} onClick={() => { setMasking(value => !value); setArranging(false) }}><Scan size={14} />{masking ? '完成遮罩' : '遮罩'}</Button>
  const presets = <LayoutPresets bounds={selectedSettings.bounds} disabled={props.disabled} onChange={bounds => updateSelected({ bounds })} />
  const maskControls = <MaskControls masks={props.settings.masks} selected={maskSelection} onSelect={selectMask} disabled={props.disabled} onChange={masks => props.update({ masks })} />
  const objectControls = arranging && !props.disabled && <div className="preview-arrange-toolbar"><PreviewObjectList settings={props.settings} update={props.update} rail={props.rail} selected={selection} onSelect={selectObject} disabled={props.disabled} /><span>方向键微调 · Alt 暂停吸附</span></div>
  return <section className="preview-section" aria-label="效果预览">
    <div className="section-toolbar">
      <div className="preview-title-actions"><h2><Monitor size={16} />桌面预览</h2>
        <div className="auto-scene-entry"><Button ref={autoTrigger} size="sm" variant="outline" disabled={props.disabled} onClick={() => { setExpanded(false); setAutoOpen(true) }}><Sparkles size={14} />自动搭配</Button>
          <Button ref={libraryTrigger} size="sm" variant="ghost" disabled={props.disabled} onClick={() => { setExpanded(false); setLibraryOpen(true) }}><Bookmark size={14} />场景收藏</Button>
        </div>
        {props.sceneActions}
        {props.editActions}
      </div>
      <div className="preview-tools">
        <label className="demo-control" htmlFor="demo-switch">模拟预览<Switch id="demo-switch" checked={props.demo} onCheckedChange={props.onDemoChange} /></label>
        {arrangementButton}
        {maskButton}
        <IconButton aria-label="放大预览" title="放大预览" onClick={() => setExpanded(true)}><Maximize2 size={15} /></IconButton>
      </div>
    </div>
    {!expanded && objectControls}
    {!expanded && !autoOpen && !libraryOpen ? stage : <div className="preview-open-notice">{autoOpen ? '正在预览搭配' : libraryOpen ? '正在预览收藏' : '正在放大预览'}</div>}
    {!expanded && arranging && !props.disabled && presets}
    {!expanded && masking && !props.disabled && maskControls}
    <div className="preview-footer">
      {wallpaper.source === 'custom' || props.wallpaperEditing ? <div className="preview-background-row"><span className="preview-background-label">{wallpaper.source === 'custom' ? '自选壁纸' : '系统壁纸'} · 与桌面一致</span>{native && wallpaper.source === 'system' && <IconButton aria-label="刷新桌面壁纸" title="刷新桌面壁纸" disabled={background.loading} onClick={() => void background.refresh()}><RefreshCw size={14} /></IconButton>}</div> : <div className="preview-background-row"><span className="preview-background-label">预览背景</span><div className="preview-background-controls" role="group" aria-label="预览背景">
        <button aria-pressed={background.mode === 'desktop'} onClick={() => background.choose('desktop')}>桌面壁纸</button>
        <button aria-label="纯色预览背景" aria-pressed={background.mode === 'plain'} onClick={() => background.choose('plain')}>纯色</button>
        {background.custom && <button aria-pressed={background.mode === 'custom'} onClick={() => background.choose('custom')}>参考图片</button>}
        <IconButton aria-label="选择参考图片" title="选择参考图片，仅用于预览" disabled={background.importing} onClick={() => fileInput.current?.click()}><ImagePlus size={15} /></IconButton>
        {background.mode === 'desktop' && native && <IconButton aria-label="刷新桌面壁纸" title="刷新桌面壁纸" disabled={background.loading} onClick={() => void background.refresh()}><RefreshCw size={14} className={background.loading ? 'spinning' : ''} /></IconButton>}
      </div></div>}
      <span className="preview-screen-info">{background.desktop ? '主屏幕' : '参考比例'} · {screen.width} × {screen.height}</span>
    </div>
    {(canUndo || sceneNotice) && <div className="scene-feedback">
      {canUndo && <Button size="sm" variant="ghost" disabled={props.disabled || undoing} onClick={() => void undoScene()}><Undo2 size={14} />撤销搭配</Button>}
      {sceneNotice && <span role={sceneNotice.error ? 'alert' : 'status'}>{sceneNotice.text}</span>}
    </div>}
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/bmp" aria-label="参考图片文件" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void background.importFile(file) }} />
    {(status || wallpaper.source === 'system' && (background.fileError || background.importing)) && <p className="preview-message" role={custom.error || wallpaper.source === 'system' && (background.fileError || background.error && systemPreview) ? 'alert' : 'status'}>{wallpaper.source === 'custom' ? status : background.fileError ?? (background.importing ? '正在保存参考图片…' : status)}</p>}
    {arranging && !props.disabled && <p className="preview-message">拖动位置，右下角缩放；右键调整图层、居中或复制。方向键微调，Shift 加速。歌词自动避让拾光绳。</p>}
    <Dialog.Root open={expanded} onOpenChange={setExpanded}>
      <ModalContent className="preview-dialog">
        <div className="preview-dialog-heading"><Dialog.Title>桌面预览</Dialog.Title><div className="preview-tools">{arrangementButton}{maskButton}<Dialog.Close asChild><IconButton aria-label="关闭放大预览"><X size={18} /></IconButton></Dialog.Close></div></div>
        <Dialog.Description className="sr-only">按主屏幕比例预览壁纸和动效，可布置位置与大小。</Dialog.Description>
        {expanded && objectControls}
        {expanded && stage}
        {arranging && !props.disabled && presets}
        {masking && !props.disabled && maskControls}
        <div className="preview-dialog-footer">{arranging ? '拖动位置 · 右下角居中缩放 · 方向键微调' : `${screen.width} × ${screen.height}`} · Esc 关闭</div>
      </ModalContent>
    </Dialog.Root>
    {autoOpen && <AutoSceneDialog settings={props.settings} image={image} desktop={desktop} screen={screen}
      available={available}
      unavailableReason={background.loading ? '正在读取桌面壁纸，请稍候。' : '请先读取桌面壁纸或选择参考图片，也可以使用纯色背景。'}
      demo={props.demo} disabled={props.disabled} onClose={() => setAutoOpen(false)} onReturnFocus={() => autoTrigger.current?.focus()} onApply={applyScene}
      renderPreview={(settings, demo) => <PreviewStage {...stageProps} settings={settings} demo={demo} expanded active arranging={false} masking={false} selectedRegion="primary" viewPreviewOnly />} />}
    {libraryOpen && <SceneLibraryDialog settings={props.settings} image={image} desktop={desktop} screen={screen}
      available={available}
      demo={props.demo} disabled={props.disabled} onClose={() => setLibraryOpen(false)} onReturnFocus={() => libraryTrigger.current?.focus()} onApply={applySavedScene}
      renderPreview={(settings, demo) => <PreviewStage {...stageProps} settings={settings} demo={demo} expanded active arranging={false} masking={false} selectedRegion="primary" viewPreviewOnly />} />}
  </section>
}
