import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page) {
  await page.addInitScript(() => {
    const app = window as any
    app.lyricFrames = 0
    app.lyricHidden = false
    app.lyricPaints = 0
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => app.lyricHidden })
    const clear = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas instanceof HTMLCanvasElement && this.canvas.classList.contains('kinetic-lyrics-canvas')) app.lyricPaints++
      return clear.apply(this, args as [number, number, number, number])
    }
    const request = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = callback => request(now => { app.lyricFrames++; callback(now) })
  })
  await page.goto('/tests/fixtures/kinetic-lyrics.html')
  await expect(page.locator('canvas')).toHaveAttribute('data-time', '2600')
  await page.evaluate(() => { (window as any).lyricPaints = 0 })
}

const set = (page: Page, patch: object) => page.evaluate(patch => (window as any).lyricProbe.set(patch), patch)
const frames = (page: Page) => page.evaluate(() => (window as any).lyricFrames as number)
const paints = (page: Page) => page.evaluate(() => (window as any).lyricPaints as number)

test('paused lyrics stop scheduling frames and repaint only for a seek or appearance change', async ({ page }) => {
  await fixture(page)
  await set(page, { live: true, playing: true })
  await expect.poll(() => page.locator('canvas').getAttribute('data-time').then(Number)).toBeGreaterThan(2700)
  await set(page, { playing: false, time: 3700 })
  await expect(page.locator('canvas')).toHaveAttribute('data-time', '3700')
  const stopped = await frames(page), painted = await paints(page)
  // Mimic repeated media polls/accessibility updates with unchanged playback.
  for (let i = 0; i < 3; i++) await set(page, { time: 3700 })
  await page.waitForTimeout(200)
  expect(await frames(page)).toBe(stopped)
  expect(await paints(page)).toBe(painted)
  await set(page, { time: 6000 })
  await expect(page.locator('canvas')).toHaveAttribute('data-time', '6000')
  expect(await paints(page)).toBe(painted + 1)
  await set(page, { backgroundOpacity: 60 })
  await expect(page.locator('canvas')).toHaveAttribute('data-background-opacity', '60')
  await set(page, { playing: true })
  await expect.poll(() => page.locator('canvas').getAttribute('data-time').then(Number)).toBeGreaterThan(6100)
})

test('hidden previews sleep and resume at current playback while embedded desktop lyrics stay live', async ({ page }) => {
  await fixture(page)
  await set(page, { live: true, playing: true })
  await expect.poll(() => frames(page)).toBeGreaterThan(3)
  const hide = (hidden: boolean) => page.evaluate(hidden => {
    (window as any).lyricHidden = hidden
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
  await hide(true)
  const stopped = await frames(page), painted = await paints(page)
  await set(page, { time: 8000 })
  await page.waitForTimeout(200)
  expect(await frames(page)).toBe(stopped)
  expect(await paints(page)).toBe(painted)
  await hide(false)
  await expect.poll(() => page.locator('canvas').getAttribute('data-time').then(Number)).toBeGreaterThan(8000)
  await hide(true)
  await set(page, { desktop: true })
  const desktopFrames = await frames(page)
  await expect.poll(() => frames(page)).toBeGreaterThan(desktopFrames + 3)
  expect(await paints(page)).toBeGreaterThan(painted)
})

test('the live meter settles without DOM writes and wakes for audio after idling', async ({ page }) => {
  await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: `
    import '/tests/fixtures/live-meter.tsx';
  ` }))
  await page.goto('/?meter-idle-probe')
  const bars = page.locator('svg rect')
  await expect(bars).toHaveCount(20)
  await expect(bars.first()).toHaveAttribute('height', '1.00')
  const idle = await page.evaluate(() => ({ writes: (window as any).meterWrites, frames: (window as any).meterFrames }))
  await page.waitForTimeout(350)
  expect(await page.evaluate(() => (window as any).meterWrites)).toBe(idle.writes)
  expect(await page.evaluate(() => (window as any).meterFrames) - idle.frames).toBeLessThanOrEqual(5)
  await page.evaluate(() => (window as any).sound())
  await expect.poll(() => bars.first().getAttribute('height').then(Number)).toBeGreaterThan(5)
  await expect(bars.first()).toHaveAttribute('height', '1.00')
  const settled = await page.evaluate(() => (window as any).meterWrites)
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => (window as any).meterWrites)).toBe(settled)
  await page.evaluate(() => (window as any).sound())
  await expect.poll(() => bars.first().getAttribute('height').then(Number)).toBeGreaterThan(5)
})
