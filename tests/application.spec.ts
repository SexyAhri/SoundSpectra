import { test, expect, type Page } from '@playwright/test'

test('application preferences persist and the browser honestly disables native updates', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '应用设置与更新', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('浏览器中可预览界面，更新需要在桌面客户端进行。')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '检查更新', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('region', { name: '软件版权' })).toContainText('© 2026 SexyAhri')
  await dialog.getByRole('switch', { name: '顶栏显示更新按钮' }).click()
  await expect(dialog.getByRole('switch', { name: '顶栏显示更新按钮' })).toHaveAttribute('aria-checked', 'false')
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await expect(page.getByRole('button', { name: '检查更新', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: '检查更新', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '应用设置与更新', exact: true }).click()
  await expect(dialog.getByRole('switch', { name: '顶栏显示更新按钮' })).toHaveAttribute('aria-checked', 'false')
  await page.screenshot({ path: 'artifacts/application-desktop.png' })
})

test('application dialog remains reachable on a small screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: '应用设置与更新', exact: true }).click()
  await page.getByRole('button', { name: '导出诊断', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: '完成', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'artifacts/application-mobile.png' })
})

// Only test IPC is mocked. Production hooks, SDK resources and visible controls run unchanged.
async function nativeFixture(page: Page, failure: 'check' | 'download' | 'backup' | 'none', automatic = false) {
  await page.addInitScript(({ failure, automatic }) => {
    const app = window as unknown as Record<string, any>
    app.isTauri = true
    app.__commands = []
    let checkCount = 0, downloadCount = 0, backupCount = 0
    let settings = { version: 1, enabled: false, color: '#d4c3ff', opacity: 85, sensitivity: 100, decay: 65, reflection: 32, glow: 35, bounds: { x: .12, y: .7, width: .76, height: .22 } }
    let preferences = { closeToTray: true, autoCheckUpdates: automatic, autoInstallUpdates: automatic, showUpdateButton: true }
    app.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'settings' }, currentWebview: { label: 'settings' } },
      transformCallback: () => 1,
      unregisterCallback() {},
      invoke: async (command: string, args: any = {}) => {
        app.__commands.push(command)
        switch (command) {
          case 'application_info': return { version: '0.1.0', repository: 'SexyAhri/SoundSpectra', updaterConfigured: true, development: false }
          case 'get_preferences': return preferences
          case 'save_preferences': preferences = args.preferences; return preferences
          case 'get_settings': return settings
          case 'get_desktop_background': return { screen: { x: 0, y: 0, width: 1920, height: 1080 }, virtualScreen: { x: 0, y: 0, width: 1920, height: 1080 }, position: 'fill', color: '#25232c', image: null, revision: 'solid', issue: null }
          case 'update_settings': settings = args.settings; return settings
          case 'get_status': return { state: 'silent', message: '测试音频', processId: 1, editing: false, desktopAttached: false }
          case 'get_audio_sources': return { selection: { mode: 'auto' }, error: null, catalog: [], discovery: { targets: [], warning: null } }
          case 'plugin:autostart|is_enabled': case 'plugin:window|is_maximized': return false
          case 'plugin:event|listen': return 1
          case 'plugin:event|unlisten': case 'plugin:resources|close': return
          case 'plugin:updater|check':
            if (failure === 'check' && checkCount++ === 0) throw new Error('测试网络不可用')
            return { rid: 7, currentVersion: '0.1.0', version: '0.2.0', body: '修复桌面恢复并保留配置。', rawJson: {} }
          case 'plugin:updater|download':
            args.onEvent.onmessage({ event: 'Started', data: { contentLength: 100 } })
            args.onEvent.onmessage({ event: 'Progress', data: { chunkLength: 40 } })
            await new Promise(resolve => setTimeout(resolve, 250))
            if (failure === 'download' && downloadCount++ === 0) throw new Error('测试签名校验失败')
            args.onEvent.onmessage({ event: 'Progress', data: { chunkLength: 60 } })
            args.onEvent.onmessage({ event: 'Finished' })
            return 8
          case 'backup_configuration':
            if (failure === 'backup' && backupCount++ === 0) throw new Error('测试备份磁盘写入失败')
            return 'test-backup'
          case 'plugin:updater|install':
            if (failure === 'none') return
            throw new Error('测试安装启动失败')
          case 'restart_after_update': return
          case 'plugin:opener|open_url': app.__openedUrl = args.url; return
          default: throw new Error(`未声明的测试 IPC: ${command}`)
        }
      },
    }
  }, { failure, automatic })
  await page.goto('/')
  await page.getByRole('button', { name: '应用设置与更新', exact: true }).click()
  if (!automatic) await page.getByRole('dialog').getByRole('button', { name: '检查更新', exact: true }).click()
}

test('GitHub toolbar mark opens the source repository directly in browser mode', async ({ page }) => {
  await page.addInitScript(() => { window.open = ((url: string, target: string, features: string) => { (window as any).__github = { url, target, features }; return null }) as typeof window.open })
  await page.goto('/')
  await page.getByRole('button', { name: 'GitHub 代码仓库', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__github)).toEqual({ url: 'https://github.com/SexyAhri/SoundSpectra', target: '_blank', features: 'noopener,noreferrer' })
})

test('automatic updates download, back up, install and restart in order without extra clicks', async ({ page }) => {
  await nativeFixture(page, 'none', true)
  await expect.poll(() => page.evaluate(() => (window as any).__commands.includes('restart_after_update')), { timeout: 15000 }).toBe(true)
  const commands = await page.evaluate(() => (window as any).__commands as string[])
  for (const [first, second] of [['plugin:updater|check', 'plugin:updater|download'], ['plugin:updater|download', 'backup_configuration'], ['backup_configuration', 'plugin:updater|install'], ['plugin:updater|install', 'restart_after_update']]) {
    expect(commands.indexOf(first)).toBeGreaterThanOrEqual(0)
    expect(commands.indexOf(first)).toBeLessThan(commands.indexOf(second))
  }
})

test('automatic installation stops when configuration backup fails', async ({ page }) => {
  await nativeFixture(page, 'backup', true)
  await expect(page.getByRole('alert')).toContainText('测试备份磁盘写入失败', { timeout: 15000 })
  const commands = await page.evaluate(() => (window as any).__commands as string[])
  expect(commands).toContain('plugin:updater|download')
  expect(commands).toContain('backup_configuration')
  expect(commands).not.toContain('plugin:updater|install')
  expect(commands).not.toContain('restart_after_update')
})

test('failed update checks can retry without installing anything', async ({ page }) => {
  await nativeFixture(page, 'check')
  await expect(page.getByRole('alert')).toContainText('测试网络不可用')
  await page.getByRole('dialog').getByRole('button', { name: '检查更新', exact: true }).click()
  await expect(page.getByRole('button', { name: '下载更新', exact: true })).toBeVisible()
  const commands = await page.evaluate(() => (window as any).__commands as string[])
  expect(commands.filter(c => c === 'plugin:updater|check')).toHaveLength(2)
  expect(commands).not.toContain('plugin:updater|install')
})

test('download errors cannot proceed to installation, retry preserves the update', async ({ page }) => {
  await nativeFixture(page, 'download')
  await page.getByRole('button', { name: '下载更新', exact: true }).click()
  await expect(page.getByRole('progressbar', { name: '更新下载进度' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('测试签名校验失败')
  await expect(page.getByRole('button', { name: '安装并重启' })).toHaveCount(0)
  await page.getByRole('button', { name: '重试下载' }).click()
  await expect(page.getByRole('button', { name: '安装并重启' })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__commands)).not.toContain('plugin:updater|install')
})

test('configuration backup failure blocks installation and install errors remain retryable', async ({ page }) => {
  await nativeFixture(page, 'backup')
  await page.getByRole('button', { name: '下载更新', exact: true }).click()
  await page.getByRole('button', { name: '安装并重启' }).click()
  await expect(page.getByRole('alert')).toContainText('测试备份磁盘写入失败')
  expect(await page.evaluate(() => (window as any).__commands)).not.toContain('plugin:updater|install')
  await page.getByRole('button', { name: '安装并重启' }).click()
  await expect(page.getByRole('alert')).toContainText('测试安装启动失败')
  const commands = await page.evaluate(() => (window as any).__commands as string[])
  expect(commands.lastIndexOf('backup_configuration')).toBeLessThan(commands.lastIndexOf('plugin:updater|install'))
  expect(commands.lastIndexOf('update_settings')).toBeLessThan(commands.lastIndexOf('backup_configuration'))
})
