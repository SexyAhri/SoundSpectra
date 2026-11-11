import { expect, test } from '@playwright/test'

test('card media updates reuse the clock observer and cached progress nodes', async ({ page }) => {
  await page.addInitScript(() => {
    const counters = { observers: 0, queries: 0 }
    Object.assign(window, { renderWork: counters })
    const Observer = window.IntersectionObserver
    window.IntersectionObserver = class extends Observer {
      constructor(...args: ConstructorParameters<typeof IntersectionObserver>) {
        super(...args)
        counters.observers++
      }
    }
    const query = Element.prototype.querySelector
    Element.prototype.querySelector = function (selector: string) {
      if (this.matches('.music-card') && ['.mc-progress', '.mc-progress-fill', '.mc-arc-fill', '.mc-time'].includes(selector)) counters.queries++
      return query.call(this, selector)
    } as typeof query
  })
  await page.goto('/tests/fixtures/music-card.html')
  await expect(page.locator('#card-frame .mc')).toHaveAttribute('data-timeline', 'available')
  const result = await page.evaluate(async () => {
    const probe = (window as any).cardProbe, counters = (window as any).renderWork
    counters.observers = counters.queries = 0
    for (let i = 0; i < 12; i++) {
      probe.set({ position: 12 + i / 10, updated: Date.now() })
      await new Promise(requestAnimationFrame)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    return { ...counters }
  })
  console.log('card media update work:', result)
  expect(result).toEqual({ observers: 0, queries: 0 })
  await page.evaluate(() => (window as any).cardProbe.set({ playing: false, position: 65 }))
  await expect(page.locator('#card-frame .mc-time')).toHaveText('1:05 / 3:56')
  await page.evaluate(() => (window as any).cardProbe.layout({ variant: 'floating' }))
  await expect(page.locator('#card-frame .mc-time')).toHaveText('1:05 / 3:56')
})

test('lyric prop updates share the animation frame draw and respect its frame budget', async ({ page }) => {
  await page.addInitScript(() => {
    const work = { enabled: false, outsideRaf: 0, paints: [] as number[], frame: -1, inside: false }
    Object.assign(window, { lyricWork: work })
    const raf = window.requestAnimationFrame
    window.requestAnimationFrame = callback => raf(timestamp => {
      work.frame = timestamp
      work.inside = true
      try { callback(timestamp) } finally { work.inside = false }
    })
    const clear = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (work.enabled && this.canvas.classList.contains('kinetic-lyrics-canvas')) {
        work.paints.push(work.frame)
        if (!work.inside) work.outsideRaf++
      }
      return clear.apply(this, args)
    }
  })
  await page.goto('/tests/fixtures/kinetic-lyrics.html')
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-fonts-ready', 'true')
  await page.evaluate(() => (window as any).lyricProbe.set({ live: true, quality: 'eco' }))
  await expect(canvas).toHaveAttribute('data-fps', '30')
  const result = await page.evaluate(async () => {
    const work = (window as any).lyricWork
    work.enabled = true
    // These updates stand in for media/React updates arriving between RAFs.
    for (let i = 0; i < 36; i++) {
      ;(window as any).lyricProbe.set({ time: 4000 + i * 11 })
      await new Promise(resolve => setTimeout(resolve, 8))
    }
    work.enabled = false
    return { outsideRaf: work.outsideRaf, paints: work.paints.length, duplicate: work.paints.length - new Set(work.paints).size }
  })
  console.log('lyric media update work:', result)
  expect(result.paints).toBeGreaterThan(2)
  expect(result.outsideRaf).toBe(0)
  expect(result.duplicate).toBe(0)
  await page.evaluate(() => (window as any).lyricProbe.set({ playing: false, time: 6000 }))
  await expect(canvas).toHaveAttribute('data-time', '6000')
  const frames = await canvas.getAttribute('data-frames')
  await page.waitForTimeout(150)
  expect(await canvas.getAttribute('data-frames')).toBe(frames)
})
