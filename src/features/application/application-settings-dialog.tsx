import { ModalContent } from '@/components/ui/modal'
import { IconButton } from '@/components/ui/icon-button'
import { Dialog } from 'radix-ui'
import { ArrowDownToLine, AudioLines, Check, ExternalLink, FileDown, FolderArchive, LoaderCircle, Settings2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingToggle } from '@/components/ui/setting-toggle'
import { ThemePicker } from '../theme/theme-picker'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { native } from '../spectrum/bridge'
import type { ApplicationInfo, Preferences } from './client'
import type { useUpdater } from './use-updater'
import packageInfo from '../../../package.json'

interface Props {
  open: boolean; onOpenChange: (open: boolean) => void
  tab: string; onTabChange: (tab: string) => void
  info: ApplicationInfo | null; preferences: Preferences
  loaded: boolean; pending: boolean; starting: boolean; autostartKnown: boolean
  error: string | null; notice: string | null
  updater: ReturnType<typeof useUpdater>
  onPreference: (patch: Partial<Preferences>) => void
  onAutostart: (value: boolean) => void
  onBackup: () => void; onDiagnostics: () => void; onRetry: () => void
  onHistory: () => void; onRepository: () => void; onQuit: () => void
}

export function ApplicationSettingsDialog({ open, onOpenChange, tab, onTabChange, info, preferences, loaded, pending, starting, autostartKnown, error, notice, updater, onPreference, onAutostart, onBackup, onDiagnostics, onRetry, onHistory, onRepository, onQuit }: Props) {
  const { state } = updater
  const updateBusy = ['checking', 'downloading', 'installing'].includes(state.phase)
  const updateAvailable = ['available', 'ready'].includes(state.phase)
  const updateMessage = !native ? '浏览器中可预览界面，更新需要在桌面客户端进行。'
    : !info ? '正在读取更新信息…'
    : !info.updaterConfigured ? '此构建尚未启用在线更新，可前往历史版本页面下载安装包。'
    : ({ idle: preferences.autoCheckUpdates ? '将自动检查新版本，也可以手动检查。' : '自动检查已关闭，你可以手动检查新版本。', checking: '正在检查新版本…', current: '你正在使用最新版本。', available: `发现新版本 ${state.version}`, downloading: '正在下载更新，收起此面板后会继续。', ready: '下载完成，签名验证已通过。安装前会备份配置。', installing: '正在准备安装，更新后将重新打开客户端。', error: '检查失败，请稍后重试。' })[state.phase]
  const updateTitle = ({ idle: '检查新版本', checking: '正在检查', current: '已是最新版本', available: `新版本 ${state.version}`, downloading: '正在下载更新', ready: '更新已准备好', installing: '正在安装更新', error: '暂时无法检查更新' })[state.phase]
  const backgroundUpdate = tab !== 'updates' && (updateBusy || updateAvailable || state.error)
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <ModalContent className="application-dialog">
      <header className="application-dialog-heading">
        <span className="application-settings-icon" aria-hidden="true"><Settings2 size={19} /></span>
        <div className="application-heading-copy"><Dialog.Title>应用设置与更新</Dialog.Title><Dialog.Description>SoundSpectra · {info?.version ?? '正在读取版本'}{info?.development ? ' · 开发版' : ''}</Dialog.Description></div>
        <Dialog.Close asChild><IconButton aria-label="收起应用设置"><X size={18} /></IconButton></Dialog.Close>
      </header>
      <Tabs value={tab} onValueChange={onTabChange} className="application-settings-tabs">
        <TabsList className="application-settings-nav" aria-label="应用设置分类">
          <TabsTrigger value="general">常规</TabsTrigger>
          <TabsTrigger value="updates">更新{(updateAvailable || state.error) && <span className="application-tab-dot" aria-hidden="true" />}</TabsTrigger>
          <TabsTrigger value="about">关于</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="application-dialog-body">
          <section className="application-section" aria-label="外观"><h2>界面主题</h2><ThemePicker /></section>
          <section className="application-section" aria-label="窗口与启动"><h2>窗口与启动</h2>
            <SettingToggle label="开机启动" description={info?.development || !native ? '请在正式安装版中设置开机启动。' : '登录 Windows 后在托盘中运行。'} checked={starting} disabled={!native || !autostartKnown || !info || info.development || pending} onChange={onAutostart} />
            <SettingToggle label="关闭时收起到托盘" description="关闭设置窗口后，桌面挂件继续运行。" checked={preferences.closeToTray} disabled={!loaded || pending} onChange={closeToTray => onPreference({ closeToTray })} />
          </section>
          <section className="application-section" aria-label="配置与诊断"><h2>配置与诊断</h2>
            <div className="application-maintenance-row"><FolderArchive size={18} aria-hidden="true" /><div><h3>备份配置</h3><p>保存当前配置，方便日后恢复。</p></div><Button variant="outline" size="sm" disabled={!native || pending || updateBusy} onClick={onBackup}>备份配置</Button></div>
            <div className="application-maintenance-row"><FileDown size={18} aria-hidden="true" /><div><h3>导出诊断</h3><p>排查运行问题，不包含音频内容。</p></div><Button variant="outline" size="sm" disabled={!native || pending} onClick={onDiagnostics}>导出诊断</Button></div>
          </section>
        </TabsContent>
        <TabsContent value="updates" className="application-dialog-body">
          <section className="application-section application-update-section" aria-label="软件更新">
            <div className="application-update-summary"><div className="application-update-copy"><span className="application-version-label">当前版本 {info?.version ?? '读取中'}</span><h2>{updateTitle}</h2><p role="status">{updateMessage}</p></div>
              {state.phase === 'available' ? <Button disabled={pending} onClick={() => void updater.download()}><ArrowDownToLine size={14} />{state.error ? '重试下载' : '下载更新'}</Button>
                : state.phase === 'ready' ? <Button disabled={pending} onClick={() => void updater.install()}>安装并重启</Button>
                : <Button disabled={!native || !loaded || !info?.updaterConfigured || updateBusy || pending} onClick={() => void updater.checkNow()}>{updateBusy ? <LoaderCircle className="spinning" size={14} /> : <ArrowDownToLine size={14} />}{state.phase === 'downloading' ? '正在下载' : state.phase === 'installing' ? '正在安装' : state.phase === 'checking' ? '正在检查' : '检查更新'}</Button>}
            </div>
            {state.phase === 'downloading' && <div className="download-progress"><progress aria-label="更新下载进度" max={state.total || undefined} value={state.total ? Math.min(state.received, state.total) : undefined} /><span>{(state.received / 1024 / 1024).toFixed(1)} MB{state.total ? ` / ${(state.total / 1024 / 1024).toFixed(1)} MB` : ''}</span></div>}
            {state.error && <p className="application-error" role="alert">{state.error}</p>}
            <button className="application-text-link" disabled={!info?.repository || pending} onClick={onHistory}>查看历史版本<ExternalLink size={12} /></button>
            {state.notes && <details className="release-notes" open><summary>更新内容</summary><pre>{state.notes}</pre></details>}
          </section>
          <section className="application-section" aria-label="更新偏好"><h2>更新偏好</h2>
            <SettingToggle label="自动检查更新" description="启动后及运行期间检查新版本。" checked={preferences.autoCheckUpdates} disabled={!loaded || pending} onChange={autoCheckUpdates => onPreference({ autoCheckUpdates })} />
            <SettingToggle label="自动下载安装更新" description={preferences.autoCheckUpdates ? '发现新版本后自动下载、备份配置并重启安装。' : '开启自动检查后可用。'} checked={preferences.autoInstallUpdates} disabled={!loaded || pending || !info?.updaterConfigured || !preferences.autoCheckUpdates} onChange={autoInstallUpdates => onPreference({ autoInstallUpdates })} />
            <SettingToggle label="顶栏显示更新按钮" description="隐藏后仍可从设置中检查更新。" checked={preferences.showUpdateButton} disabled={!loaded || pending} onChange={showUpdateButton => onPreference({ showUpdateButton })} />
          </section>
        </TabsContent>
        <TabsContent value="about" className="application-dialog-body">
          <section className="application-section application-about" aria-label="软件版权">
            <span className="application-about-icon" aria-hidden="true"><AudioLines size={30} /></span>
            <h2>SoundSpectra</h2><p>桌面音乐可视化与动态歌词</p>
            <span className="application-about-version">版本 {info?.version ?? '读取中'}{info?.development ? ' · 开发版' : ''}</span>
            <div className="application-about-license"><p>© 2026 {packageInfo.author}</p><p>{packageInfo.license} · 第三方许可随安装包附带。</p></div>
            <Button variant="outline" disabled={!info?.repository || pending} onClick={onRepository}><ExternalLink size={14} />GitHub 代码仓库</Button>
          </section>
        </TabsContent>
      </Tabs>
      {(error || notice) && <div className="application-dialog-feedback">
        {error && <div className="application-error" role="alert"><p>{error}</p>{!loaded && <Button variant="outline" size="sm" disabled={pending} onClick={onRetry}>重新读取应用设置</Button>}</div>}
        {notice && <p className="application-notice" role="status">{notice}</p>}
      </div>}
      <footer className="application-dialog-footer">
        <div className="application-footer-status"><span role="status">{pending ? <><LoaderCircle size={12} className="spinning" />正在处理…</> : !loaded ? '设置未加载' : <><Check size={12} />设置自动保存</>}</span>{backgroundUpdate && <button className="application-text-link" onClick={() => onTabChange('updates')}>{updateBusy && <LoaderCircle size={11} className="spinning" />}{state.error ? '更新遇到问题' : updateTitle}<span aria-hidden="true"> →</span></button>}</div>
        {native && <Button variant="ghost" size="sm" disabled={pending || state.phase === 'installing'} onClick={onQuit}>退出应用</Button>}
        <Dialog.Close asChild><Button variant="outline" size="sm">完成</Button></Dialog.Close>
      </footer>
    </ModalContent>
  </Dialog.Root>
}

