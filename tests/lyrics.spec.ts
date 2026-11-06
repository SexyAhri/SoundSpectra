import { expect, test } from '@playwright/test'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'
import { emptyNowPlaying } from '../src/features/desktop-card/use-now-playing'
import { activeLine, demoLyrics, playbackPosition, wordProgress, lyricDisplayText } from '../src/features/lyrics/model'
import { timedGlyphs } from '../src/features/lyrics/kinetic-composition'
import { displayBounds } from '../src/features/spectrum/regions'

test('lyric clock respects pause, seek, stale sessions and word timing', () => {
  const info = { ...emptyNowPlaying, position: 10, duration: 100, updated: 1000, playing: true, timelineAvailable: true }
  expect(playbackPosition(info, 1500)).toBe(10500)
  expect(playbackPosition({ ...info, playing: false }, 1500)).toBe(10000)
  expect(playbackPosition({ ...info, position: 35, updated: 1500 }, 1500)).toBe(35000)
  expect(playbackPosition(info, 6000)).toBeNull()
  expect(playbackPosition({ ...info, timelineAvailable: false }, 1500)).toBeNull()
  expect(activeLine(demoLyrics, -1)).toBe(-1)
  expect(activeLine(demoLyrics, 5000)).toBe(1)
  expect(wordProgress({ text: '原创', start: 1000, end: 2000 }, 1500)).toBe(.5)
  expect(normalizeSettings({}).lyrics).toEqual(defaults.lyrics)
  const normalized = normalizeSettings({ lyrics: { enabled: true, fontSize: 999, offsetMs: -99999, bounds: { x: 1, y: 1, width: .5, height: .2 } } })
  expect(normalized.lyrics).toMatchObject({ fontSize: 72, offsetMs: -10000, bounds: { x: .5, y: .8 } })
  const host = displayBounds({ ...defaults, regionVisible: false, lyrics: { ...defaults.lyrics, enabled: true } })
  // Lyrics may move around desktop rails without resizing the native host.
  expect(host).toEqual({ x: 0, y: 0, width: 1, height: 1 })
})

test('lyrics preview animates independently, persists controls and never fabricates live lyrics', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '歌词', exact: true }).click()
  await page.getByRole('switch', { name: '显示桌面歌词', exact: true }).click()
  await expect(page.getByLabel('QQ 音乐歌词目录', { exact: true })).toHaveCount(0)
  const layer = page.getByTestId('lyric-layer')
  await expect(layer.getByText('模拟歌词')).toBeVisible()
  const sung = layer.locator('.kinetic-lyrics-canvas')
  await expect(sung).toBeVisible()
  const before = await sung.getAttribute('data-time')
  await expect.poll(() => sung.getAttribute('data-time')).not.toBe(before)
  await page.getByRole('button', { name: '错落排版', exact: true }).click()
  await page.getByRole('slider', { name: '歌词字号', exact: true }).focus(); await page.keyboard.press('End')
  await page.getByRole('slider', { name: '歌词背景', exact: true }).focus(); await page.keyboard.press('Home')
  await page.getByText('位置与同步', { exact: true }).click()
  await page.getByRole('slider', { name: '歌词同步偏移', exact: true }).focus(); await page.keyboard.press('ArrowRight')
  await expect(page.getByText('已保存到此浏览器', { exact: true })).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
  expect(saved.lyrics).toMatchObject({ enabled: true, motion: 'stage', fontSize: 72, offsetMs: 100, backgroundOpacity: 0 })
  expect(saved.desktopCard.enabled).toBe(false)
  expect(saved.effect).toBe(defaults.effect)
  await page.screenshot({ path: 'artifacts/lyrics-desktop.png' })
  await page.reload(); await page.getByRole('button', { name: '歌词', exact: true }).click()
  await expect(page.getByRole('switch', { name: '显示桌面歌词', exact: true })).toBeChecked()
  await expect(page.getByRole('slider', { name: '歌词背景', exact: true })).toHaveAttribute('aria-valuenow', '0')
  await page.getByRole('switch', { name: '模拟预览', exact: true }).click()
  await expect(layer.getByText('模拟歌词')).toHaveCount(0)
  await expect(layer.locator('.kinetic-lyrics-canvas')).toHaveCount(0)
  await expect(layer).toContainText('请在客户端中读取本地歌词')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('switch', { name: '显示桌面歌词', exact: true }).click()
  await expect(layer).toHaveCount(0)
})

test('phrase separators stay in the timeline while singer labels and semantic punctuation remain visible', () => {
  const text = '合：我会用爱，堵住你的泪眼婆娑。'
  const line = { text, start: 0, end: text.length * 100, words: [...text].map((text, index) => ({ text, start: index * 100, end: (index + 1) * 100 })) }
  const glyphs = timedGlyphs(line)
  expect(glyphs.filter(glyph => !glyph.hidden).map(glyph => glyph.text).join('')).toBe('合：我会用爱堵住你的泪眼婆娑')
  expect(glyphs.map(glyph => [glyph.start, glyph.end])).toEqual(line.words.map(word => [word.start, word.end]))
  expect(line.text).toBe(text)
  expect(lyricDisplayText('合：根本没看我')).toBe('合：根本没看我')
  expect(lyricDisplayText('男: Let’s go, don’t stop! 3.14 和 1,000')).toBe('男: Let’s go don’t stop 3.14 和 1,000')
})

test('zero lyric background is actually transparent and the background fades smoothly at its edges', async ({ page }) => {
  await page.goto('/tests/fixtures/kinetic-lyrics.html')
  const canvas = page.locator('canvas')
  await page.evaluate(() => (window as any).lyricProbe.set({ lines: [], time: 0, backgroundOpacity: 0 }))
  await expect(canvas).toHaveAttribute('data-background-opacity', '0')
  const alpha = () => canvas.evaluate((node: HTMLCanvasElement) => {
    const c = node.getContext('2d')!
    return { inside: c.getImageData(Math.floor(node.width / 2), Math.floor(node.height / 4), 1, 1).data[3], corner: c.getImageData(0, 0, 1, 1).data[3] }
  })
  expect((await alpha()).inside).toBe(0)
  await page.evaluate(() => (window as any).lyricProbe.set({ backgroundOpacity: 100 }))
  await expect(canvas).toHaveAttribute('data-background-opacity', '100')
  expect((await alpha()).inside).toBeGreaterThan(70)
  expect((await alpha()).corner).toBe(0)
})

test('three lyric designs have distinct composition and respect reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 })
  await page.addInitScript(settings => localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings)), {
    ...defaults, effect: 'dream_stars', sceneMode: 'immersive', opacity: 100, bounds: { x: 0, y: 0, width: 1, height: 1 },
    lyrics: { ...defaults.lyrics, enabled: true, fontSize: 72, bounds: { x: .06, y: .35, width: .88, height: .34 } },
  })
  await page.goto('/')
  await page.getByRole('button', { name: '歌词', exact: true }).click()
  const layer = page.getByTestId('lyric-layer')
  for (const [mode, name] of [['depth', '文字漫游'], ['stage', '错落排版'], ['stardust', '弧形流转']]) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect(layer).toHaveClass(new RegExp(`lyric-motion-${mode}`))
    await expect(layer.locator('.kinetic-lyrics-canvas')).toHaveAttribute('data-composition', mode)
    await expect(layer.getByLabel('当前歌词')).not.toBeEmpty()
    await page.locator('.desktop-preview').screenshot({ path: `artifacts/lyric-${mode}.png` })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: '文字漫游', exact: true }).click()
  await expect(layer.locator('.kinetic-lyrics-canvas')).toBeVisible()
})

test('composition pixels pause exactly, seek deterministically, and change between designs', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 600 })
  await page.goto('/tests/fixtures/kinetic-lyrics.html')
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-time', '2600')
  const pixels = () => canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL())
  const initial = await pixels()
  await page.waitForTimeout(250)
  expect(await pixels()).toBe(initial)
  const set = (patch: object) => page.evaluate(patch => (window as any).lyricProbe.set(patch), patch)
  await set({ time: 3700 }); await expect(canvas).toHaveAttribute('data-time', '3700')
  expect(await pixels()).not.toBe(initial)
  await set({ time: 2600 }); await expect(canvas).toHaveAttribute('data-time', '2600')
  expect(await pixels()).toBe(initial)
  const hashes = new Set<string>()
  for (const mode of ['depth', 'stage', 'stardust']) {
    await set({ mode }); await expect(canvas).toHaveAttribute('data-composition', mode)
    hashes.add(await pixels())
    await page.screenshot({ path: `artifacts/kinetic-${mode}.png` })
  }
  expect(hashes.size).toBe(3)
  await set({ reduced: true, time: 6000 }); await expect(canvas).toHaveAttribute('data-time', '6000')
  const reduced = await pixels()
  await page.waitForTimeout(250)
  expect(await pixels()).toBe(reduced)
})

test('lyrics drag and resize directly without moving the visual effect, and Escape cancels', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '歌词', exact: true }).click()
  await page.getByRole('switch', { name: '显示桌面歌词', exact: true }).click()
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
  await expect(page.getByText('已保存到此浏览器', { exact: true })).toBeVisible()
  const original = await read(), layer = page.getByTestId('lyric-layer')
  const box = (await layer.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 - 55, { steps: 8 }); await page.mouse.up()
  await expect.poll(async () => (await read()).lyrics.bounds.x).toBeGreaterThan(original.lyrics.bounds.x)
  const moved = await read()
  expect(moved.lyrics.bounds.y).toBeLessThan(original.lyrics.bounds.y)
  expect(moved.bounds).toEqual(original.bounds); expect(moved.view).toEqual(original.view)
  await layer.hover()
  const handle = (await page.getByRole('button', { name: '缩放歌词', exact: true }).boundingBox())!
  await page.mouse.move(handle.x + 12, handle.y + 12); await page.mouse.down()
  await page.mouse.move(handle.x - 35, handle.y + 35, { steps: 6 }); await page.mouse.up()
  await expect.poll(async () => (await read()).lyrics.bounds.width).toBeLessThan(moved.lyrics.bounds.width)
  const resized = await read(), current = (await layer.boundingBox())!
  await page.mouse.move(current.x + current.width / 2, current.y + current.height / 2); await page.mouse.down()
  await page.mouse.move(current.x + current.width / 2 - 30, current.y + current.height / 2 + 25)
  await page.keyboard.press('Escape'); await page.mouse.up()
  expect((await read()).lyrics.bounds).toEqual(resized.lyrics.bounds)
  await page.reload()
  await expect(layer).toBeVisible()
  expect((await read()).lyrics.bounds).toEqual(resized.lyrics.bounds)
  await page.getByRole('button', { name: '放大预览', exact: true }).click()
  await expect(page.getByRole('dialog').getByTestId('lyric-layer')).toHaveClass(/is-draggable/)
})
