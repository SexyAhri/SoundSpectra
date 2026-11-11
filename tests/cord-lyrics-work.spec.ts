import { expect, test } from '@playwright/test'

test('cord materials share deformation calculations and preserve every authored shape', async ({ page }) => {
  await page.goto('/tests/fixtures/cord-work.html')
  await page.waitForFunction(() => typeof (window as any).cordWork === 'function')
  const rows = await page.evaluate(() => (window as any).cordWork())
  console.log('cord offset calls per frame:', rows)
  for (const row of rows) {
    expect(row.exact).toBe(true)
    expect(row.quiet).toBe(true)
    expect(row.reset).toBe(true)
    expect(row.calls).toBe(row.unique)
    expect(row.calls).toBeLessThan(row.before)
  }
})

for (const renderer of ['kinetic', 'folded']) test(`${renderer} lyrics keep drawing without repeating equal diagnostic attributes`, async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`/tests/fixtures/${renderer}-lyrics.html`)
  await page.waitForFunction(name => !!(window as any)[name], renderer === 'kinetic' ? 'lyricProbe' : 'foldedProbe')
  await page.evaluate(renderer => (window as any)[renderer === 'kinetic' ? 'lyricProbe' : 'foldedProbe'].set({ live: true, playing: true, quality: 'eco' }), renderer)
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-fonts-ready', 'true', { timeout: 20_000 })
  await expect.poll(() => canvas.getAttribute('data-frames').then(Number), { timeout: 20_000 }).toBeGreaterThan(10)
  const work = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas')!
    const first = Number(canvas.dataset.frames)
    let repeated = 0
    const observer = new MutationObserver(records => {
      for (const record of records) if (record.oldValue === canvas.getAttribute(record.attributeName!)) repeated++
    })
    observer.observe(canvas, { attributes: true, attributeOldValue: true, attributeFilter: ['data-composition', 'data-fonts-ready', 'data-font-style', 'data-font-size', 'data-readability', 'data-background-opacity', 'data-quality', 'data-fps'] })
    const deadline = performance.now() + 15000
    while (Number(canvas.dataset.frames) < first + 12 && performance.now() < deadline) await new Promise(requestAnimationFrame)
    observer.disconnect()
    return { repeated, frames: Number(canvas.dataset.frames) - first }
  })
  console.log(`${renderer} equal diagnostic writes over live frames:`, work)
  await page.evaluate(renderer => (window as any)[renderer === 'kinetic' ? 'lyricProbe' : 'foldedProbe'].set({ playing: false, time: 5000, fontSize: 80, readability: 'contrast', backgroundOpacity: 45 }), renderer)
  await expect(canvas).toHaveAttribute('data-time', '5000')
  await expect(canvas).toHaveAttribute('data-font-size', '80')
  await expect(canvas).toHaveAttribute('data-readability', 'contrast')
  await expect(canvas).toHaveAttribute('data-background-opacity', '45')
  const paused = Number(await canvas.getAttribute('data-frames'))
  await page.evaluate(renderer => (window as any)[renderer === 'kinetic' ? 'lyricProbe' : 'foldedProbe'].set({ playing: true }), renderer)
  await expect.poll(() => canvas.getAttribute('data-frames').then(Number)).toBeGreaterThan(paused)
  expect(errors).toEqual([])
  expect(work.frames).toBeGreaterThanOrEqual(12)
  expect(work.repeated).toBe(0)
})
