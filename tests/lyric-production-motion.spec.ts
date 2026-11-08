import { expect, test } from '@playwright/test'
import { lyricSpring, lyricOrbit, lyricRelease } from '../src/features/lyrics/lyric-motion'
import { sampleInk } from '../src/features/lyrics/glyph-dust'
import { lyricRenderBudget } from '../src/features/lyrics/lyric-render-budget'
import { lyricAccent } from '../src/features/lyrics/lyric-audio'

test('motion is time-addressable, settles, and keeps the orbit front readable', () => {
  expect(lyricSpring(0)).toBe(0)
  expect(lyricSpring(650)).toBe(1)
  expect(lyricSpring(300)).toBeGreaterThan(1)
  expect(lyricSpring(300)).toBeLessThan(1.1)
  expect(Math.abs(lyricSpring(650) - lyricSpring(649.9))).toBeLessThan(.001)
  const front = lyricOrbit(.5, .5, 1200, 400, false)
  const edge = lyricOrbit(.02, .5, 1200, 400, false)
  expect(front.scale).toBe(1); expect(front.angle).toBe(0)
  expect(edge.z).toBeLessThan(front.z)
  expect(edge.scale).toBeLessThan(front.scale)
  expect(lyricOrbit(.3, 0, 1200, 400, true)).toEqual(lyricOrbit(.3, 1, 1200, 400, true))
  expect(lyricRelease(0, 4000, 3800)).toBe(0)
  expect(lyricRelease(0, 4000, 4500)).toBe(1)
  expect(lyricRenderBudget('eco').particles).toBe(800)
  expect(lyricRenderBudget('balanced').fps).toBe(60)
  expect(lyricRenderBudget('smooth', true).fps).toBe(15)
  expect(lyricAccent({ bass: 0, body: 0, treble: 0, impact: 0, energy: 0 })).toBe(0)
})

test('particle samples stay inside actual ink and remain bounded and deterministic', () => {
  const width = 64, height = 64, data = new Uint8ClampedArray(width * height * 4)
  for (let y = 8; y < 55; y++) for (let x = 16; x < 48; x++) data[(y * width + x) * 4 + 3] = 255
  const points = sampleInk(data, width, height, 40)
  expect(points).toHaveLength(40)
  expect(points.every(p => p.x >= 16 && p.x < 48 && p.y >= 8 && p.y < 55)).toBe(true)
  expect(points).toEqual(sampleInk(data, width, height, 40))
  expect(sampleInk(new Uint8ClampedArray(data.length), width, height, 40)).toEqual([])
})

for (const mode of ['depth', 'stage', 'stardust', 'folded']) test(`${mode}: dust seeks exactly, stops paused, obeys quality and clears`, async ({ page }) => {
  const folded = mode === 'folded', probe = folded ? 'foldedProbe' : 'lyricProbe'
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  if (!folded) await page.addInitScript(() => {
    // Repeated readback can switch Chrome's raster backend mid-comparison.
    // Pin only this test's presentation canvas to the readback backend up front.
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type: string, options?: unknown) {
      return Reflect.apply(getContext, this, [type,
        type === '2d' && this.classList.contains('kinetic-lyrics-canvas')
          ? { ...(options as object), willReadFrequently: true } : options])
    } as typeof getContext
  })
  await page.goto(`/tests/fixtures/${folded ? 'folded' : 'kinetic'}-lyrics.html`)
  const set = (patch: object) => page.evaluate(({ probe, patch }) => (window as any)[probe].set(patch), { probe, patch })
  const canvas = page.locator('canvas')
  const lines = [{ text: '星光落在掌心', start: 0, end: 4000, words: [] }, { text: '听见回声', start: 4000, end: 8000, words: [] }]
  await set({ lines, mode, time: 4080, playing: false, live: false, backgroundOpacity: 0, quality: 'eco' })
  await expect(canvas).toHaveAttribute('data-time', '4080')
  expect(Number(await canvas.getAttribute('data-particles'))).toBeGreaterThan(0)
  expect(Number(await canvas.getAttribute('data-particles'))).toBeLessThanOrEqual(800)
  await expect(canvas).toHaveAttribute('data-fps', '30')
  const pixels = async () => folded ? canvas.screenshot() : Buffer.from(await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL().split(',')[1]), 'base64')
  const original = await pixels()
  await page.waitForTimeout(160); expect((await pixels()).equals(original)).toBe(true)
  if (!folded) await canvas.evaluate((c: HTMLCanvasElement) => {
    ;(window as any).__lyricRaster = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
  })
  await set({ time: 2000 }); await expect(canvas).toHaveAttribute('data-time', '2000')
  await set({ time: 4080 }); await expect(canvas).toHaveAttribute('data-time', '4080')
  if (folded) expect((await pixels()).equals(original)).toBe(true)
  else {
    // Compare visible premultiplied color; exact draw commands are checked below.
    const difference = await canvas.evaluate((c: HTMLCanvasElement) => {
      const before = (window as any).__lyricRaster as Uint8ClampedArray
      const after = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let max = 0
      for (let i = 0; i < after.length; i += 4) {
        max = Math.max(max, Math.abs(after[i + 3] - before[i + 3]))
        for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(after[i + c] * after[i + 3] / 255 - before[i + c] * before[i + 3] / 255))
      }
      return max
    })
    expect(difference).toBeLessThanOrEqual(2)
  }
  await set({ reduced: true }); await expect(canvas).toHaveAttribute('data-particles', '0')
  await set({ reduced: false, time: 5000, quality: 'balanced' }); await expect(canvas).toHaveAttribute('data-particles', '0')
  await expect(canvas).toHaveAttribute('data-fps', '60')
  await set({ lines: [], time: 0 }); await expect(canvas).toHaveAttribute('data-particles', '0')
  expect(errors).toEqual([])
})

test('particle transforms, opacity and text commands reconstruct exactly without frame history', async ({ page }) => {
  await page.goto('/tests/fixtures/kinetic-lyrics.html')
  const results = await page.evaluate(async () => {
    const modulePath = '/src/features/lyrics/kinetic-composition.ts'
    const { KineticComposition } = await import(modulePath)
    const lines = [{ text: '星光落在掌心', start: 0, end: 4000, words: [] }, { text: '听见回声', start: 4000, end: 8000, words: [] }]
    await document.fonts.load('400 96px "Noto Sans SC Variable"', lines.map(l => l.text).join(''))
    return ['depth', 'stage', 'stardust'].map(mode => {
      const canvas = document.createElement('canvas'); canvas.width = 1126; canvas.height = 706
      const ctx = canvas.getContext('2d')!
      let calls: unknown[][] = []
      const record = (args: unknown[]) => {
        const m = ctx.getTransform()
        calls.push([...args, m.a, m.b, m.c, m.d, m.e, m.f, ctx.globalAlpha, ctx.font])
      }
      const rectangle = ctx.fillRect.bind(ctx), text = ctx.fillText.bind(ctx)
      ctx.fillRect = (x, y, w, h) => { record(['point', x, y, w, h]); rectangle(x, y, w, h) }
      ctx.fillText = (s, x, y, max) => { record(['text', s, x, y, max]); if (max === undefined) text(s, x, y); else text(s, x, y, max) }
      const engine = new KineticComposition()
      const frame = { lines, index: 1, time: 4080, width: 1126, height: 706, fontSize: 72, regionWidth: .88, mode, reduced: false, backgroundOpacity: 0, quality: 'eco' as const }
      engine.draw(ctx, frame); const initial = JSON.stringify(calls)
      engine.draw(ctx, { ...frame, index: 0, time: 2000 })
      calls = []; engine.draw(ctx, frame)
      return { mode, same: initial === JSON.stringify(calls), points: engine.particles }
    })
  })
  for (const result of results) { expect(result.same, result.mode).toBe(true); expect(result.points).toBeGreaterThan(0) }
})

test('both renderers apply pixel budgets on high-DPR screens and bound rapid-line releases', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 600 }, deviceScaleFactor: 2 })
  try {
    const page = await context.newPage()
    for (const folded of [false, true]) {
      const probe = folded ? 'foldedProbe' : 'lyricProbe'
      await page.goto(`/tests/fixtures/${folded ? 'folded' : 'kinetic'}-lyrics.html`)
      const set = (patch: object) => page.evaluate(({ probe, patch }) => (window as any)[probe].set(patch), { probe, patch })
      const canvas = page.locator('canvas')
      const lines = Array.from({ length: 8 }, (_, i) => ({ text: '快句仍然清晰', start: i * 100, end: (i + 1) * 100, words: [] }))
      await set({ lines, mode: 'stardust', time: 650, playing: false, live: false, quality: 'eco' })
      await expect(canvas).toHaveAttribute('data-time', '650')
      const eco = await canvas.evaluate((c: HTMLCanvasElement) => c.width * c.height)
      expect(eco).toBeLessThanOrEqual(600_000)
      expect(Number(await canvas.getAttribute('data-particles'))).toBeLessThanOrEqual(800)
      await set({ quality: 'balanced' }); await expect(canvas).toHaveAttribute('data-quality', 'balanced')
      const balanced = await canvas.evaluate((c: HTMLCanvasElement) => c.width * c.height)
      expect(balanced).toBeLessThanOrEqual(1_202_000) // Integer drawing-buffer rounding.
      expect(balanced).toBeGreaterThan(eco * 1.1)
      expect(Number(await canvas.getAttribute('data-particles'))).toBeLessThanOrEqual(2000)
      await set({ quality: 'eco', playing: true, live: true, advance: false })
      await expect(canvas).toHaveAttribute('data-fps', '30')
      const before = Number(await canvas.getAttribute('data-frames'))
      await page.waitForTimeout(350)
      const elapsedFrames = Number(await canvas.getAttribute('data-frames')) - before
      expect(elapsedFrames).toBeGreaterThan(0)
      expect(elapsedFrames).toBeLessThanOrEqual(13)
      await set({ playing: false, live: false })
    }
  } finally { await context.close() }
})
