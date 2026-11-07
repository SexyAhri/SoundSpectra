import { settingsSection } from './helpers/module-settings'
import { test, expect, type Page } from '@playwright/test'
import { suggestPalette, luminance } from '../src/features/preview/wallpaper-palette'
import { defaults } from '../src/features/spectrum/model'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => {
    if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings))
  }, { ...defaults, effect: 'dream_stars', sceneMode: 'immersive', color: '#55aac4', glow: 65, bounds: { x: .19, y: .38, width: .62, height: .44 } })
})

test('suggestions remain distinct and visible on light, dark and monochrome backgrounds', () => {
  for (const color of [[245, 245, 245], [10, 10, 10], [37, 74, 98], [231, 201, 162]]) {
    const pixels = new Uint8ClampedArray(Array.from({ length: 100 }, () => [...color, 255]).flat())
    const palette = suggestPalette(pixels)
    expect(palette.length).toBeGreaterThan(0)
    expect(new Set(palette.map(c => c.value)).size).toBe(palette.length)
    const background = luminance(color.map(n => n / 255) as [number, number, number])
    for (const suggestion of palette) {
      expect(suggestion.value).toMatch(/^#[0-9a-f]{6}$/)
      const value = luminance(suggestion.value.slice(1).match(/../g)!.map(n => parseInt(n, 16) / 255) as [number, number, number])
      expect((Math.max(value, background) + .05) / (Math.min(value, background) + .05)).toBeGreaterThan(2.5)
    }
  }
  expect(suggestPalette(new Uint8ClampedArray(100))).toEqual([])
})

test('palette samples the displayed crop, letterbox background and spanning offset', async ({ page }) => {
  await page.goto('/')
  const colors = await page.evaluate(async () => {
    const samplerPath = '/src/features/preview/wallpaper-palette.ts', geometryPath = '/src/features/preview/background.ts'
    const { sampleWallpaper } = await import(samplerPath), { wallpaperPlacement } = await import(geometryPath)
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 100
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 300, 100)
    ctx.fillStyle = '#204080'; ctx.fillRect(100, 0, 100, 100)
    const image = { url: canvas.toDataURL(), width: 300, height: 100 }
    const screen = { x: 0, y: 0, width: 100, height: 100 }
    const desktop = { screen, virtualScreen: { x: 0, y: 0, width: 300, height: 100 }, color: '#ffffff', position: 'fill' }
    const sample = (position: string, target = screen) => sampleWallpaper(image, wallpaperPlacement(image, { ...desktop, position }, target), target, desktop.color)
    return { fill: await sample('fill'), fit: await sample('fit'), right: await sample('span', { ...screen, x: 200 }), tile: await sample('tile') }
  })
  const light = (hex: string) => luminance(hex.slice(1).match(/../g)!.map(n => parseInt(n, 16) / 255) as [number, number, number])
  expect(colors.fill[0].label).toBe('呼应')
  expect(light(colors.fill[0].value)).toBeGreaterThan(light(colors.fit[0].value))
  expect(colors.right).toEqual([{ label: '明暗', value: '#202637' }])
  expect(colors.tile).toEqual(colors.right)
})

async function reference(page: Page, color = '#3a7f6b', accent = '#d7a077') {
  const data = await page.evaluate(({ color, accent }) => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600
    const context = canvas.getContext('2d')!
    context.fillStyle = color; context.fillRect(0, 0, 800, 600)
    context.fillStyle = accent; context.fillRect(360, 0, 440, 600)
    return canvas.toDataURL().split(',')[1]
  }, { color, accent })
  await page.getByLabel('参考图片文件').setInputFiles({ name: 'palette.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })
  await expect(page.getByTestId('preview-wallpaper')).toHaveCSS('background-image', /data:image/)
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))

test('layout presets apply only geometry, persist, and reflect custom positions', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  const before = await saved(page)
  await page.getByRole('button', { name: '布置', exact: true }).click()
  await page.getByRole('button', { name: '应用右侧布局' }).click()
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  const right = await saved(page)
  expect(right.bounds).toEqual({ x: .58, y: .24, width: .38, height: .6 })
  expect({ ...right, bounds: before.bounds }).toEqual(before)
  await page.getByRole('button', { name: '完成布置', exact: true }).click()
  await settingsSection(page, '位置')
  await expect(page.getByRole('button', { name: '应用右侧布局' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByText('精确位置', { exact: true }).click()
  await page.getByRole('slider', { name: '距左侧', exact: true }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('button', { name: '应用右侧布局' })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: '应用天空布局' }).click()
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.reload()
  expect((await saved(page)).bounds).toEqual({ x: 0, y: 0, width: 1, height: .6 })
  expect((await saved(page)).color).toBe(before.color)
})

test('layout controls fit narrow, short and expanded previews', async ({ page }) => {
  await page.goto('/')
  await reference(page)
  for (const viewport of [{ width: 1280, height: 620 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.getByRole('button', { name: '布置', exact: true }).click()
    const group = page.getByRole('group', { name: '布局预设' })
    await expect(group.getByRole('button', { name: '应用居中布局' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `artifacts/arrangement-${viewport.width}.png`, fullPage: true })
    await page.getByRole('button', { name: '放大预览' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: '应用左侧布局' }).click()
    const dialogRect = (await dialog.boundingBox())!
    for (const item of [dialog.locator('.desktop-preview'), dialog.getByRole('group', { name: '布局预设' }), dialog.getByRole('button', { name: '关闭放大预览' })]) {
      const rect = (await item.boundingBox())!
      expect(rect.y).toBeGreaterThanOrEqual(dialogRect.y)
      expect(rect.y + rect.height).toBeLessThanOrEqual(dialogRect.y + dialogRect.height)
    }
    await page.screenshot({ path: `artifacts/arrangement-expanded-${viewport.width}.png` })
    await page.getByRole('button', { name: '关闭放大预览' }).click()
    await page.getByRole('button', { name: '完成布置', exact: true }).click()
  }
})
