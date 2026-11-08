import { expect, test } from '@playwright/test'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

for (const effect of ['volume_rain', 'ginkgo_leaves', 'rhythm_skin']) test(`${effect}: transparent lyrics leave the actual scene pixels unchanged for every composition`, async ({ page }) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.setFixedTime(new Date('2026-11-08T00:00:00Z'))
  await page.route('**/lyric-composite-probe', route => route.fulfill({ contentType: 'text/html', body: visualProbeHtml('<body style="margin:0"></body>') }))
  await page.goto('/lyric-composite-probe')
  const result = await page.evaluate(async effect => {
    const path = '/tests/fixtures/lyric-composite-probe.tsx'
    const { mountLyricCompositeProbe } = await import(path)
    const probe = await mountLyricCompositeProbe(effect)
    ;(window as any).__lyricComposite = probe
    const original = probe.read(), changes = []
    const difference = () => probe.read().reduce((total: number, value: number, index: number) => total + Number(value !== original[index]), 0)
    for (const motion of ['depth', 'stage', 'stardust', 'folded']) {
      for (const readability of ['soft', 'contrast']) {
        probe.set({ enabled: true, motion, readability, backgroundOpacity: 0 })
        changes.push({ motion, readability, changedChannels: difference() })
      }
    }
    probe.set({ backgroundOpacity: 60 })
    const shaded = difference()
    probe.set({ backgroundOpacity: 0, readability: 'soft' })
    return { changes, shaded, cleared: difference() }
  }, effect)
  for (const change of result.changes) expect(change.changedChannels, `${change.motion}/${change.readability} must not paint a dark rectangle into the scene`).toBe(0)
  expect(result.shaded).toBeGreaterThan(100)
  expect(result.cleared, 'changing the slider back to zero must clear scene shading immediately').toBe(0)
  await expect(page.locator('.folded-lyrics canvas')).toHaveAttribute('data-composition', 'folded')
  await page.locator('main').screenshot({ path: `artifacts/lyrics-transparent-${effect}.png` })
  await page.evaluate(() => (window as any).__lyricComposite.dispose())
  expect(errors).toEqual([])
})
