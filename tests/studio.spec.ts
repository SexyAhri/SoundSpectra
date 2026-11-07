import { chooseStyle } from './helpers/module-settings'
import { settingsSection } from './helpers/module-settings'
import { test, expect, type Page } from '@playwright/test'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'
import { displayBounds } from '../src/features/spectrum/regions'
import { musicEffects } from '../src/features/spectrum/music-engine/catalog'

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))

test('studio uses the real effect catalog and persists choices through illustrated controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '桌面预览', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '更换灯效', exact: true }).click()
  await expect(page.locator('.module-style-option')).toHaveCount(musicEffects.length)
  await expect(page.locator('.module-style-option .effect-art')).toHaveCount(musicEffects.length)
  await page.keyboard.press('Escape')
  await chooseStyle(page, '灯效', '雪花飘舞')
  await expect.poll(async () => (await saved(page)).effect).toBe('ripple')
  await expect(page.getByRole('group', { name: '当前灯效', exact: true })).toContainText('雪花飘舞')
  await page.reload()
  await expect(page.getByRole('group', { name: '当前灯效', exact: true })).toContainText('雪花飘舞')
  await page.screenshot({ path: 'artifacts/studio-desktop.png' })
  await settingsSection(page, '外观')
  await expect(page.getByRole('slider', { name: '不透明度', exact: true })).toBeVisible()
  await settingsSection(page, '动效')
  await page.getByText('造型细节', { exact: true }).click()
  await expect(page.getByRole('slider', { name: '雪片大小', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('music card supports persistent style, scale and keyboard placement without moving effects', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '音乐卡片', exact: true }).click()
  await page.getByRole('switch', { name: '显示桌面音乐卡片' }).click()
  const card = page.getByTestId('music-card-layer')
  await expect(card.getByRole('article', { name: '桌面音乐信息卡' })).toBeVisible()
  await expect(card.getByText('音乐信息预览', { exact: true })).toBeVisible()
  await chooseStyle(page, '卡片样式', '简约')
  await expect(card.locator('.music-card')).toHaveClass(/music-card-compact/)
  await page.getByRole('button', { name: '琥珀色卡片' }).click()
  await expect.poll(async () => (await saved(page)).desktopCard.accentColor).toBe('#efb273')
  expect((await saved(page)).color).toBe(defaults.color)
  const original = (await saved(page)).bounds
  await page.getByRole('button', { name: '布置', exact: true }).click()
  await page.getByRole('group', { name: '音乐卡片位置，方向键移动', exact: true }).focus()
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('ArrowUp')
  await expect.poll(async () => (await saved(page)).desktopCard.bounds.x).toBeCloseTo(.055, 4)
  await expect.poll(async () => (await saved(page)).desktopCard.bounds.y).toBeCloseTo(.808, 4)
  expect((await saved(page)).bounds).toEqual(original)
  await page.getByRole('button', { name: '完成布置', exact: true }).click()
  await page.reload()
  await expect(card.locator('.music-card')).toHaveClass(/music-card-compact/)
  await page.getByRole('button', { name: '音乐卡片', exact: true }).click()
  await page.getByRole('slider', { name: '卡片大小', exact: true }).focus()
  await page.keyboard.press('End')
  await expect.poll(async () => (await saved(page)).desktopCard.bounds.width).toBe(.45)
  const config = (await saved(page)).desktopCard
  expect(config.bounds.height).toBeLessThanOrEqual(.24)
  expect(config.bounds.y + config.bounds.height).toBeLessThanOrEqual(1)
  await page.screenshot({ path: 'artifacts/studio-card-controls.png' })
})

test('card participates in host geometry, remains independent from region style and rejects malformed bounds', () => {
  const settings = structuredClone(defaults)
  settings.regionVisible = false
  settings.desktopCard.enabled = true
  expect(displayBounds(settings)).toEqual(settings.desktopCard.bounds)
  settings.regionVisible = true
  const union = displayBounds(settings), card = settings.desktopCard.bounds
  expect(union.x).toBeLessThanOrEqual(card.x)
  expect(union.y + union.height).toBeGreaterThanOrEqual(card.y + card.height)
  const normalized = normalizeSettings({ desktopCard: { enabled: 'yes', variant: 'bad', bounds: { x: -3, y: 40, width: Infinity, height: -1 } } }).desktopCard
  expect(normalized.enabled).toBe(false); expect(normalized.variant).toBe('record')
  expect(normalized.bounds.x).toBe(0); expect(normalized.bounds.height).toBe(.08)
  expect(normalized.bounds.y).toBeCloseTo(.92)
  expect(normalizeSettings({}).desktopCard.enabled).toBe(false)
})

test('studio controls fit short and narrow windows and retain keyboard access', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 620 })
  await page.goto('/')
  await page.getByRole('button', { name: '音乐卡片', exact: true }).click()
  await page.getByText('精确位置', { exact: true }).click()
  await page.getByRole('button', { name: '恢复卡片位置', exact: true }).scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const footer = await page.getByRole('contentinfo', { name: '播放与桌面控制' }).boundingBox()
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(620)
  await page.screenshot({ path: 'artifacts/studio-short.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.getByRole('button', { name: '音乐卡片', exact: true }).click()
  await page.getByRole('switch', { name: '显示桌面音乐卡片' }).scrollIntoViewIfNeeded()
  await page.getByRole('switch', { name: '显示桌面音乐卡片' }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('switch', { name: '显示桌面音乐卡片' })).toHaveAttribute('aria-checked', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'artifacts/studio-mobile.png', fullPage: true })
})

test('native media card renders supplied metadata and clears a previous song when unavailable', async ({ page }) => {
  await page.addInitScript(settings => {
    const app = window as any
    app.isTauri = true
    app.__metadataMissing = false
    app.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'settings' }, currentWebview: { label: 'settings' } }, transformCallback: () => 1, unregisterCallback() {},
      invoke: async (command: string) => {
        switch (command) {
          case 'get_settings': return settings
          case 'get_now_playing': return { title: app.__metadataMissing ? '' : '测试歌曲', artist: app.__metadataMissing ? '' : '测试歌手', album: '', cover: null, position: 72, duration: 240, playing: true, source: 'QQ 音乐', processId: 10, updated: Date.now(), issue: null }
          case 'get_status': return { state: 'listening', sourceName: 'QQ 音乐', processId: 10, editing: false, desktopAttached: true }
          case 'get_audio_sources': return { selection: { mode: 'auto' }, error: null, catalog: [], discovery: { targets: [], warning: null } }
          case 'get_desktop_background': return { screen: { x: 0, y: 0, width: 1920, height: 1080 }, virtualScreen: { x: 0, y: 0, width: 1920, height: 1080 }, position: 'fill', color: '#25232c', image: null, revision: 'solid', issue: null }
          case 'application_info': return { version: '0.1.0', repository: '', updaterConfigured: false, development: true }
          case 'get_preferences': return { closeToTray: true, autoCheckUpdates: false, showUpdateButton: true }
          case 'plugin:event|listen': return 1
          case 'plugin:autostart|is_enabled': case 'plugin:window|is_maximized': return false
          case 'plugin:event|unlisten': case 'plugin:event|emit': return
          default: throw new Error(`Unexpected fixture IPC: ${command}`)
        }
      },
    }
  }, { ...defaults, desktopCard: { ...defaults.desktopCard, enabled: true } })
  await page.goto('/')
  const card = page.getByTestId('music-card-layer')
  await expect(card.getByText('测试歌曲', { exact: true })).toBeVisible()
  await expect(card.getByText('测试歌手', { exact: true })).toBeVisible()
  await expect(card.getByRole('progressbar', { name: '歌曲播放进度' })).toHaveAttribute('aria-valuenow', '72')
  await page.evaluate(() => { (window as any).__metadataMissing = true })
  await expect(card.getByText('测试歌曲', { exact: true })).toHaveCount(0)
  await expect(card.getByText('播放器未提供歌曲信息')).toBeVisible()
  await expect(card.getByText('QQ 音乐', { exact: true })).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(card.locator('.vinyl-disc')).toHaveCSS('animation-name', 'none')
})
