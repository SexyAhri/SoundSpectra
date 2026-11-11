import { chooseStyle } from './helpers/module-settings'
import { setDemo } from './helpers/demo'
import { expect, test } from '@playwright/test'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'
import { desktopLayout, parseDesktopScene, scenePatch } from '../src/features/preview/desktop-scenes'
import { phrases, timedGlyphs } from '../src/features/lyrics/lyric-glyphs'

test('font choices migrate, round trip desktop scenes, and keep personal timing and placement', () => {
  const settings = { ...structuredClone(defaults), lyrics: { ...defaults.lyrics, fontStyle: 'poetry' as const, folder: 'D:/private', offsetMs: 350 } }
  expect(normalizeSettings({ lyrics: {} }).lyrics.fontStyle).toBe('modern')
  expect(normalizeSettings({ lyrics: { fontStyle: 'unknown' } }).lyrics.fontStyle).toBe('modern')
  const scene = desktopLayout(settings).desktop!
  expect(parseDesktopScene(scene).lyrics.fontStyle).toBe('poetry')
  const legacy = structuredClone(scene); delete legacy.lyrics.fontStyle
  const patch = scenePatch(settings, { desktop: parseDesktopScene(legacy) })
  expect(patch.lyrics).toMatchObject({ fontStyle: 'poetry', folder: 'D:/private', offsetMs: 350, bounds: settings.lyrics.bounds })
  expect(() => parseDesktopScene({ ...scene, lyrics: { ...scene.lyrics, fontStyle: 'unknown' } })).toThrow()
  const longWord = timedGlyphs({ text: 'Extraordinary', start: 0, end: 3000, words: [] })
  expect(phrases(longWord, 2).map(group => group.map(g => g.text).join(''))).toEqual(['Extraordinary'])
})

test('the font selector persists through reload and reaches each production renderer', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/#scene')
  await setDemo(page)
  await page.getByRole('button', { name: '歌词', exact: true }).click()
  await page.getByRole('switch', { name: '显示桌面歌词', exact: true }).check()
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await page.getByRole('button', { name: '唱片诗页', exact: false }).click()
  const layer = page.getByTestId('lyric-layer'), canvas = layer.locator('canvas')
  for (const label of ['文字漫游', '错落排版', '弧形流转', '折幕字场']) {
    await chooseStyle(page, '歌词编排', label)
    await expect(canvas).toHaveAttribute('data-font-style', 'poetry')
    await expect(canvas).toHaveAttribute('data-fonts-ready', 'true')
  }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
  await page.reload()
  await setDemo(page)
  await page.getByRole('button', { name: '歌词', exact: true }).click()
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await expect(page.getByRole('button', { name: /唱片诗页/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas).toHaveAttribute('data-font-style', 'poetry')
  await page.getByRole('button', { name: /现代黑体/ }).click()
  await expect(canvas).toHaveAttribute('data-font-style', 'modern')
  expect(await layer.evaluate(node => ({ left: parseFloat(node.style.left), top: parseFloat(node.style.top), width: parseFloat(node.style.width), height: parseFloat(node.style.height) }))).toEqual({
    left: Math.round(saved.lyrics.bounds.x * 100), top: Math.round(saved.lyrics.bounds.y * 100), width: Math.round(saved.lyrics.bounds.width * 100), height: Math.round(saved.lyrics.bounds.height * 100),
  })
})

test('both local faces redraw real paused pixels, survive seeking, and fit mixed lyrics in narrow regions', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const lines = [{ text: '微光 Stay with the light 回声', start: 0, end: 8000, words: [
    { text: '微光 ', start: 0, end: 1200 }, { text: 'Stay with the light ', start: 1200, end: 5800 }, { text: '回声', start: 5800, end: 8000 },
  ] }]
  for (const folded of [false, true]) {
    await page.goto(`/tests/fixtures/${folded ? 'folded' : 'kinetic'}-lyrics.html`)
    const probe = folded ? 'foldedProbe' : 'lyricProbe'
    const set = (patch: object) => page.evaluate(({ probe, patch }) => (window as any)[probe].set(patch), { probe, patch })
    const canvas = page.locator('canvas')
    // Read Canvas ink directly; the fixture's CSS gradient can dither by one
    // channel value between compositor screenshots even while the ink is idle.
    const pixels = async () => folded ? canvas.screenshot() : Buffer.from(await canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL().split(',')[1]), 'base64')
    for (const mode of folded ? ['folded'] : ['depth', 'stage', 'stardust']) {
      const faces: Buffer[] = []
      for (const fontStyle of ['modern', 'poetry']) {
        await set({ lines, mode, fontStyle, time: 3200, playing: false, live: false, backgroundOpacity: 0 })
        await expect(canvas).toHaveAttribute('data-font-style', fontStyle)
        await expect(canvas).toHaveAttribute('data-composition', mode)
        await expect(canvas).toHaveAttribute('data-time', '3200')
        expect(await page.evaluate(style => [...document.fonts].some(face => face.family.includes(style === 'modern' ? 'Noto Sans SC Variable' : 'Noto Serif SC Variable') && face.status === 'loaded'), fontStyle)).toBe(true)
        const before = await pixels(); faces.push(before)
        await page.waitForTimeout(120)
        const paused = await pixels()
        if (!paused.equals(before)) {
          await testInfo.attach(`${mode}-${fontStyle}-before`, { body: before, contentType: 'image/png' })
          await testInfo.attach(`${mode}-${fontStyle}-after`, { body: paused, contentType: 'image/png' })
        }
        expect(paused.equals(before), `${mode}/${fontStyle} pause`).toBe(true)
        await set({ time: 6400 }); await expect(canvas).toHaveAttribute('data-time', '6400')
        await set({ time: 3200 }); await expect(canvas).toHaveAttribute('data-time', '3200')
        const sought = await pixels()
        if (!sought.equals(before)) {
          await testInfo.attach(`${mode}-${fontStyle}-original`, { body: before, contentType: 'image/png' })
          await testInfo.attach(`${mode}-${fontStyle}-sought`, { body: sought, contentType: 'image/png' })
        }
        expect(sought.equals(before), `${mode}/${fontStyle} seek`).toBe(true)
      }
      expect(faces[0].equals(faces[1])).toBe(false)
    }
    await page.evaluate(() => { document.body.querySelector('div')!.style.cssText = 'position:absolute;left:10%;top:85%;width:80%;height:10%' })
    await set({ fontSize: 18, reduced: true, time: 6400 })
    await expect(canvas).toHaveAttribute('data-font-size', '18')
    await canvas.screenshot({ path: `artifacts/lyric-typography/${folded ? 'folded' : 'kinetic'}-compact.png` })
  }
  expect(errors).toEqual([])
})
