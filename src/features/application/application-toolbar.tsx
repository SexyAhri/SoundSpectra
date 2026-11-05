import { useEffect, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import { ArrowDownToLine, Check, Copy, ExternalLink, LoaderCircle, Maximize2, Minus, Settings2, X } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import * as autostart from '@tauri-apps/plugin-autostart'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { native, describeError } from '../spectrum/bridge'
import { applicationInfo, backupConfiguration, defaultPreferences, exportDiagnostics, loadPreferences, openHistory, openRepository, savePreferences, type ApplicationInfo, type Preferences } from './client'
import { useUpdater } from './use-updater'
import packageInfo from '../../../package.json'
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
  const busy = useRef(false)
  const updater = useUpdater(Boolean(info?.updaterConfigured && loaded), preferences.autoCheckUpdates, preferences.autoInstallUpdates, beforeClose)
  const updateBusy = ['checking', 'downloading', 'installing'].includes(updater.state.phase)
  const updateAvailable = ['available', 'ready'].includes(updater.state.phase)
  const [dismissed, setDismissed] = useState<string | null>(null)
  useEffect(() => {
    if (!dismissed) return
    const timer = setTimeout(() => setDismissed(null), 4 * 60 * 60 * 1000)
    return () => clearTimeout(timer)
  }, [dismissed])
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
  const close = () => perform(async () => { await beforeClose(); await getCurrentWindow().close() })
  const updateMessage = !native ? '浏览器中可预览界面，更新需要在桌面客户端进行。'
    : !info?.updaterConfigured ? '此构建尚未启用在线更新，可前往历史版本页面下载安装包。'
    : ({ idle: '启动时自动检查，也可以手动检查新版本。', checking: '正在检查新版本…', current: '你正在使用最新版本。', available: `发现新版本 ${updater.state.version}`, downloading: '正在下载更新，可以收起此面板继续使用。', ready: '下载完成，签名验证已通过。安装前会备份你的配置。', installing: '正在准备安装，客户端将退出并在更新后重新打开。', error: '检查失败，当前版本仍可继续使用。' })[updater.state.phase]
  return <>
    <div className="application-actions">
      <button className="toolbar-button" title="GitHub 代码仓库" aria-label="GitHub 代码仓库" disabled={pending} onClick={() => void perform(() => openRepository(info?.repository || undefined))}><span aria-hidden="true" className="github-mark" style={{ maskImage: `url("${githubMark}")`, WebkitMaskImage: `url("${githubMark}")` }} /></button>
      {preferences.showUpdateButton && <button className={`toolbar-button ${updateAvailable ? 'has-update' : ''}`} title="检查更新" aria-label="检查更新" onClick={() => setOpen(true)}>
        {updateBusy ? <LoaderCircle size={15} className="spinning" /> : <ArrowDownToLine size={15} />}
        {updateAvailable && <span className="update-dot" />}
      </button>}
      <button className="toolbar-button mobile-settings" title="应用设置与更新" aria-label="应用设置与更新" onClick={() => setOpen(true)}><Settings2 size={15} /></button>
      {native && <div className="window-controls">
        <button aria-label="最小化" title="最小化" onClick={() => void perform(() => getCurrentWindow().minimize())}><Minus size={16} /></button>
        <button aria-label={maximized ? '还原窗口' : '最大化'} title={maximized ? '还原窗口' : '最大化'} onClick={() => void perform(() => getCurrentWindow().toggleMaximize())}>{maximized ? <Copy size={13} /> : <Maximize2 size={14} />}</button>
        <button aria-label="关闭窗口" title={preferences.closeToTray ? '收起到托盘' : '退出 SoundSpectra'} className="window-close" disabled={pending || updater.state.phase === 'installing'} onClick={() => void close()}><X size={17} /></button>
      </div>}
    </div>
    {updateAvailable && dismissed !== updater.state.version && !open && <div className="update-notification" role="status">
      <span>发现新版本 {updater.state.version}</span>
      <button onClick={() => setOpen(true)}>查看更新</button>
      <button onClick={() => setDismissed(updater.state.version ?? null)}>稍后提醒</button>
    </div>}
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal><Dialog.Overlay className="application-dialog-backdrop" /><Dialog.Content className="application-dialog">
        <div className="application-dialog-heading"><div><Dialog.Title>应用设置与更新</Dialog.Title><Dialog.Description>SoundSpectra · {info?.version ?? '正在读取版本'}{info?.development ? ' · 开发版' : ''}</Dialog.Description></div><Dialog.Close className="toolbar-button" aria-label="收起应用设置"><X size={18} /></Dialog.Close></div>
        <div className="application-dialog-body">
          <section className="application-section" aria-label="软件更新">
            <h2>软件更新</h2><p role="status">{updateMessage}</p>
            {updater.state.notes && <details className="release-notes" open><summary>更新内容</summary><pre>{updater.state.notes}</pre></details>}
            {updater.state.phase === 'downloading' && <div className="download-progress"><progress aria-label="更新下载进度" max={updater.state.total || undefined} value={updater.state.total ? Math.min(updater.state.received, updater.state.total) : undefined} /><span>{(updater.state.received / 1024 / 1024).toFixed(1)} MB{updater.state.total ? ` / ${(updater.state.total / 1024 / 1024).toFixed(1)} MB` : ''}</span></div>}
            {updater.state.error && <p className="application-error" role="alert">{updater.state.error}</p>}
            <div className="application-button-row">
              {updater.state.phase === 'available' ? <Button disabled={pending} onClick={() => void updater.download()}><ArrowDownToLine size={14} />{updater.state.error ? '重试下载' : '下载更新'}</Button>
                : updater.state.phase === 'ready' ? <Button disabled={pending} onClick={() => void updater.install()}>安装并重启</Button>
                : <Button disabled={!native || !loaded || !info?.updaterConfigured || updateBusy || pending} onClick={() => void updater.checkNow()}>{updateBusy ? <LoaderCircle className="spinning" size={14} /> : <Check size={14} />}检查更新</Button>}
              <Button variant="outline" disabled={!info?.repository || pending} onClick={() => void perform(() => openHistory(info!.repository))}><ExternalLink size={14} />历史版本</Button>
            </div>
            <Preference label="自动检查更新" description="启动后及运行期间从 GitHub 检查新版本。" checked={preferences.autoCheckUpdates} disabled={!loaded || pending} onChange={value => void change({ autoCheckUpdates: value })} />
            <Preference label="自动下载安装更新" description="发现新版本后自动下载、验证签名、备份配置并重启安装。" checked={preferences.autoInstallUpdates} disabled={!loaded || pending || !info?.updaterConfigured || !preferences.autoCheckUpdates} onChange={value => void change({ autoInstallUpdates: value })} />
          </section>
          <section className="application-section" aria-label="窗口与启动"><h2>窗口与启动</h2>
            <Preference label="关闭时收起到托盘" description="关闭设置窗口后，桌面频谱继续运行。" checked={preferences.closeToTray} disabled={!loaded || pending} onChange={value => void change({ closeToTray: value })} />
            <Preference label="顶栏显示更新按钮" description="隐藏后仍可从此面板检查更新。" checked={preferences.showUpdateButton} disabled={!loaded || pending} onChange={value => void change({ showUpdateButton: value })} />
            <Preference label="开机启动" description={info?.development || !native ? '请在正式安装版中设置开机启动。' : '登录 Windows 后在托盘中运行。'} checked={starting} disabled={!native || !autostartKnown || !info || info.development || pending} onChange={value => void perform(async () => { await (value ? autostart.enable() : autostart.disable()); setStarting(await autostart.isEnabled()) })} />
          </section>
          <section className="application-section"><h2>维护</h2><p>备份颜色、位置等配置；诊断信息不包含音频内容。</p><div className="application-button-row">
            <Button variant="outline" disabled={!native || pending || updateBusy} onClick={() => void perform(async () => { await beforeClose(); setNotice(`配置已备份到：${await backupConfiguration()}`) })}>备份配置</Button>
            <Button variant="outline" disabled={!native || pending} onClick={() => void perform(async () => setNotice(`诊断信息已导出：${await exportDiagnostics()}`))}>导出诊断</Button>
          </div></section>
          <section className="application-section" aria-label="软件版权"><h2>SoundSpectra</h2><p>© 2026 {packageInfo.author}</p><p>{packageInfo.license} · 第三方许可随安装包附带。</p></section>
          {error && <div className="application-error" role="alert"><p>{error}</p>{!loaded && <Button variant="outline" size="sm" disabled={pending} onClick={() => void perform(async () => { setInfo(await applicationInfo()); setPreferences(await loadPreferences()); setLoaded(true) })}>重新读取应用设置</Button>}</div>}
          {notice && <p className="application-notice" role="status">{notice}</p>}
        </div>
        <div className="application-dialog-footer"><span>设置自动保存</span>{native && <Button variant="ghost" disabled={pending || updater.state.phase === 'installing'} onClick={() => void perform(async () => { await beforeClose(); await invoke('quit_application') })}>退出 SoundSpectra</Button>}<Dialog.Close asChild><Button variant="outline">完成</Button></Dialog.Close></div>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </>
}

function Preference({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <div className="application-preference"><div><span>{label}</span><p>{description}</p></div><Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} /></div>
}
