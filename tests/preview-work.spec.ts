import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ timeout: 60_000 })

async function fixture(page: Page) {
  // Shared-checkout edits must not hot-reload a page in the middle of a sample.
  await page.routeWebSocket(/ws:\/\/127\.0\.0\.1:\d+/, socket => {
    const server = socket.connectToServer()
    server.onMessage(message => {
      if (typeof message === 'string' && ['update', 'full-reload'].includes(JSON.parse(message).type)) return
      socket.send(message)
    })
  })
  await page.addInitScript(() => {
    for (const name of ['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)!
      Object.defineProperty(HTMLElement.prototype, name, { ...descriptor, get() {
        if (this.classList.contains('rail-hanging')) (window as any).previewWork.reads++
        return descriptor.get!.call(this)
      } })
    }
    const set = CSSStyleDeclaration.prototype.setProperty
    CSSStyleDeclaration.prototype.setProperty = function (property, value, priority) {
      const probe = (window as any).previewWork
      if (probe) {
        if (property === '--rail-audio-drop') probe.dropWrites++
        if (property === '--rail-music-leaf-angle') probe.leafWrites++
        if (property === '--rail-sway-angle') probe.swayWrites++
      }
      return set.call(this, property, value, priority)
    }
  })
  await page.goto('/tests/fixtures/preview-work.html')
  await expect(page.locator('.desktop-preview')).toHaveAttribute('data-ready', 'true', { timeout: 15000 })
  await expect(page.locator('.rail-hanging[data-rail-item]')).toHaveCount(48)
  await expect(page.locator('.rail-surface')).toHaveAttribute('data-breeze-active', 'true')
  await page.waitForTimeout(300)
}

test('media polls do not remeasure rail items and selection uses the latest callback', async ({ page }) => {
  await fixture(page)
  const work = await page.evaluate(async () => {
    const probe = (window as any).previewWork
    probe.reads = 0
    for (let index = 0; index < 12; index++) {
      probe.media({ title: `Song ${index}`, position: index })
      await new Promise(requestAnimationFrame)
    }
    return probe.reads
  })
  console.log('rail layout reads during 12 media updates:', work)
  expect(work).toBe(0)
  await page.locator('[data-rail-item="item-0"] .rail-item').click({ button: 'right' })
  await expect.poll(() => page.evaluate(() => (window as any).previewWork.select)).toEqual(['work', 'item-0'])
  expect(await page.evaluate(() => (window as any).previewWork.selection)).toBe('Song 11')
  await page.evaluate(() => (window as any).previewWork.group({ collapsed: true }))
  await expect(page.locator('.rail-surface')).toHaveClass(/rail-is-collapsed/)
  await page.evaluate(() => (window as any).previewWork.group({ collapsed: false }))
  await expect(page.locator('.rail-hanging[data-rail-item]')).toHaveCount(48)
  await page.evaluate(() => (window as any).previewWork.arrange())
  const move = page.getByRole('button', { name: '移动渲染检查', exact: true })
  await expect(move).toBeEnabled()
  await page.locator('.preview-object-list > summary').click()
  await page.getByRole('button', { name: '锁定渲染检查位置', exact: true }).click()
  await expect(move).toBeDisabled()
  await page.getByRole('button', { name: '解锁渲染检查位置', exact: true }).click()
  await expect(move).toBeEnabled()
  await page.evaluate(() => (window as any).previewWork.active(false))
  await expect(page.locator('.rail-surface')).toHaveAttribute('data-breeze-active', 'false')
})

test('silent audio does not rewrite unchanged cord and hanging styles', async ({ page }) => {
  await fixture(page)
  const work = await page.evaluate(async () => {
    const probe = (window as any).previewWork
    probe.dropWrites = probe.leafWrites = probe.swayWrites = 0
    document.querySelector('.rail-surface')!.dispatchEvent(new CustomEvent('rail-item-release', { detail: { id: 'item-0' } }))
    for (let frame = 0; frame < 24; frame++) await new Promise(requestAnimationFrame)
    return { drops: probe.dropWrites, leaves: probe.leafWrites, sway: probe.swayWrites }
  })
  console.log('silent rail style writes in 24 frames:', work)
  expect(work.drops).toBe(0)
  expect(work.leaves).toBe(0)
  expect(work.sway).toBeGreaterThan(0)
  await expect(page.locator('.rail-surface')).toHaveAttribute('data-breeze-active', 'true')
})
