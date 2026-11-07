import { chooseStyle } from './helpers/module-settings'
import { expect, test, type Page } from '@playwright/test'
import { defaults, defaultWallpaperDepth, normalizeSettings } from '../src/features/spectrum/model'
import { displayBounds } from '../src/features/spectrum/regions'
import { wallpaperPlacement } from '../src/features/preview/background'
import { customWallpaperBackground } from '../src/features/wallpaper-depth/wallpaper-layout'

test('wallpaper migration preserves old parallax choices and bounds malformed settings', () => {
  expect(normalizeSettings({ wallpaperDepth: { enabled: true, revision: 'abc' } }).wallpaperDepth.source).toBe('custom')
  expect(normalizeSettings({ wallpaperDepth: { enabled: false, revision: 'abc' } }).wallpaperDepth.source).toBe('system')
  const settings = normalizeSettings({ wallpaperDepth: { source: 'custom', enabled: false, revision: 'abc', brightness: -10, saturation: Infinity, focusX: 900, ambientBounds: { x: 4, y: -1, width: .5, height: .3 }, ambientColor: 'red' } })
  expect(settings.wallpaperDepth).toMatchObject({ source: 'custom', enabled: false, brightness: 30, saturation: 100, focusX: 100, ambientColor: defaultWallpaperDepth.ambientColor, ambientBounds: { x: .5, y: 0, width: .5, height: .3 } })
  expect(displayBounds(settings)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  expect(displayBounds({ ...defaults, wallpaperDepth: { ...defaultWallpaperDepth, ambientEnabled: true } })).toEqual({ x: 0, y: 0, width: 1, height: 1 })
})

test('portrait, landscape and square images preserve aspect ratio and focal position', () => {
  const screen = { x: 0, y: 0, width: 1600, height: 900 }
  for (const image of [{ width: 900, height: 1600 }, { width: 2400, height: 900 }, { width: 1000, height: 1000 }]) {
    for (const fit of ['cover', 'contain'] as const) {
      const background = customWallpaperBackground({ ...defaultWallpaperDepth, fit, focusX: 100, focusY: 0 }, screen)
      const rect = wallpaperPlacement({ ...image, url: '' }, background, screen)
      expect(rect.width / rect.height).toBeCloseTo(image.width / image.height)
      expect(rect.x).toBeCloseTo(screen.width - rect.width)
      expect(rect.y).toBe(0)
      if (fit === 'contain') { expect(rect.width).toBeLessThanOrEqual(screen.width); expect(rect.height).toBeLessThanOrEqual(screen.height) }
      else { expect(rect.width).toBeGreaterThanOrEqual(screen.width); expect(rect.height).toBeGreaterThanOrEqual(screen.height) }
    }
  }
})

test('default parallax visibly shifts image detail without exposing the canvas edges', async ({ page }) => {
  await page.goto('/#wallpaper'); await importWallpaper(page, true)
  await page.getByText('空间视差 · 可选增强', { exact: true }).click()
  await page.getByRole('switch', { name: '立体壁纸', exact: true }).click()
  const depth = page.getByTestId('depth-wallpaper'), canvas = depth.locator('canvas')
  await expect(depth).toHaveAttribute('data-ready', 'true')
  const box = (await page.locator('.desktop-preview').boundingBox())!
  const sample = (compare = false) => canvas.evaluate((node: HTMLCanvasElement, compare) => new Promise<{ changed: number, clear: number }>(resolve => {
    // Read after the requested draw, in the same frame, before the drawing buffer clears.
    node.dispatchEvent(new Event('depth-settings'))
    requestAnimationFrame(() => {
      const gl = node.getContext('webgl2')!, pixels = new Uint8Array(node.width * node.height * 4)
      gl.readPixels(0, 0, node.width, node.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      const store = node as HTMLCanvasElement & { previousFrame?: Uint8Array }
      if (!compare) { store.previousFrame = pixels; resolve({ changed: 0, clear: 0 }); return }
      const left = store.previousFrame!
      let changed = 0, clear = 0
      for (let i = 0; i < left.length; i += 4) {
        if (Math.abs(left[i] - pixels[i]) + Math.abs(left[i + 1] - pixels[i + 1]) + Math.abs(left[i + 2] - pixels[i + 2]) > 8) changed++
        if (left[i + 3] !== 255 || pixels[i + 3] !== 255) clear++
      }
      resolve({ changed: changed / (left.length / 4), clear })
    })
  }), compare)
  await page.mouse.move(box.x + box.width * .02, box.y + box.height * .8)
  await expect.poll(async () => Number((await canvas.getAttribute('data-camera'))?.split(',')[0])).toBeLessThan(-.94)
  await sample()
  await page.mouse.move(box.x + box.width * .98, box.y + box.height * .8)
  await expect.poll(async () => Number((await canvas.getAttribute('data-camera'))?.split(',')[0])).toBeGreaterThan(.94)
  const result = await sample(true)
  expect(result.changed).toBeGreaterThan(.008)
  expect(result.clear).toBe(0)
})

async function importWallpaper(page: Page, landscape = false) {
  const data = await page.evaluate(landscape => {
    const canvas = document.createElement('canvas'); canvas.width = landscape ? 1280 : 720; canvas.height = landscape ? 720 : 1200
    const ctx = canvas.getContext('2d')!, gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
    gradient.addColorStop(0, '#346e80'); gradient.addColorStop(.5, '#b4c1b2'); gradient.addColorStop(1, '#cdb391')
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#243d45'; ctx.fillRect(280, 290, 160, 700)
    if (landscape) for (let x = 40; x < canvas.width; x += 80) ctx.fillRect(x, 480, 12, 240)
    return canvas.toDataURL().split(',')[1]
  }, landscape)
  await page.getByLabel('壁纸图片文件', { exact: true }).setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))

test('static wallpaper, full image, adjustments and local area persist independently of parallax', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#wallpaper'); await importWallpaper(page)
  await expect(page.getByTestId('preview-wallpaper')).toHaveCSS('background-image', /data:image/)
  await expect(page.getByTestId('depth-wallpaper')).toHaveCount(0)
  await page.getByRole('combobox', { name: '图片适配' }).click(); await page.getByRole('option', { name: '完整显示', exact: true }).click()
  await page.getByRole('slider', { name: '壁纸亮度', exact: true }).focus(); await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('preview-wallpaper')).toHaveCSS('filter', 'brightness(0.99) saturate(1)')
  await page.getByRole('switch', { name: '局部音乐微光', exact: true }).click()
  await page.getByRole('button', { name: '右侧留白', exact: true }).click()
  const area = page.getByRole('group', { name: '微光区域，方向键移动', exact: true })
  const areaBox = (await area.boundingBox())!
  await page.mouse.move(areaBox.x + areaBox.width / 2, areaBox.y + areaBox.height / 2)
  await page.mouse.down(); await page.mouse.move(areaBox.x + areaBox.width / 2 - 20, areaBox.y + areaBox.height / 2 + 5, { steps: 4 }); await page.mouse.up()
  await expect.poll(async () => (await saved(page)).wallpaperDepth.ambientBounds.x).toBeLessThan(.58)
  await page.getByRole('button', { name: '右侧留白', exact: true }).click()
  await area.focus(); await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await saved(page)).wallpaperDepth.ambientBounds.x).toBeCloseTo(.578)
  await page.getByRole('button', { name: '缩放微光区域', exact: true }).focus(); await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('已保存到此浏览器', { exact: true })).toBeVisible()
  const before = (await saved(page)).wallpaperDepth
  await page.reload()
  await expect(page.getByTestId('preview-wallpaper')).toHaveCSS('filter', 'brightness(0.99) saturate(1)')
  expect((await saved(page)).wallpaperDepth).toEqual(before)
  await chooseStyle(page, '壁纸来源', '跟随系统')
  await expect(page.getByTestId('wallpaper-surface')).toHaveAttribute('data-source', 'system')
  await chooseStyle(page, '壁纸来源', '自选图片')
  await expect(page.getByTestId('preview-wallpaper')).toHaveCSS('background-image', /data:image/)
  expect((await saved(page)).wallpaperDepth.revision).toBe(before.revision)
  await page.screenshot({ path: 'artifacts/wallpaper-scene-portrait.png', fullPage: true })
  expect(errors).toEqual([])
})

test('wallpaper controls fit narrow and short viewports', async ({ page }) => {
  await page.goto('/#wallpaper'); await importWallpaper(page)
  await page.getByRole('switch', { name: '局部音乐微光', exact: true }).click()
  for (const viewport of [{ width: 1000, height: 620 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.getByRole('button', { name: '右侧留白', exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: '右侧留白', exact: true })).toBeVisible()
    await page.screenshot({ path: `artifacts/wallpaper-controls-${viewport.width}.png`, fullPage: true })
  }
})

test('local light responds to audio, respects masks and stops after silence or inactivity', async ({ page }) => {
  await page.goto('/tests/fixtures/wallpaper-ambience.html')
  const canvas = page.getByTestId('wallpaper-ambience')
  await page.getByRole('button', { name: 'Audio', exact: true }).click()
  await expect.poll(async () => Number(await canvas.getAttribute('data-energy'))).toBeGreaterThan(.02)
  await page.getByRole('button', { name: 'Mask', exact: true }).click()
  await page.getByRole('button', { name: 'Audio', exact: true }).click()
  await expect.poll(async () => Number(await canvas.getAttribute('data-energy'))).toBeGreaterThan(.02)
  const alpha = await canvas.evaluate((node: HTMLCanvasElement) => {
    const ctx = node.getContext('2d')!, pixels = ctx.getImageData(0, 0, node.width, node.height).data
    let inside = 0, outside = 0
    for (let y = 0; y < node.height; y++) for (let x = 0; x < node.width; x++) {
      const value = pixels[(y * node.width + x) * 4 + 3]
      if (x / node.width > .43 && x / node.width < .57 && y / node.height > .15 && y / node.height < .75) inside += value
      else outside += value
    }
    return { inside, outside }
  })
  expect(alpha.inside).toBe(0); expect(alpha.outside).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(async () => Number(await canvas.getAttribute('data-energy')), { timeout: 8000 }).toBeLessThan(.001)
  await page.getByRole('button', { name: 'Active', exact: true }).click()
  expect(await canvas.evaluate((node: HTMLCanvasElement) => node.getContext('2d')!.getImageData(0, 0, node.width, node.height).data.every(value => value === 0))).toBe(true)
})

test('default light is visible during quiet music and fully clears on pause', async ({ page }) => {
  await page.goto('/tests/fixtures/wallpaper-ambience.html?strength=30&rms=.02')
  const canvas = page.getByTestId('wallpaper-ambience')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(async () => Number(await canvas.getAttribute('data-energy'))).toBeGreaterThan(.12)
  const coverage = await canvas.evaluate((node: HTMLCanvasElement) => {
    const pixels = node.getContext('2d')!.getImageData(0, 0, node.width, node.height).data
    let visible = 0, peak = 0
    for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] >= 8) visible++; peak = Math.max(peak, pixels[i]) }
    return { visible: visible / (node.width * node.height), peak }
  })
  expect(coverage.visible).toBeGreaterThan(.1)
  expect(coverage.peak).toBeGreaterThan(20)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(async () => Number(await canvas.getAttribute('data-energy')), { timeout: 8000 }).toBeLessThan(.001)
})

test('reduced motion keeps the parallax camera still and holds local particle motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#wallpaper'); await importWallpaper(page)
  await page.getByText('空间视差 · 可选增强', { exact: true }).click()
  await page.getByRole('switch', { name: '立体壁纸', exact: true }).click()
  const depth = page.getByTestId('depth-wallpaper')
  await expect(depth).toHaveAttribute('data-ready', 'true')
  const box = (await page.locator('.desktop-preview').boundingBox())!
  await page.mouse.move(box.x + box.width * .9, box.y + box.height * .8)
  await expect(depth.locator('canvas')).toHaveAttribute('data-camera', '0.0000,0.0000')
  await page.goto('/tests/fixtures/wallpaper-ambience.html')
  await page.getByRole('button', { name: 'Audio', exact: true }).click()
  await expect(page.getByTestId('wallpaper-ambience')).toHaveAttribute('data-motion', 'reduced')
})
