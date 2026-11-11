import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page) {
  await page.setViewportSize({ width: 384, height: 122 })
  await page.addInitScript(() => {
    const app = window as any
    app.isTauri = true
    app.__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      const probe = app.cardWindowProbe
      if (command === 'get_settings') return structuredClone(probe.settings)
      if (command === 'get_now_playing') return { ...structuredClone(probe.info), updated: Date.now() }
      if (command === 'card_hit_regions') {
        probe.regions = args.regions
        probe.publications++
        return
      }
      throw new Error(`Unexpected IPC: ${command}`)
    } }
  })
  await page.route('**/src/features/spectrum/bridge.ts*', route => {
    if (route.request().url().includes('card-window-original')) return route.continue()
    return route.fulfill({ contentType: 'text/javascript', body: `
      export * from '/src/features/spectrum/bridge.ts?card-window-original';
      export async function subscribeSettings(callback) {
        window.cardWindowProbe.settingsChanged = callback;
        return () => {};
      }
    ` })
  })
  await page.goto('/tests/fixtures/card-window.html')
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).cardWindowProbe.regions.length)).toBe(3)
  await page.evaluate(() => document.fonts.ready)
}

async function expectCurrentRegions(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const probe = (window as any).cardWindowProbe
    return Array.from(document.querySelectorAll('.mc-control')).filter(node => {
      const rect = node.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }).every(node => {
      const rect = node.getBoundingClientRect()
      return probe.regions.some((region: any) => Math.abs(region.x - rect.x) < .1 &&
        Math.abs(region.y - rect.y) < .1 && Math.abs(region.width - rect.width) < .1 && Math.abs(region.height - rect.height) < .1)
    })
  })).toBe(true)
}

test('native clip follows internal text layout without an outer window resize', async ({ page }) => {
  await fixture(page)
  const outer = await page.locator('.mc-native-controls').boundingBox()
  await page.addStyleTag({ content: '.mc-floating .mc-title { font-size: 28px; line-height: 1.5; }' })
  expect(await page.locator('.mc-native-controls').boundingBox()).toEqual(outer)
  await expectCurrentRegions(page)
})

test('identical polls and unrelated settings avoid publishing the same native clip', async ({ page }) => {
  await fixture(page)
  await expectCurrentRegions(page)
  await page.evaluate(() => { (window as any).cardWindowProbe.publications = 0 })
  await page.evaluate(async () => {
    const probe = (window as any).cardWindowProbe
    for (let index = 0; index < 6; index++) {
      probe.settingsChanged({ ...structuredClone(probe.settings), sensitivity: 100 + index })
      await new Promise(requestAnimationFrame)
    }
  })
  const work = await page.evaluate(() => (window as any).cardWindowProbe.publications)
  console.log('native clip publications for six unrelated settings:', work)
  expect(work).toBe(0)
  await expect(page.locator('.mc-control')).toHaveCount(3)
})
