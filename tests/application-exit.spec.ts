import { expect, test, type Page } from '@playwright/test'
import { defaults } from '../src/features/spectrum/model'
import { railDefaults } from '../src/features/rail/model'

// Mock only IPC; exercise the actual workspace, native action subscription,
// save queues and confirmation dialog without exiting the user's application.
async function setup(page: Page, closeToTray = true) {
  await page.addInitScript(({ settings, rail, closeToTray }) => {
    const app = window as any
    app.isTauri = true
    app.commands = []
    app.callbacks = {}
    app.listeners = {}
    let callbackId = 0
    let preferences = { closeToTray, autoCheckUpdates: false, autoInstallUpdates: false, showUpdateButton: true }
    app.sendAction = (payload: string) => {
      for (const handler of Object.values(app.listeners['application-action'] ?? {})) (handler as any)({ event: 'application-action', payload })
    }
    app.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'settings' }, currentWebview: { label: 'settings' } },
      transformCallback: (handler: any) => { app.callbacks[++callbackId] = handler; return callbackId },
      unregisterCallback: (id: number) => { delete app.callbacks[id] },
      invoke: async (command: string, args: any = {}) => {
        app.commands.push(command)
        switch (command) {
          case 'application_info': return { version: '1.0.2', updaterConfigured: false, development: true }
          case 'get_preferences': return preferences
          case 'save_preferences': preferences = args.preferences; return preferences
          case 'get_settings': return settings
          case 'update_settings':
            if (app.saveFailure) throw new Error('配置暂时无法写入')
            settings = args.settings; return settings
          case 'rail_get': return { settings: rail, missing: [], desktopError: null, supported: true }
          case 'get_status': return { state: 'waiting', message: '等待音乐', editing: false, desktopAttached: false }
          case 'get_audio_sources': return { selection: { mode: 'auto' }, catalog: [], discovery: { targets: [] } }
          case 'get_now_playing': return { title: '', artist: '', album: '', cover: null, position: 0, duration: 0, playing: false, source: '', processId: null, updated: 0, issue: null }
          case 'get_desktop_background': return { screen: { x: 0, y: 0, width: 1920, height: 1080 }, virtualScreen: { x: 0, y: 0, width: 1920, height: 1080 }, position: 'fill', color: '#25232c', image: null, revision: 'solid' }
          case 'plugin:autostart|is_enabled': case 'plugin:window|is_maximized': return false
          case 'plugin:event|listen':
            (app.listeners[args.event] ??= {})[args.handler] = app.callbacks[args.handler]
            return args.handler
          case 'plugin:event|unlisten': delete app.listeners[args.event]?.[args.eventId]; return
          case 'plugin:window|close': return
          case 'quit_application':
            if (app.holdQuit) await new Promise<void>(resolve => { app.finishQuit = resolve })
            if (app.quitFailure) throw new Error('桌面位置保存失败')
            return
          default: throw new Error(`未声明的测试 IPC: ${command}`)
        }
      },
    }
  }, { settings: defaults, rail: railDefaults, closeToTray })
  await page.goto('/')
  await page.getByRole('button', { name: '应用设置与更新', exact: true }).click()
  await expect(page.getByRole('switch', { name: '关闭时收起到托盘' })).toBeEnabled()
}

test('exit defaults to cancel, traps focus, and cancellation never saves or quits', async ({ page }) => {
  await setup(page)
  const exit = page.getByRole('dialog').getByRole('button', { name: '退出应用', exact: true })
  await exit.click()
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toContainText('退出后，桌面挂架、灯效、歌词和音乐卡片将停止运行')
  await expect(confirmation.getByRole('button', { name: '取消', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(confirmation.getByRole('button', { name: '退出应用', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(confirmation).toHaveCount(0)
  await expect(exit).toBeFocused()
  await exit.click()
  await page.keyboard.press('Escape')
  await expect(confirmation).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).commands)).not.toContain('quit_application')
  expect(await page.evaluate(() => (window as any).commands)).not.toContain('update_settings')
})

test('closing with tray disabled confirms, saves before exit, and retains failures for retry', async ({ page }) => {
  await setup(page, false)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
  const confirmation = page.getByRole('alertdialog')
  await page.evaluate(() => { (window as any).saveFailure = true })
  await confirmation.getByRole('button', { name: '退出应用', exact: true }).click()
  await expect(confirmation.getByRole('alert')).toContainText('配置暂时无法写入')
  expect(await page.evaluate(() => (window as any).commands)).not.toContain('quit_application')
  await page.evaluate(() => { (window as any).saveFailure = false; (window as any).quitFailure = true })
  await confirmation.getByRole('button', { name: '退出应用', exact: true }).click()
  await expect(confirmation.getByRole('alert')).toContainText('桌面位置保存失败')
  await page.evaluate(() => { (window as any).quitFailure = false })
  await confirmation.getByRole('button', { name: '退出应用', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  const commands = await page.evaluate(() => (window as any).commands as string[])
  expect(commands.lastIndexOf('update_settings')).toBeLessThan(commands.lastIndexOf('quit_application'))
  expect(commands).not.toContain('plugin:window|close')
})

test('tray actions navigate to the correct panel and repeated exit requests use one dialog', async ({ page }) => {
  await setup(page)
  for (const [action, tab] of [['settings', '常规'], ['updates', '更新'], ['about', '关于']]) {
    await page.evaluate(action => (window as any).sendAction(action), action)
    await expect(page.getByRole('dialog').getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true')
  }
  for (const action of ['rail', 'scene', 'lyrics', 'card', 'wallpaper']) {
    await page.evaluate(action => (window as any).sendAction(action), action)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#${action}`)
  }
  await page.evaluate(() => { (window as any).sendAction('quit'); (window as any).sendAction('quit') })
  await expect(page.getByRole('alertdialog')).toHaveCount(1)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.className = theme }, theme)
    await page.screenshot({ path: `artifacts/quit-confirmation-${theme}.png` })
  }
  await page.setViewportSize({ width: 390, height: 520 })
  await expect(page.getByRole('alertdialog').getByRole('button', { name: '取消' })).toBeInViewport()
  await expect(page.getByRole('alertdialog').getByRole('button', { name: '退出应用' })).toBeInViewport()
  await page.screenshot({ path: 'artifacts/quit-confirmation-mobile.png' })
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => (window as any).commands)).not.toContain('quit_application')
})

test('pending exit cannot double submit or dismiss, while ordinary close still goes to tray', async ({ page }) => {
  await setup(page)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).commands.includes('plugin:window|close'))).toBe(true)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await page.evaluate(() => { (window as any).holdQuit = true; (window as any).sendAction('quit') })
  const confirmation = page.getByRole('alertdialog')
  await confirmation.getByRole('button', { name: '退出应用', exact: true }).click()
  await expect(confirmation.getByRole('button', { name: '正在保存并退出…' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(confirmation).toBeVisible()
  await expect(confirmation.getByRole('button', { name: '取消' })).toBeDisabled()
  await expect.poll(() => page.evaluate(() => (window as any).commands.filter((command: string) => command === 'quit_application').length)).toBe(1)
  await page.evaluate(() => (window as any).finishQuit())
  await expect(confirmation).toHaveCount(0)
})
