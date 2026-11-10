import { setDemo } from './helpers/demo'
import { chooseStyle } from './helpers/module-settings'
import { expect, test } from '@playwright/test'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'
import { emptyNowPlaying } from '../src/features/desktop-card/use-now-playing'
import { activeLine, demoLyrics, playbackPosition, wordProgress, lyricDisplayText } from '../src/features/lyrics/model'
import { hasTimedWords, timedGlyphs } from '../src/features/lyrics/kinetic-composition'
import { displayBounds } from '../src/features/spectrum/regions'

test('lyric clock respects pause, seek, stale sessions and word timing', () => {
  const info = { ...emptyNowPlaying, position: 10, duration: 100, updated: 1000, playing: true, timelineAvailable: true }
  expect(playbackPosition(info, 1500)).toBe(10500)
  expect(playbackPosition({ ...info, playing: false }, 1500)).toBe(10000)
  expect(playbackPosition({ ...info, position: 35, updated: 1500 }, 1500)).toBe(35000)
  expect(playbackPosition(info, 6000)).toBeNull()
  expect(playbackPosition({ ...info, timelineAvailable: false }, 1500)).toBeNull()
  const checkpoint = { ...info, duration: 0, timelineSource: 'kugou-checkpoint' as const, timelineValidUntil: 2000 }
  expect(playbackPosition(checkpoint, 1500)).toBe(10500)
  expect(playbackPosition(checkpoint, 2100)).toBeNull()
  expect(playbackPosition({ ...checkpoint, timelineValidUntil: undefined }, 1500)).toBeNull()
  const accessibility = { ...info, timelineSource: 'player-accessibility' as const, timelineValidUntil: 2000 }
  expect(playbackPosition(accessibility, 1500)).toBe(10500)
  expect(playbackPosition(accessibility, 2100)).toBeNull()
  expect(playbackPosition({ ...accessibility, timelineValidUntil: undefined }, 1500)).toBeNull()
  expect(playbackPosition({ ...info, position: NaN }, 1500)).toBeNull()
  expect(playbackPosition({ ...info, updated: 5000 }, 1500)).toBeNull()
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

test('checkpoint lyrics render without total duration and disappear when their anchor expires', async ({ page }) => {
  await page.goto('/tests/fixtures/folded-lyrics.html')
  await page.evaluate(() => {
    const probe = (window as any).foldedProbe
    probe.timing({ duration: 0, timelineSource: 'kugou-checkpoint', timelineValidUntil: Date.now() + 10000 })
    probe.set({ layer: true, playing: false, available: true, time: 2600 })
  })
  const layer = page.getByTestId('lyric-layer')
  await expect(layer).toBeVisible()
  await expect(layer.getByLabel('当前歌词')).toHaveText('风把晚霞 折成一页信')
  await expect(layer.locator('canvas')).toBeVisible()
  await page.evaluate(() => (window as any).foldedProbe.timing({ timelineValidUntil: Date.now() - 1 }))
  await expect(layer).toHaveCount(0)
})

test('NetEase native event clock drives lyrics and stops when observations expire', async ({ page }) => {
  const info = { ...emptyNowPlaying, position: 2.6, duration: 260.48, updated: 1000, playing: true, timelineAvailable: true, timelineSource: 'netease-events' as const, timelineValidUntil: 3500 }
  expect(playbackPosition(info, 1500)).toBe(3100)
  expect(playbackPosition({ ...info, playing: false }, 1500)).toBe(2600)
  expect(playbackPosition({ ...info, position: 20, updated: 1500 }, 1500)).toBe(20000)
  expect(playbackPosition(info, 3501)).toBeNull()
  expect(playbackPosition({ ...info, timelineValidUntil: undefined }, 1500)).toBeNull()
  await page.goto('/tests/fixtures/folded-lyrics.html')
  await page.evaluate(() => {
    const probe = (window as any).foldedProbe
    probe.timing({ duration: 260.48, timelineSource: 'netease-events', timelineValidUntil: Date.now() + 10000 })
    probe.set({ layer: true, playing: false, available: true, time: 2600 })
  })
  const layer = page.getByTestId('lyric-layer')
  await expect(layer.getByLabel('当前歌词')).toHaveText('风把晚霞 折成一页信')
  await page.evaluate(() => (window as any).foldedProbe.set({ time: 5400 }))
  await expect(layer.getByLabel('当前歌词')).toHaveText(demoLyrics[1].text)
  await page.evaluate(() => (window as any).foldedProbe.timing({ timelineValidUntil: Date.now() - 1 }))
  await expect(layer).toHaveCount(0)
})

test('lyrics preview animates independently, persists controls and never fabricates live lyrics', async ({ page }) => {
  await page.goto('/'); await setDemo(page)
  await page.getByRole('button', { name: '歌词', exact: true }).click()
  await page.getByRole('switch', { name: '显示桌面歌词', exact: true }).click()
  await expect(page.getByLabel('QQ 音乐歌词目录', { exact: true })).toHaveCount(0)
  const layer = page.getByTestId('lyric-layer')
  await expect(layer.getByText('模拟歌词')).toBeVisible()
  const sung = layer.locator('.kinetic-lyrics-canvas')
  await expect(sung).toBeVisible()
  const before = await sung.getAttribute('data-time')
  await expect.poll(() => sung.getAttribute('data-time')).not.toBe(before)
  await chooseStyle(page, '歌词编排', '错落排版')
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await page.getByRole('slider', { name: '歌词字号', exact: true }).focus(); await page.keyboard.press('End')
  await page.getByRole('slider', { name: '歌词背景', exact: true }).focus(); await page.keyboard.press('Home')
  await page.getByRole('tab', { name: '同步与位置', exact: true }).click()
  await page.getByText('位置与高级设置', { exact: true }).click()
  await page.getByRole('slider', { name: '歌词同步偏移', exact: true }).focus(); await page.keyboard.press('ArrowRight')
  await expect(page.getByText('已保存到此浏览器', { exact: true })).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
  expect(saved.lyrics).toMatchObject({ enabled: true, motion: 'stage', fontSize: 72, offsetMs: 100, backgroundOpacity: 0 })
  expect(saved.desktopCard.enabled).toBe(false)
  expect(saved.effect).toBe(defaults.effect)
  await page.screenshot({ path: 'artifacts/lyrics-desktop.png' })
  await page.reload(); await setDemo(page); await page.getByRole('button', { name: '歌词', exact: true }).click()
  await expect(page.getByRole('switch', { name: '显示桌面歌词', exact: true })).toBeChecked()
  await page.getByRole('tab', { name: '外观', exact: true }).click()
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

test('line-only timing stays phrase-level while word timing keeps its declared granularity', () => {
  const lineOnly = { text: 'Moonlight stays', start: 1000, end: 3200, words: [] }
  expect(hasTimedWords(lineOnly)).toBe(false)
  expect(timedGlyphs(lineOnly).every(glyph => glyph.start === 1000 && glyph.end === 3200 && !glyph.timed)).toBe(true)
  const timed = { text: '微光 glow', start: 1000, end: 3200, words: [
    { text: '微光 ', start: 1000, end: 1900 }, { text: 'glow', start: 1900, end: 3200 },
  ] }
  const glyphs = timedGlyphs(timed)
  expect(hasTimedWords(timed)).toBe(true)
  expect(glyphs.filter(glyph => glyph.text !== ' ').map(glyph => [glyph.text, glyph.start, glyph.end, glyph.timed])).toEqual([
    ['微', 1000, 1900, true], ['光', 1000, 1900, true], ['g', 1900, 3200, true], ['l', 1900, 3200, true], ['o', 1900, 3200, true], ['w', 1900, 3200, true],
  ])
})

for (const mode of ['depth', 'stage', 'stardust']) test(`${mode} lyric background obeys zero and low opacity with wallpaper contrast enabled`, async ({ page }) => {
  await page.goto('/tests/fixtures/kinetic-lyrics.html')
  const canvas = page.locator('canvas')
  const alpha = () => canvas.evaluate((node: HTMLCanvasElement) => {
    const c = node.getContext('2d')!
    return { inside: c.getImageData(Math.floor(node.width / 2), Math.floor(node.height / 4), 1, 1).data[3], corner: c.getImageData(0, 0, 1, 1).data[3] }
  })
  for (const backgroundOpacity of [100, 15, 0]) {
    const samples = []
    for (const readability of ['soft', 'contrast']) {
      await page.evaluate(patch => (window as any).lyricProbe.set(patch), { mode, readability, lines: [], time: 0, backgroundOpacity })
      await expect(canvas).toHaveAttribute('data-background-opacity', String(backgroundOpacity))
      await expect(canvas).toHaveAttribute('data-readability', readability)
      samples.push(await alpha())
    }
    expect(samples[1], 'wallpaper contrast must not override the chosen background opacity').toEqual(samples[0])
    expect(samples[1].corner).toBe(0)
    if (backgroundOpacity === 0) expect(samples[1].inside).toBe(0)
    else expect(samples[1].inside).toBeGreaterThan(backgroundOpacity * .7)
  }
})

test('three lyric designs have distinct composition and respect reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 })
  await page.addInitScript(settings => localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings)), {
    ...defaults, effect: 'dream_stars', sceneMode: 'immersive', opacity: 100, bounds: { x: 0, y: 0, width: 1, height: 1 },
    lyrics: { ...defaults.lyrics, enabled: true, fontSize: 72, bounds: { x: .06, y: .35, width: .88, height: .34 } },
  })
  await page.goto('/')
  await setDemo(page)
  await page.getByRole('button', { name: '歌词', exact: true }).click()
  const layer = page.getByTestId('lyric-layer')
  for (const [mode, name] of [['depth', '文字漫游'], ['stage', '错落排版'], ['stardust', '弧形流转']]) {
    await chooseStyle(page, '歌词编排', name)
    await expect(layer).toHaveClass(new RegExp(`lyric-motion-${mode}`))
    await expect(layer.locator('.kinetic-lyrics-canvas')).toHaveAttribute('data-composition', mode)
    await expect(layer.getByLabel('当前歌词')).not.toBeEmpty()
    await page.locator('.desktop-preview').screenshot({ path: `artifacts/lyric-${mode}.png` })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await chooseStyle(page, '歌词编排', '文字漫游')
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

test('lyric designs animate their adjacent-line handoffs', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 600 })
  await page.goto('/tests/fixtures/kinetic-lyrics.html')
  const canvas = page.locator('canvas')
  const set = (patch: object) => page.evaluate(patch => (window as any).lyricProbe.set(patch), patch)
  const pixels = () => canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL())
  await set({ lines: [{ text: '微光沿着夜色', start: 0, end: 4000, words: [] }, { text: '听见远方回声', start: 4000, end: 8000, words: [] }] })
  for (const mode of ['depth', 'stage', 'stardust']) {
    await set({ mode, time: 3980, reduced: false })
    await expect(canvas).toHaveAttribute('data-transition', 'false')
    const before = await pixels()
    await set({ time: 4000 })
    await expect(canvas).toHaveAttribute('data-transition', 'true')
    const entering = await pixels()
    await set({ time: 2200 })
    await expect(canvas).toHaveAttribute('data-transition', 'false')
    await set({ time: 3980 })
    await expect(canvas).toHaveAttribute('data-transition', 'false')
    await set({ time: 4000 })
    await expect(canvas).toHaveAttribute('data-transition', 'true')
    await set({ time: 4200 })
    await expect(canvas).toHaveAttribute('data-transition', 'true')
    const leaving = await pixels()
    await set({ time: 4400 })
    await expect(canvas).toHaveAttribute('data-transition', 'false')
    expect(new Set([before, entering, leaving]).size).toBe(3)
    await page.screenshot({ path: `artifacts/lyric-handoff-${mode}.png` })
  }
  await set({ time: 14000 })
  await expect(canvas).toHaveAttribute('data-transition', 'false')
})

test('all lyric scores replace old letter silhouettes with ink dust at handoff', async ({ page }) => {
  await page.goto('/tests/fixtures/kinetic-lyrics.html')
  const shifts = await page.evaluate(async () => {
    const modulePath = '/src/features/lyrics/kinetic-composition.ts'
    const { KineticComposition } = await import(modulePath)
    const lines = [
      { text: '微光沿着夜色慢慢流淌', start: 0, end: 8000, words: [] },
      { text: '让风把心事轻轻收藏', start: 4000, end: 10000, words: [] },
    ]
    return ['depth', 'stage', 'stardust'].map(mode => {
      const canvas = document.createElement('canvas')
      canvas.width = 600; canvas.height = 450
      const context = canvas.getContext('2d')!
      const positions: { x: number; y: number }[] = []
      const fillText = context.fillText.bind(context)
      context.fillText = (text, x, y, maxWidth) => {
        if (text === '微') {
          const transform = context.getTransform()
          positions.push({ x: transform.e, y: transform.f })
        }
        if (maxWidth === undefined) fillText(text, x, y)
        else fillText(text, x, y, maxWidth)
      }
      const engine = new KineticComposition()
      const frame = { lines, index: 0, time: 3980, width: 600, height: 450, fontSize: 72, regionWidth: .88, mode, reduced: false, backgroundOpacity: 30 }
      engine.draw(context, frame)
      const before = positions.length
      engine.draw(context, { ...frame, index: 1, time: 4000 })
      if (before !== 1) throw new Error(`Expected one current old-line glyph for ${mode}`)
      return { mode, oldLettersAfter: positions.length - before,
        particles: engine.particles }
    })
  })
  for (const { mode, oldLettersAfter, particles } of shifts) {
    expect(oldLettersAfter, mode).toBe(0)
    expect(particles, mode).toBeGreaterThan(0)
  }
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
