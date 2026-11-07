import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 800, height: 450 }, launchOptions: { args: ['--enable-webgl'] } })

test('scene, card and lyrics share live colors without shifting text or restoring letter ghosts', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.clock.setFixedTime(new Date('2026-11-08T00:00:00Z'))
  await page.goto('/tests/fixtures/music-scene.html')
  const layer = page.getByTestId('lyric-layer'), canvas = layer.locator('canvas')
  await expect(canvas).toHaveAttribute('data-time', '3250')
  // The actual scene remains mounted for palette/focus integration, but its
  // independent motion must not appear through the transparent lyric screenshot.
  await page.addStyleTag({ content: 'canvas[data-renderer="three"] { visibility: hidden; }' })
  const patch = (patch: object) => page.evaluate(patch => {
    const probe = (window as any).musicScene, s = probe.settings()
    probe.set({ settings: { ...s, ...patch } })
  }, patch)
  const initialPosition = await layer.boundingBox()
  for (const motion of ['depth', 'stage', 'folded']) {
    await page.evaluate(motion => {
      const probe = (window as any).musicScene, s = probe.settings()
      probe.set({ settings: { ...s, lyrics: { ...s.lyrics, motion } } })
    }, motion)
    await expect(canvas).toHaveAttribute('data-composition', motion)
    if (motion === 'folded') await expect(canvas).toHaveAttribute('data-echoes', '0')
    const before = (await canvas.screenshot()).toString('base64'), oldPalette = await layer.getAttribute('data-light-palette')
    await page.evaluate(() => {
      const probe = (window as any).musicScene, s = probe.settings()
      probe.set({ settings: { ...s, music: { ...s.music, fieldPalette: s.music.fieldPalette === 'ember' ? 'lake' : 'ember' } } })
    })
    await expect(layer).not.toHaveAttribute('data-light-palette', oldPalette!)
    await expect.poll(async () => (await canvas.screenshot()).toString('base64') !== before).toBe(true)
    expect(await layer.boundingBox()).toEqual(initialPosition)
    await page.evaluate(() => (window as any).musicScene.set({ time: 1900 }))
    await expect(canvas).toHaveAttribute('data-time', '1900')
    await page.evaluate(() => (window as any).musicScene.set({ time: 3250 }))
    await expect(canvas).toHaveAttribute('data-time', '3250')
    const paused = await canvas.screenshot()
    await page.waitForTimeout(150)
    expect((await canvas.screenshot()).equals(paused)).toBe(true)
  }
  const fixedPalette = await layer.getAttribute('data-light-palette')
  await patch({ followCover: true })
  await expect(layer).not.toHaveAttribute('data-light-palette', fixedPalette!)
  const coverPalette = await layer.getAttribute('data-light-palette')
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path fill="#b16a46" d="M0 0h100v100H0z"/></svg>'
  await page.evaluate(cover => (window as any).musicScene.set({ cover }), 'data:image/svg+xml,' + encodeURIComponent(svg))
  await expect(layer).not.toHaveAttribute('data-light-palette', coverPalette!)
  await expect(page.getByLabel('桌面音乐信息卡')).toBeVisible()
  expect(errors).toEqual([])
})
