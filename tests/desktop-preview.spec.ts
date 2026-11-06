import { test, expect, type Page } from '@playwright/test'
import { wallpaperStyle, type DesktopBackground } from '../src/features/preview/background'
import { moveBounds, resizeBounds } from '../src/features/preview/preview-geometry'

test('wallpaper layouts preserve native dimensions, cropping and spanning offsets', () => {
  const screen = { x: 0, y: 0, width: 2560, height: 1440 }
  const background: DesktopBackground = { screen, virtualScreen: { x: -1920, y: 0, width: 4480, height: 1440 }, position: 'fill', color: '#123456', image: null, revision: '', issue: null }
  const image = { url: 'data:image/png;base64,test', width: 1000, height: 1000 }
  const style = (position: DesktopBackground['position']) => wallpaperStyle(image, { ...background, position }, screen, 640)
  expect(style('fill').backgroundSize).toBe('640px 640px')
  expect(style('fill').backgroundPosition).toBe('0px -140px')
  expect(style('fit').backgroundSize).toBe('360px 360px')
  expect(style('fit').backgroundPosition).toBe('140px 0px')
  expect(style('stretch').backgroundSize).toBe('640px 360px')
  expect(style('center').backgroundSize).toBe('250px 250px')
  expect(style('tile').backgroundRepeat).toBe('repeat')
  expect(style('span').backgroundSize).toBe('1120px 1120px')
  expect(style('span').backgroundPosition).toBe('-480px -380px')
})

test('preview movement stays inside the screen and resizing keeps its center', () => {
  const start = { x: .12, y: .7, width: .76, height: .22 }
  expect(moveBounds(start, -2, 2)).toEqual({ ...start, x: 0, y: .78 })
  const maximum = resizeBounds(start, 2, 2)
  expect(maximum.width).toBe(1)
  expect(maximum.x).toBe(0)
  const smaller = resizeBounds(maximum, -.2, -.04)
  expect(smaller.x + smaller.width / 2).toBeCloseTo(.5)
  expect(smaller.y + smaller.height / 2).toBeCloseTo(.81)
})

async function mockDesktop(page: Page) {
  await page.addInitScript(() => {
    const app = window as any
    app.isTauri = true
    app.__wallpaperFailure = true
    app.__wallpaperCalls = []
    app.__wallpaperRevision = 'wallpaper-1'
    app.__settings = { version: 1, enabled: false, effect: 'orbit', quality: 'balanced', color: '#205aee', opacity: 85, sensitivity: 100, decay: 65, reflection: 32, glow: 35, bounds: { x: .12, y: .7, width: .76, height: .22 } }
    app.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'settings' }, currentWebview: { label: 'settings' } },
      transformCallback: () => 1, unregisterCallback() {},
      invoke: async (command: string, args: any = {}) => {
        switch (command) {
          case 'get_settings': return app.__settings
          case 'update_settings': app.__settings = args.settings; return args.settings
          case 'get_status': return { state: 'waiting', message: '', processId: null, editing: false, desktopAttached: false }
          case 'get_audio_sources': return { selection: { mode: 'auto' }, error: null, catalog: [], discovery: { targets: [], warning: null } }
          case 'application_info': return { version: '0.1.0', repository: 'SexyAhri/SoundSpectra', updaterConfigured: false, development: true }
          case 'get_preferences': return { closeToTray: true, autoCheckUpdates: false, showUpdateButton: true }
          case 'plugin:autostart|is_enabled': case 'plugin:window|is_maximized': return false
          case 'plugin:window|is_visible': return true
          case 'plugin:event|listen': return 1
          case 'plugin:event|unlisten': case 'sync_scene_shortcuts': return
          case 'get_desktop_background': {
            app.__wallpaperCalls.push(args.knownRevision)
            const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 1000
            const context = canvas.getContext('2d')!
            context.fillStyle = app.__wallpaperRevision === 'wallpaper-1' ? '#355b57' : '#aabbee'; context.fillRect(0, 0, 1000, 1000)
            context.fillStyle = '#debd88'; context.fillRect(250, 0, 100, 1000)
            return { screen: { x: 0, y: 0, width: 2560, height: 1440 }, virtualScreen: { x: 0, y: 0, width: 2560, height: 1440 }, position: 'fit', color: '#0c1824', image: app.__wallpaperFailure || args.knownRevision === app.__wallpaperRevision ? null : canvas.toDataURL(), revision: app.__wallpaperFailure ? '' : app.__wallpaperRevision, issue: app.__wallpaperFailure ? '壁纸文件无法读取，请刷新重试' : null }
          }
          default: throw new Error(`Unexpected IPC: ${command}`)
        }
      },
    }
  })
}

test('native wallpaper failure is recoverable and unchanged refresh retains the decoded image', async ({ page }) => {
  await mockDesktop(page)
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('壁纸文件无法读取')
  await expect(page.getByText('主屏幕 · 2560 × 1440')).toBeVisible()
  await page.evaluate(() => { (window as any).__wallpaperFailure = false })
  await page.getByRole('button', { name: '刷新桌面壁纸' }).click()
  const wallpaper = page.getByTestId('preview-wallpaper')
  await expect(wallpaper).toHaveCSS('background-image', /data:image\/webp/)
  const previous = await wallpaper.evaluate(el => getComputedStyle(el).backgroundImage)
  await page.getByRole('button', { name: '刷新桌面壁纸' }).click()
  await expect(page.getByRole('button', { name: '刷新桌面壁纸' })).toBeEnabled()
  expect(await wallpaper.evaluate(el => getComputedStyle(el).backgroundImage)).toBe(previous)
  expect(await page.evaluate(() => (window as any).__wallpaperCalls.at(-1))).toBe('wallpaper-1')
  await page.getByRole('switch', { name: '模拟预览' }).click()
  await page.screenshot({ path: 'artifacts/wallpaper-preview-desktop.png' })
  await page.getByRole('button', { name: '纯色预览背景' }).click()
  await expect(wallpaper).toHaveCSS('background-image', 'none')
  await page.getByRole('button', { name: '桌面壁纸', exact: true }).click()
  await expect(wallpaper).toHaveCSS('background-image', /data:image\/webp/)
})

test('wallpaper changes refresh on return and while the preview stays open', async ({ page }) => {
  await mockDesktop(page)
  await page.goto('/')
  await page.evaluate(() => { (window as any).__wallpaperFailure = false })
  await page.getByRole('button', { name: '刷新桌面壁纸' }).click()
  const wallpaper = page.getByTestId('preview-wallpaper')
  await expect(wallpaper).toHaveCSS('background-image', /data:image\/webp/)
  const initial = await wallpaper.evaluate(el => getComputedStyle(el).backgroundImage)
  await page.waitForTimeout(1100)
  await page.evaluate(() => { (window as any).__wallpaperRevision = 'wallpaper-2'; window.dispatchEvent(new Event('focus')) })
  await expect.poll(() => wallpaper.evaluate(el => getComputedStyle(el).backgroundImage)).not.toBe(initial)
  await page.evaluate(() => { (window as any).__wallpaperRevision = 'wallpaper-1' })
  await expect.poll(() => wallpaper.evaluate(el => getComputedStyle(el).backgroundImage), { timeout: 7000 }).toBe(initial)
})

test('drag, centered resize and keyboard changes persist while pointer cancellation discards the draft', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.getByRole('button', { name: '布置', exact: true }).click()
  const area = page.locator('.desktop-preview'), effect = page.locator('.preview-spectrum')
  const rect = (await area.boundingBox())!, box = (await effect.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + rect.width * .06, box.y + box.height / 2 - rect.height * .12, { steps: 5 }); await page.mouse.up()
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!).bounds)
  const moved = await stored()
  expect(moved.x).toBeCloseTo(.18, 2); expect(moved.y).toBeCloseTo(.58, 2)
  const handle = (await page.getByRole('button', { name: '缩放动效' }).boundingBox())!
  await page.mouse.move(handle.x + 11, handle.y + 11); await page.mouse.down(); await page.mouse.move(handle.x + 11 - rect.width * .1, handle.y + 11 - rect.height * .02, { steps: 5 }); await page.mouse.up()
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  const resized = await stored()
  expect(resized.width).toBeCloseTo(.56, 2)
  expect(resized.x + resized.width / 2).toBeCloseTo(moved.x + moved.width / 2)
  await effect.focus(); await effect.press('ArrowLeft')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  const keyed = await stored(); expect(keyed.x).toBeCloseTo(resized.x - .002)
  const next = (await effect.boundingBox())!
  await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2); await page.mouse.down(); await page.mouse.move(next.x + next.width / 2 + 30, next.y + next.height / 2)
  await page.keyboard.press('Escape'); await page.mouse.up()
  expect(await stored()).toEqual(keyed)
  await page.reload()
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  expect(await effect.evaluate(el => Number.parseFloat((el as HTMLElement).style.left) / 100)).toBeCloseTo(keyed.x)
})

test('reference image import survives reload, invalid images leave the previous choice intact', async ({ page }) => {
  await page.goto('/')
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const ctx = c.getContext('2d')!; ctx.fillStyle = '#3a7f6b'; ctx.fillRect(0, 0, 800, 600); return c.toDataURL().split(',')[1] })
  const input = page.getByLabel('参考图片文件')
  await input.setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.getByRole('button', { name: '参考图片', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(page.getByTestId('preview-wallpaper')).toHaveCSS('background-image', /data:image\/webp/)
  await input.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') })
  await expect(page.getByRole('alert')).toContainText('无法解码')
  await expect(page.getByRole('button', { name: '参考图片', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('preview-wallpaper')).toHaveCSS('background-image', /data:image\/webp/)
})

test('desktop ratio and normalized effect bounds hold at short, narrow and expanded sizes', async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 620 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.goto('/')
    await expect(page.getByText('已保存到此浏览器')).toBeVisible()
    const check = async () => {
      const area = (await page.locator('.desktop-preview').boundingBox())!, effect = (await page.locator('.preview-spectrum').boundingBox())!
      expect(area.width / area.height).toBeCloseTo(16 / 9, 2)
      expect((effect.x - area.x) / area.width).toBeCloseTo(.12, 2)
      expect((effect.y - area.y) / area.height).toBeCloseTo(.7, 2)
      expect(effect.width / area.width).toBeCloseTo(.76, 2)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await check()
    await page.screenshot({ path: `artifacts/wallpaper-preview-${viewport.width}.png`, fullPage: true })
    await page.getByRole('button', { name: '放大预览' }).click()
    await expect(page.getByRole('dialog')).toBeVisible(); await check()
    await page.getByRole('dialog').getByRole('button', { name: '布置', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: '缩放动效' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '完成布置', exact: true }).click()
    await page.screenshot({ path: `artifacts/wallpaper-expanded-${viewport.width}.png` })
    await page.getByRole('button', { name: '关闭放大预览' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await check()
    await page.getByRole('button', { name: '放大预览' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
})
