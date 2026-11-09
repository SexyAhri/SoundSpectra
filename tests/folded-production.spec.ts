import { setDemo } from './helpers/demo'
import { chooseStyle } from './helpers/module-settings'
import { expect, test } from '@playwright/test'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'

test('fourth lyric mode is selectable and persists in the actual settings panel', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  expect(normalizeSettings({ lyrics: { ...defaults.lyrics, motion: 'folded' } }).lyrics.motion).toBe('folded')
  await page.goto('/'); await setDemo(page)
  await page.getByRole('button', { name: '歌词', exact: true }).click()
  await page.getByRole('switch', { name: '显示桌面歌词', exact: true }).click()
  await chooseStyle(page, '歌词编排', '折幕字场')
  await expect(page.locator('.folded-lyrics canvas')).toHaveAttribute('data-composition', 'folded')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!).lyrics.motion)).toBe('folded')
  await page.reload(); await setDemo(page)
  await page.getByRole('button', { name: '歌词', exact: true }).click()
  await expect(page.getByRole('group', { name: '当前歌词编排', exact: true })).toContainText('折幕字场')
  await expect(page.locator('.folded-lyrics canvas')).toBeVisible()
  await page.screenshot({ path: 'artifacts/folded-curtain/production-menu.png' })
  await page.getByRole('switch', { name: '模拟预览', exact: true }).click()
  await expect(page.locator('.folded-lyrics')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('production renderer reconstructs seeks, idles paused and bounds resources across songs', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/tests/fixtures/folded-lyrics.html')
  const canvas = page.locator('canvas')
  const set = (patch: object) => page.evaluate(patch => (window as any).foldedProbe.set(patch), patch)
  await expect(canvas).toHaveAttribute('data-time', '2600')
  await expect(canvas).toHaveAttribute('data-stage', 'true')
  await expect(canvas).toHaveAttribute('data-echoes', '0')
  const original = await canvas.screenshot()
  const frames = await canvas.getAttribute('data-frames')
  await page.waitForTimeout(250)
  expect(await canvas.getAttribute('data-frames')).toBe(frames)
  await set({ time: 18200 }); await expect(canvas).toHaveAttribute('data-time', '18200')
  await set({ time: 2600 }); await expect(canvas).toHaveAttribute('data-time', '2600')
  expect((await canvas.screenshot()).equals(original), 'seeking back must reproduce the same image').toBe(true)
  const lines = Array.from({ length: 500 }, (_, i) => ({ text: `${i} 微光 stays with you 等风经过这片很长很长的夜色`, start: i * 4000, end: i * 4000 + 3800, words: [] }))
  await set({ lines, time: 1200200 }); await expect(canvas).toHaveAttribute('data-line', '300')
  await expect(canvas).toHaveAttribute('data-resources', '3')
  await set({ lines: [{ text: '另一首歌', start: 0, end: 5000, words: [] }], time: 2200 })
  await expect(canvas).toHaveAttribute('data-resources', '1')
  await expect(canvas).toHaveAttribute('data-visible', '0')
  await set({ time: 6000 }); await expect(canvas).toHaveAttribute('data-visible', '')
  await expect(canvas).toHaveAttribute('data-stage', 'false')
  await set({ time: 2200, readability: 'contrast', reduced: true })
  await expect(canvas).toHaveAttribute('data-stage', 'false')
  await expect(canvas).toHaveAttribute('data-echoes', '0')
  await page.setViewportSize({ width: 430, height: 800 })
  await page.screenshot({ path: 'artifacts/folded-curtain/production-narrow.png' })
  await set({ playing: true })
  await expect.poll(() => canvas.getAttribute('data-time')).not.toBe('2200')
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.waitForTimeout(100)
  const hiddenFrames = await canvas.getAttribute('data-frames')
  await page.waitForTimeout(200); expect(await canvas.getAttribute('data-frames')).toBe(hiddenFrames)
  await set({ desktop: true, time: 2400 })
  await expect.poll(() => canvas.getAttribute('data-frames')).not.toBe(hiddenFrames)
  expect(errors).toEqual([])
})

test('desktop lyric layer uses supplied media position and offset and hides unavailable transport', async ({ page }) => {
  await page.goto('/tests/fixtures/folded-lyrics.html')
  const set = (patch: object) => page.evaluate(patch => (window as any).foldedProbe.set(patch), patch)
  await set({ layer: true, time: 6200, offsetMs: 500 })
  const canvas = page.locator('.folded-lyrics canvas')
  await expect(canvas).toHaveAttribute('data-time', '6700')
  await expect(page.getByLabel('当前歌词')).toContainText('你听见')
  await set({ time: 2600, offsetMs: -500 })
  await expect(canvas).toHaveAttribute('data-time', '2100')
  await expect(page.getByLabel('当前歌词')).toContainText('风把晚霞')
  await set({ available: false })
  await expect(page.getByTestId('lyric-layer')).toHaveCount(0)
})

test('compact region retains readable type, visible hinges and clean contiguous handoff', async ({ page }) => {
  await page.goto('/tests/fixtures/folded-lyrics.html')
  await page.evaluate(() => { document.body.querySelector('div')!.style.cssText = 'position:absolute;left:10%;top:85%;width:86%;height:10%' })
  const set = (patch: object) => page.evaluate(patch => (window as any).foldedProbe.set(patch), patch)
  const canvas = page.locator('canvas')
  const poses = () => canvas.getAttribute('data-poses').then(value => JSON.parse(value!) as number[][])
  await set({ fontSize: 18, regionWidth: .86, time: 2600 })
  await expect(canvas).toHaveAttribute('data-size', '1101x84')
  expect((await poses()).filter(p => p[0] === 0).every(p => p[1] === 1 && Math.abs(p[6]) < .25)).toBe(true)
  const reading = await canvas.screenshot()
  await set({ time: 4700 }); await expect(canvas).toHaveAttribute('data-time', '4700')
  const entering = (await poses()).filter(p => p[0] === 1)
  expect(entering.some(p => Math.abs(p[6]) > .6)).toBe(true)
  // Concertina hinges preserve horizontal/depth joins while the flip staggers panels vertically.
  for (let i = 1; i < entering.length; i++) {
    const previous = entering[i - 1], next = entering[i], width = 2 * (previous[2] - previous[3])
    expect(next[3]).toBeCloseTo(previous[3] + Math.cos(previous[6]) * width, 5)
    expect(Math.abs(next[4] - previous[4])).toBeLessThan(.45)
    expect(next[5]).toBeCloseTo(previous[5] - Math.sin(previous[6]) * width, 5)
  }
  expect((await canvas.screenshot()).equals(reading), 'the held line must transition away').toBe(false)
  await set({ lines: [{ text: '第一句', start: 0, end: 4000, words: [] }, { text: '第二句', start: 4000, end: 8000, words: [] }], time: 4000 })
  await expect(canvas).toHaveAttribute('data-visible', '1')
  await set({ reduced: true, time: 4500 }); await expect(canvas).toHaveAttribute('data-time', '4500')
  expect((await poses()).every(p => p[6] === 0)).toBe(true)
  await expect(canvas).toHaveAttribute('data-stage', 'false')
  await expect(canvas).toHaveAttribute('data-echoes', '0')
})

test('folded controls reach the renderer, move the layer and persist from the real panel', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-08T00:00:00Z'))
  await page.addInitScript(settings => localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings)), {
    ...defaults, regionVisible: false,
    lyrics: { ...defaults.lyrics, enabled: true, motion: 'folded', fontSize: 18, backgroundOpacity: 0, bounds: { x: .1, y: .85, width: .86, height: .1 } },
  })
  await page.goto('/')
  await page.getByRole('button', { name: '歌词', exact: true }).click()
  await setDemo(page)
  const canvas = page.locator('.folded-lyrics canvas'), layer = page.getByTestId('lyric-layer')
  await expect(canvas).toHaveAttribute('data-font-size', '18')
  const styles = page.getByRole('group', { name: '当前歌词编排', exact: true })
  expect((await styles.boundingBox())!.height).toBeLessThan(140)
  await styles.screenshot({ path: 'artifacts/folded-curtain/production-style-compact.png' })
  await page.getByRole('slider', { name: '歌词字号', exact: true }).press('End')
  await expect(canvas).toHaveAttribute('data-font-size', '72')
  await page.getByRole('switch', { name: '浅色壁纸增强', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-readability', 'contrast')
  await page.getByRole('slider', { name: '歌词背景', exact: true }).press('End')
  await expect(canvas).toHaveAttribute('data-background-opacity', '100')
  await page.getByRole('slider', { name: '歌词背景', exact: true }).press('Home')
  await expect(canvas).toHaveAttribute('data-background-opacity', '0')
  await page.getByText('位置与高级设置', { exact: true }).click()
  await page.getByRole('slider', { name: '歌词距左侧', exact: true }).press('Home')
  await expect.poll(() => layer.evaluate(node => node.style.left)).toBe('0%')
  await page.getByRole('slider', { name: '歌词距顶部', exact: true }).press('Home')
  await expect.poll(() => layer.evaluate(node => node.style.top)).toBe('0%')
  await page.getByRole('slider', { name: '歌词区域宽度', exact: true }).press('Home')
  await expect.poll(() => layer.evaluate(node => node.style.width)).toBe('25%')
  await page.getByRole('slider', { name: '歌词同步偏移', exact: true }).press('End')
  await expect(canvas).toHaveAttribute('data-time', '10000')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!).lyrics)).toMatchObject({
    fontSize: 72, backgroundOpacity: 0, readability: 'contrast', offsetMs: 10000, bounds: { x: 0, y: 0, width: .25, height: .1 },
  })
})

test('compact font range changes actual pixels and wallpaper controls work while paused', async ({ page }) => {
  await page.goto('/tests/fixtures/folded-lyrics.html')
  await page.evaluate(() => { document.body.querySelector('div')!.style.cssText = 'position:absolute;left:10%;top:85%;width:86%;height:10%' })
  const set = (patch: object) => page.evaluate(patch => (window as any).foldedProbe.set(patch), patch)
  const renderer = page.locator('.folded-lyrics'), canvas = renderer.locator('canvas')
  const pixels = async () => {
    const png = (await renderer.screenshot()).toString('base64')
    return page.evaluate(async png => {
      const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode()
      const buffer = document.createElement('canvas'); buffer.width = image.width; buffer.height = image.height
      const context = buffer.getContext('2d')!; context.drawImage(image, 0, 0)
      const data = context.getImageData(0, 0, buffer.width, buffer.height).data
      let left = buffer.width, right = -1, dark = 0
      for (let y = 0; y < buffer.height; y++) for (let x = 0; x < buffer.width; x++) {
        const index = (y * buffer.width + x) * 4, light = Math.max(data[index], data[index + 1], data[index + 2])
        if (light > 170) { left = Math.min(left, x); right = Math.max(right, x) }
        if (light < 90) dark++
      }
      return { width: right - left + 1, dark, center: [...context.getImageData(Math.floor(buffer.width / 2), Math.floor(buffer.height / 2), 1, 1).data], corner: [...data.slice(0, 4)] }
    }, png)
  }
  await set({ lines: [{ text: '心声都不可细诉', start: 0, end: 10000, words: [] }], reduced: true, time: 2600, regionWidth: .86 })
  const widths: number[] = []
  for (const fontSize of [18, 36, 54, 72]) {
    await set({ fontSize }); await expect(canvas).toHaveAttribute('data-font-size', String(fontSize))
    // Changing the lyric text loads Unicode font shards and remounts the scene.
    // Wait for painted glyphs before measuring; a matching attribute can precede
    // that font-loading gap and an empty WebGL screenshot has a negative width.
    let width = 0
    await expect.poll(async () => (width = (await pixels()).width)).toBeGreaterThan(0)
    widths.push(width)
  }
  expect(widths[3] / widths[0]).toBeGreaterThan(1.4)
  for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1] * 1.08)
  await page.evaluate(() => { document.body.style.background = '#fff' })
  await set({ fontSize: 18, readability: 'soft' }); await expect(canvas).toHaveAttribute('data-font-size', '18')
  const soft = await pixels()
  await set({ readability: 'contrast' }); await expect(canvas).toHaveAttribute('data-readability', 'contrast')
  expect((await pixels()).dark).toBeGreaterThan(soft.dark + 100)
  await renderer.screenshot({ path: 'artifacts/folded-curtain/production-wallpaper-contrast.png' })
  await set({ lines: [], readability: 'contrast', backgroundOpacity: 0, time: 0 }); await expect(canvas).toHaveAttribute('data-time', '0')
  expect((await pixels()).center.slice(0, 3)).toEqual([255, 255, 255])
  await set({ backgroundOpacity: 100 }); await expect(canvas).toHaveAttribute('data-background-opacity', '100')
  const shaded = await pixels()
  expect(Math.max(...shaded.center.slice(0, 3))).toBeLessThan(60)
  expect(shaded.corner.slice(0, 3)).toEqual([255, 255, 255])
})
