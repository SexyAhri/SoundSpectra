import { IconButton } from '@/components/ui/icon-button'
import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, Copy, LoaderCircle, Maximize2, Minus, Settings2, X } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import * as autostart from '@tauri-apps/plugin-autostart'
import { native, describeError } from '../spectrum/bridge'
import { applicationInfo, backupConfiguration, defaultPreferences, exportDiagnostics, loadPreferences, openHistory, openRepository, savePreferences, subscribeApplicationActions, type ApplicationInfo, type Preferences } from './client'
import { useUpdater } from './use-updater'
import { ApplicationSettingsDialog } from './application-settings-dialog'
import { QuitDialog } from './quit-dialog'
import githubMark from '../../assets/github-mark.svg'

interface Props { beforeClose: () => Promise<void>; open: boolean; onOpenChange: (open: boolean) => void }
export function ApplicationToolbar({ beforeClose, open, onOpenChange: setOpen }: Props) {
  const [info, setInfo] = useState<ApplicationInfo | null>(null)
  const [preferences, setPreferences] = useState(defaultPreferences)
  const [loaded, setLoaded] = useState(false)
  const [starting, setStarting] = useState(false)
  const [autostartKnown, setAutostartKnown] = useState(false)
  const [pending, setPending] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [tab, setTab] = useState('general')
  const [quitOpen, setQuitOpen] = useState(false)
  const [quitPending, setQuitPending] = useState(false)
  const [quitError, setQuitError] = useState<string | null>(null)
  const quitting = useRef(false)
  const busy = useRef(false)
  const updater = useUpdater(Boolean(info?.updaterConfigured && loaded), preferences.autoCheckUpdates, preferences.autoInstallUpdates, beforeClose)
  const updateBusy = ['checking', 'downloading', 'installing'].includes(updater.state.phase)
  const updateAvailable = Boolean(updater.state.version)
  const installing = useRef(false); installing.current = updater.state.phase === 'installing'
  useEffect(() => {
    if (!native) return
    let disposed = false
    let stop: (() => void) | undefined
    void subscribeApplicationActions(action => {
      if (disposed) return
      if (action === 'quit') { setQuitError(null); setQuitOpen(true) }
      else if (action === 'settings' || action === 'updates' || action === 'about') {
        setTab(action === 'settings' ? 'general' : action); setOpen(true)
      } else { setOpen(false); location.hash = `#${action}` }
    }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten })
      .catch(reason => { if (!disposed) setError(describeError(reason)) })
    return () => { disposed = true; stop?.() }
  }, [setOpen])
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void applicationInfo().then(v => { if (!disposed) setInfo(v) }).catch(e => { if (!disposed) setError(describeError(e)) })
    void loadPreferences().then(v => { if (!disposed) { setPreferences(v); setLoaded(true) } }).catch(e => { if (!disposed) setError(describeError(e)) })
    if (native) {
      void autostart.isEnabled().then(v => { if (!disposed) { setStarting(v); setAutostartKnown(true) } }).catch(e => { if (!disposed) setError(describeError(e)) })
      const window = getCurrentWindow()
      const refresh = () => { void window.isMaximized().then(v => { if (!disposed) setMaximized(v) }) }
      refresh()
      void window.onResized(refresh).then(stop => { if (disposed) stop(); else unlisten = stop })
    }
    return () => { disposed = true; unlisten?.() }
  }, [])
  const perform = async (operation: () => Promise<unknown>) => {
    if (busy.current) return
    busy.current = true; setPending(true); setError(null); setNotice(null)
    try { await operation() } catch (reason) { setError(describeError(reason)); setOpen(true) }
    finally { busy.current = false; setPending(false) }
  }
  const change = (patch: Partial<Preferences>) => perform(async () => setPreferences(await savePreferences({ ...preferences, ...patch })))
  const requestQuit = () => { setQuitError(null); setQuitOpen(true) }
  const close = () => {
    if (!preferences.closeToTray) { requestQuit(); return }
    void perform(async () => { await beforeClose(); await getCurrentWindow().close() })
  }
  const confirmQuit = async () => {
    if (quitting.current || installing.current) return
    quitting.current = true; setQuitPending(true); setQuitError(null)
    try {
      await beforeClose()
      if (installing.current) return
      await invoke('quit_application')
      setQuitOpen(false)
    } catch (reason) { setQuitError(`未能退出：${describeError(reason)}`) }
    finally { quitting.current = false; setQuitPending(false) }
  }
  const showUpdates = () => { setTab('updates'); setOpen(true) }
  return <>
    <div className="application-actions">
      <IconButton title="GitHub 代码仓库" aria-label="GitHub 代码仓库" disabled={pending} onClick={() => void perform(() => openRepository(info?.repository || undefined))}><span aria-hidden="true" className="github-mark" style={{ maskImage: `url("${githubMark}")`, WebkitMaskImage: `url("${githubMark}")` }} /></IconButton>
      {preferences.showUpdateButton && <IconButton className={updateAvailable ? 'has-update' : undefined} title={updateAvailable ? `发现新版本 ${updater.state.version}` : '检查更新'} aria-label="检查更新" aria-description={updateAvailable ? `发现新版本 ${updater.state.version}` : undefined} onClick={showUpdates}>
        {updateBusy ? <LoaderCircle size={15} className="spinning" /> : <ArrowDownToLine size={15} />}
        {updateAvailable && <span className="update-dot" aria-hidden="true" />}
      </IconButton>}
      <IconButton className="mobile-settings" title="应用设置与更新" aria-label="应用设置与更新" onClick={() => setOpen(true)}><Settings2 size={15} /></IconButton>
      {native && <div className="window-controls">
        <button aria-label="最小化" title="最小化" onClick={() => void perform(() => getCurrentWindow().minimize())}><Minus size={16} /></button>
        <button aria-label={maximized ? '还原窗口' : '最大化'} title={maximized ? '还原窗口' : '最大化'} onClick={() => void perform(() => getCurrentWindow().toggleMaximize())}>{maximized ? <Copy size={13} /> : <Maximize2 size={14} />}</button>
        <button aria-label="关闭窗口" title={preferences.closeToTray ? '收起到托盘' : '退出 SoundSpectra'} className="window-close" disabled={pending || updater.state.phase === 'installing'} onClick={() => void close()}><X size={17} /></button>
      </div>}
    </div>
    {['downloading', 'installing'].includes(updater.state.phase) && !open && <div className="update-notification" role="status">
      <span>{updater.state.phase === 'downloading' ? '正在下载更新' : '正在安装，即将重启'} {updater.state.version}</span>
      <button onClick={showUpdates}>查看进度</button>
    </div>}
    <ApplicationSettingsDialog open={open} onOpenChange={setOpen} tab={tab} onTabChange={setTab} info={info} preferences={preferences} loaded={loaded} pending={pending} starting={starting} autostartKnown={autostartKnown} error={error} notice={notice} updater={updater}
      onPreference={patch => void change(patch)}
      onAutostart={value => void perform(async () => { await (value ? autostart.enable() : autostart.disable()); setStarting(await autostart.isEnabled()) })}
      onBackup={() => void perform(async () => { await beforeClose(); setNotice(`配置已备份到：${await backupConfiguration()}`) })}
      onDiagnostics={() => void perform(async () => setNotice(`诊断信息已导出：${await exportDiagnostics()}`))}
      onRetry={() => void perform(async () => { setInfo(await applicationInfo()); setPreferences(await loadPreferences()); setLoaded(true) })}
      onHistory={() => { if (info?.repository) void perform(() => openHistory(info.repository)) }}
      onRepository={() => void perform(() => openRepository(info?.repository || undefined))}
      onQuit={requestQuit}
    />
    <QuitDialog open={quitOpen} onOpenChange={setQuitOpen} pending={quitPending} installing={updater.state.phase === 'installing'} error={quitError} onConfirm={() => void confirmQuit()} />
  </>
}
