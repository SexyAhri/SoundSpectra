import { expect, test, type Page } from '@playwright/test'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

const pageErrors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
})
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]) })

async function mount(page: Page, failures: number, error = '托盘尚未就绪，请稍后重试', hold = false) {
  await page.route('**/shortcut-probe', route => route.fulfill({ contentType: 'text/html', body: visualProbeHtml('<body></body>') }))
  await page.goto('/shortcut-probe')
  await page.evaluate(async ({ failures, error, hold }) => {
    const app = window as any
    app.isTauri = true
    app.__calls = []; app.__reports = []
    app.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
    app.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (command: string, args: any) => {
        if (command === 'plugin:event|listen') return 1
        if (command === 'plugin:event|unlisten') return
        if (command !== 'sync_scene_shortcuts') throw Error(`Unexpected IPC: ${command}`)
        app.__calls.push(args.entries)
        if (hold) { hold = false; await new Promise<void>(resolve => { app.__release = resolve }) }
        if (failures-- > 0) throw error
      },
    }
    const path = '/tests/fixtures/scene-shortcuts-probe.tsx'
    const probe = await import(path)
    app.__saveShortcut = probe.saveShortcut
    app.__unmount = probe.mountShortcutsProbe((message: string) => app.__reports.push(message))
  }, { failures, error, hold })
  await expect.poll(() => page.evaluate(() => (window as any).__calls.length)).toBe(1)
}

test('tray readiness retries quietly and synchronizes the latest saved favorites', async ({ page }) => {
  await mount(page, 2)
  await page.evaluate(() => (window as any).__saveShortcut('最新收藏'))
  await expect.poll(() => page.evaluate(() => (window as any).__calls.length)).toBe(3)
  expect(await page.evaluate(() => (window as any).__calls.at(-1))).toEqual([{ id: 'favorite', name: '最新收藏' }])
  expect(await page.evaluate(() => (window as any).__reports)).toEqual([])
})

test('favorite updates wait for the in-flight sync and coalesce to the latest version', async ({ page }) => {
  await mount(page, 0, '', true)
  await page.evaluate(() => { const app = window as any; app.__saveShortcut('旧收藏'); app.__saveShortcut('新收藏') })
  expect(await page.evaluate(() => (window as any).__calls.length)).toBe(1)
  await page.evaluate(() => (window as any).__release())
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toEqual([[], [{ id: 'favorite', name: '新收藏' }]])
})

test('unmount cancels pending tray readiness retries', async ({ page }) => {
  await page.clock.install()
  await mount(page, 10)
  await page.evaluate(() => (window as any).__unmount())
  await page.clock.runFor(10000)
  expect(await page.evaluate(() => (window as any).__calls.length)).toBe(1)
  expect(await page.evaluate(() => (window as any).__reports)).toEqual([])
})

test('persistent tray unavailability stops retrying and reports the failure', async ({ page }) => {
  await page.clock.install()
  await mount(page, 10)
  await page.clock.runFor(10000)
  expect(await page.evaluate(() => (window as any).__calls.length)).toBe(6)
  expect(await page.evaluate(() => (window as any).__reports)).toEqual(['托盘收藏更新失败：托盘尚未就绪，请稍后重试'])
})

test('other tray failures are reported immediately', async ({ page }) => {
  await mount(page, 1, '场景快捷入口无效')
  await expect.poll(() => page.evaluate(() => (window as any).__reports)).toEqual(['托盘收藏更新失败：场景快捷入口无效'])
  expect(await page.evaluate(() => (window as any).__calls.length)).toBe(1)
})
