import { useEffect, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import { BookOpen, Check, CircleHelp, Headphones, Monitor, Redo2, SlidersHorizontal, Sparkles, Undo2, X } from 'lucide-react'
import { ModalContent } from '@/components/ui/modal'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { SettingToggle } from '@/components/ui/setting-toggle'
import { ChoiceSelect } from '@/components/ui/choice-select'
import { native } from '../spectrum/bridge'
import type { RuntimeStatus, SettingsUpdate, SpectrumSettings } from '../spectrum/model'
import type { RailController } from '../rail/use-rail'
import type { LyricDocument } from '../lyrics/model'
import { desktopPresets } from '../preview/desktop-scenes'
import { readLibrary, rememberScene, type SavedScene, type SceneLayout } from '../preview/scene-library'
import { SceneThumbnail } from '../preview/scene-thumbnail'

interface Props {
  hideActions?: boolean;
  settings: SpectrumSettings; status: RuntimeStatus; rail: RailController; lyrics: LyricDocument;
  loaded: boolean; busy: boolean; saveState: string; disabled: boolean;
  update: SettingsUpdate; commitScene: (scene: SceneLayout) => Promise<unknown>;
  canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void;
  onLibrary: () => void; onArrange: () => void;
}
const guideKey = 'soundspectra.guide-seen.v1'

export function WorkspaceTools(props: Props) {
  const [panel, setPanel] = useState<'guide' | 'quick' | null>(null)
  const [unread, setUnread] = useState(() => { try { return !localStorage.getItem(guideKey) } catch { return true } })
  const [recent, setRecent] = useState<SavedScene[]>([])
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const applyingRef = useRef(false)
  const guideTrigger = useRef<HTMLButtonElement>(null), quickTrigger = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const returnControl = useRef<'guide' | 'quick'>('quick')
  const current = useRef(props); current.current = props
  const locked = props.disabled || applying
  const historyLocked = locked || props.saveState !== 'saved'
  const open = (value: 'guide' | 'quick') => {
    returnControl.current = value
    returnFocus.current = current.current.hideActions
      ? document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement : document.querySelector<HTMLElement>('.atmosphere-navigation button')
      : (value === 'guide' ? guideTrigger : quickTrigger).current
    setPanel(value); setError(null); setNotice(null)
  }
  const restoreFocus = () => {
    const target = current.current.hideActions
      ? returnFocus.current?.isConnected ? returnFocus.current : document.querySelector<HTMLElement>('.atmosphere-navigation button')
      : (returnControl.current === 'guide' ? guideTrigger : quickTrigger).current
    target?.focus()
  }
  useEffect(() => {
    if (!panel) return
    if (panel === 'guide') {
      setUnread(false)
      try { localStorage.setItem(guideKey, '1') } catch { /* Guide remains available without storage. */ }
    } else {
      try { setRecent(readLibrary().sort((a, b) => (b.usedAt ?? b.updated) - (a.usedAt ?? a.updated)).slice(0, 3)) }
      catch { setRecent([]); setError('收藏暂时无法读取，可在场景收藏中重试或恢复。') }
    }
  }, [panel])
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (document.querySelector('.studio-shell[inert]')) return
      const target = event.target instanceof Element ? event.target : null
      if (event.defaultPrevented || event.isComposing || target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="slider"]') || document.querySelector('[role="dialog"],[role="alertdialog"]')) return
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())) {
        if (current.current.disabled || current.current.saveState !== 'saved') return
        event.preventDefault()
        if (event.key.toLowerCase() === 'y' || event.shiftKey) current.current.redo()
        else current.current.undo()
      } else if (modifier && !event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); open('quick') }
      else if (!modifier && !event.altKey && event.key === '?') { event.preventDefault(); open('guide') }
    }
    window.addEventListener('keydown', keyboard)
    const quick = () => open('quick')
    window.addEventListener('workspace-quick-controls', quick)
    return () => { window.removeEventListener('keydown', keyboard); window.removeEventListener('workspace-quick-controls', quick) }
  }, [])
  const jump = (action: () => void) => { setPanel(null); requestAnimationFrame(action) }
  const focusSource = () => {
    const source = document.querySelector<HTMLButtonElement>('.audio-source-choice [role="combobox"]')
    source?.focus()
  }
  const apply = async (choice: { id: string; name: string; scene: SceneLayout }) => {
    if (locked || applyingRef.current) return
    applyingRef.current = true; setApplying(true); setError(null); setNotice(null)
    try {
      await props.commitScene(choice.scene)
      setNotice(`已切换到「${choice.name}」，可在工作台撤销。`)
      try { rememberScene(choice.id, choice.name) }
      catch { setError('场景已应用，但最近使用记录未能保存。') }
    } catch (reason) { setError(`切换失败：${reason instanceof Error ? reason.message : String(reason)}`) }
    finally { applyingRef.current = false; setApplying(false) }
  }
  const connection = !native ? '浏览器模拟预览' : props.status.state === 'listening' ? `${props.status.sourceName ?? '音乐'} · 正在播放`
    : props.status.state === 'silent' ? '音源已连接，等待声音' : props.status.state === 'error' ? '音源连接异常' : props.status.state === 'connecting' ? '正在连接音源' : '等待播放器启动'
  return <>
    <div className="workspace-edit-actions" role="group" aria-label="工作台工具" hidden={props.hideActions}>
      <IconButton aria-label="撤销编辑" title="撤销编辑 · Ctrl / ⌘ Z" disabled={historyLocked || !props.canUndo} onClick={props.undo}><Undo2 size={15} /></IconButton>
      <IconButton aria-label="重做编辑" title="重做编辑 · Ctrl / ⌘ Shift Z" disabled={historyLocked || !props.canRedo} onClick={props.redo}><Redo2 size={15} /></IconButton>
      <span className="workspace-action-divider" />
      <IconButton ref={quickTrigger} aria-label="快捷控制" title="快捷控制 · Ctrl / ⌘ K" onClick={() => open('quick')}><SlidersHorizontal size={15} /></IconButton>
      <IconButton ref={guideTrigger} className={unread ? 'guide-unread' : ''} aria-label="使用指南" title="使用指南 · ?" onClick={() => open('guide')}><CircleHelp size={15} />{unread && <span className="guide-unread-dot" />}</IconButton>
    </div>
    <Dialog.Root open={panel !== null} onOpenChange={value => { if (!value && !applyingRef.current) setPanel(null) }}>
      <ModalContent className="workspace-tools-dialog" onEscapeKeyDown={event => { if (applyingRef.current) event.preventDefault() }} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus() }}>
        <header><div><Dialog.Title>{panel === 'guide' ? <><BookOpen size={19} />让音乐成为桌面的一部分</> : <><SlidersHorizontal size={19} />快捷控制</>}</Dialog.Title><Dialog.Description>{panel === 'guide' ? '连接音乐，选择搭配，再把喜欢的画面留在桌面。' : '切换常用场景，管理桌面显示与性能。'}</Dialog.Description></div><Dialog.Close asChild><IconButton aria-label="关闭工作台工具" disabled={applying}><X size={18} /></IconButton></Dialog.Close></header>
        <div className="workspace-tools-body">
          {panel === 'guide' ? <>
            {!native && <p className="workspace-capability-note">当前为浏览器预览。模拟音频用于体验效果；真实音乐捕获与桌面显示请在桌面客户端使用。</p>}
            <ol className="workspace-guide-steps">
              <li><span><Headphones size={18} /></span><div><h3>连接正在播放的音乐</h3><p>打开 QQ 音乐等播放器，在底部「音乐来源」选择自动识别或指定播放器。</p><small>{connection}</small><Button size="sm" variant="outline" onClick={() => jump(focusSource)}>查看音乐来源</Button></div></li>
              <li><span><Sparkles size={18} /></span><div><h3>从一套场景开始</h3><p>在精选搭配中预览灯效、歌词和卡片，也可以自动搭配，再分别微调。</p><Button size="sm" variant="outline" disabled={locked} onClick={() => jump(props.onLibrary)}>挑选场景</Button></div></li>
              <li><span><Monitor size={18} /></span><div><h3>布置并显示到桌面</h3><p>进入布置模式拖动对象，方向键微调。底部「显示到桌面」控制音乐视觉，拾光绳拥有独立开关。</p><Button size="sm" variant="outline" disabled={locked} onClick={() => jump(props.onArrange)}>开始布置</Button></div></li>
            </ol>
            <details className="workspace-guide-details"><summary>没有声音或歌词时</summary><p>先确认播放器正在播放，再检查底部音源状态；静音不会产生灯效响应。歌词还需要播放器提供歌曲信息和有效进度，可到歌词面板查看同步状态。Mac 首次捕获需在系统设置中允许屏幕与系统音频录制。</p></details>
            <div className="workspace-keyboard-help"><span><kbd>Ctrl / ⌘ Z</kbd>撤销</span><span><kbd>Ctrl / ⌘ Shift Z</kbd>重做</span><span><kbd>Ctrl / ⌘ K</kbd>快捷控制</span><span><kbd>?</kbd>指南</span></div>
            <p className="workspace-tool-note">展示参数自动保存；喜欢的搭配请另外保存到场景收藏。拾光绳与个人文件独立管理。</p>
          </> : <>
            <section className="workspace-runtime-summary" aria-label="当前运行状态"><span className={native && props.status.state === 'listening' ? 'is-connected' : ''}>{connection}</span><span>歌词：{props.settings.lyrics.enabled ? props.lyrics.status === 'ready' ? '已就绪' : '等待同步' : '已关闭'}</span></section>
            <section className="workspace-quick-outputs" aria-label="桌面显示">
              <SettingToggle label="音乐视觉" accessibleLabel="快捷音乐视觉输出" description="灯效、歌词、音乐卡片与壁纸" checked={props.settings.enabled} disabled={!native || locked || props.saveState !== 'saved'} onChange={enabled => props.update({ enabled })} />
              <SettingToggle label="拾光绳" accessibleLabel="快捷拾光绳输出" description={props.rail.supported ? '独立管理桌面上的应用、图片与便签' : '桌面客户端中可启用'} checked={props.rail.settings.enabled} disabled={locked || !props.rail.loaded || !props.rail.supported || props.rail.pending > 0} onChange={enabled => { void props.rail.change({ type: 'enable', enabled }).catch(() => {}) }} />
              <div className="workspace-quick-quality"><span>渲染性能</span><ChoiceSelect label="快捷渲染性能" value={props.settings.quality} disabled={locked} onChange={quality => props.update({ quality: quality as SpectrumSettings['quality'] })} options={[{ value: 'eco', label: '省电 · 30 帧' }, { value: 'balanced', label: '均衡 · 60 帧' }, { value: 'smooth', label: '流畅 · 120 帧' }, { value: 'unlimited', label: '不限制' }]} /></div>
            </section>
            <section className="workspace-quick-scenes"><h3>{recent.length ? '最近收藏' : '精选搭配'}</h3><div>{(recent.length ? recent : desktopPresets).map(choice => <button key={choice.id} disabled={locked} aria-label={`快速应用${choice.name}`} onClick={() => void apply(choice)}><SceneThumbnail scene={choice.scene} /><span>{choice.name}</span></button>)}</div><Button variant="ghost" size="sm" disabled={locked} onClick={() => jump(props.onLibrary)}>浏览全部场景</Button></section>
            <p className="workspace-tool-note">{native ? '托盘菜单也可切换精选场景和最近收藏，收起窗口后桌面效果继续运行。' : '浏览器中的修改仅保存到此浏览器，桌面输出不可用。'}</p>
            {(props.rail.error || props.rail.desktopError) && <p role="alert">{props.rail.error ?? props.rail.desktopError}</p>}
          </>}
          {error && <p role="alert">{error}</p>}{notice && <p role="status" className="workspace-tool-success"><Check size={14} />{notice}</p>}
        </div>
      </ModalContent>
    </Dialog.Root>
  </>
}
