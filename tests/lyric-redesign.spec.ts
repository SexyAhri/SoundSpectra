import { expect, test } from '@playwright/test'

test('both redesigned scores reconstruct handoffs on seek and freeze actual pixels when paused', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/tests/fixtures/kinetic-lyrics.html')
  const canvas = page.locator('canvas')
  const set = (patch: object) => page.evaluate(patch => (window as any).lyricProbe.set(patch), patch)
  const pixels = () => canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL())
  const designs = new Set<string>()
  for (const mode of ['depth', 'stage']) {
    await set({ mode, time: 4980, backgroundOpacity: 0, live: true, playing: false })
    await expect(canvas).toHaveAttribute('data-composition', mode)
    await set({ time: 5100 }); await expect(canvas).toHaveAttribute('data-time', '5100')
    await expect(canvas).toHaveAttribute('data-transition', 'true')
    const handoff = await pixels(); designs.add(handoff)
    await page.waitForTimeout(200); expect(await pixels()).toBe(handoff)
    await set({ time: 18200 }); await expect(canvas).toHaveAttribute('data-time', '18200')
    await set({ time: 5100 }); await expect(canvas).toHaveAttribute('data-time', '5100')
    expect(await pixels()).toBe(handoff)
    await set({ time: 40000 }); await expect(canvas).toHaveAttribute('data-time', '40000')
    expect(await canvas.evaluate((node: HTMLCanvasElement) => {
      const data = node.getContext('2d')!.getImageData(0, 0, node.width, node.height).data
      return data.every((value, i) => i % 4 !== 3 || value === 0)
    })).toBe(true)
    await set({ lines: [{ text: '新的一首歌', start: 0, end: 10000, words: [] }], time: 2600, reduced: true })
    await expect(canvas).toHaveAttribute('data-time', '2600')
    const still = await pixels()
    await set({ time: 3700 }); await expect(canvas).toHaveAttribute('data-time', '3700')
    expect(await pixels()).toBe(still)
    await set({ lines: await page.evaluate(() => (window as any).lyricProbe.lines), reduced: false })
  }
  expect(designs.size).toBe(2)
  expect(errors).toEqual([])
})

test('both compact designs respond across the font range and support wallpaper contrast and background controls', async ({ page }) => {
  await page.goto('/tests/fixtures/kinetic-lyrics.html')
  await page.evaluate(() => { document.body.querySelector('div')!.style.cssText = 'position:absolute;left:10%;top:85%;width:86%;height:10%' })
  const canvas = page.locator('canvas')
  const set = (patch: object) => page.evaluate(patch => (window as any).lyricProbe.set(patch), patch)
  const bounds = () => canvas.evaluate((node: HTMLCanvasElement) => {
    const data = node.getContext('2d')!.getImageData(0, 0, node.width, node.height).data
    let left = node.width, right = -1, dark = 0
    for (let i = 0; i < data.length; i += 4) {
      const light = Math.max(data[i], data[i + 1], data[i + 2]), x = (i / 4) % node.width
      if (data[i + 3] > 200 && light > 170) { left = Math.min(left, x); right = Math.max(right, x) }
      if (data[i + 3] > 200 && light < 90) dark++
    }
    return { left, right, width: right - left + 1, dark }
  })
  for (const mode of ['depth', 'stage']) {
    await set({ mode, lines: [{ text: '心声都不可细诉', start: 0, end: 10000, words: [] }], time: 2600, reduced: true, backgroundOpacity: 0, readability: 'soft', regionWidth: .86 })
    await expect(canvas).toHaveAttribute('data-composition', mode)
    const widths: number[] = []
    for (const fontSize of [18, 36, 54, 72]) {
      await set({ fontSize })
      await expect(canvas).toHaveAttribute('data-font-size', String(fontSize))
      widths.push((await bounds()).width)
    }
    expect(widths[3] / widths[0]).toBeGreaterThan(1.4)
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1] * 1.08)
    const current = await bounds(); expect(current.left).toBeGreaterThan(0); expect(current.right).toBeLessThan(await canvas.evaluate((node: HTMLCanvasElement) => node.width - 1))
    await set({ readability: 'contrast' })
    await expect.poll(async () => (await bounds()).dark).toBeGreaterThan(current.dark + 100)
    await canvas.screenshot({ path: `artifacts/lyric-redesign/${mode}-compact-contrast.png` })
    await set({ lines: [], reduced: false, readability: 'soft', backgroundOpacity: 100 })
    await expect(canvas).toHaveAttribute('data-background-opacity', '100')
    const alpha = await canvas.evaluate((node: HTMLCanvasElement) => {
      const context = node.getContext('2d')!
      return { center: context.getImageData(Math.floor(node.width / 2), Math.floor(node.height / 2), 1, 1).data[3], corner: context.getImageData(0, 0, 1, 1).data[3] }
    })
    expect(alpha.center).toBeGreaterThan(245); expect(alpha.corner).toBe(0)
  }
})
