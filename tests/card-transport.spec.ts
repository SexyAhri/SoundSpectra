import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const probe = { calls: [] as unknown[], fail: false, delayed: false, release: () => {} }
    Object.assign(window, { isTauri: true, transportProbe: probe, __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => {
      if (command !== 'control_card_media') return Promise.resolve(null)
      probe.calls.push({ command, args })
      if (probe.delayed) return new Promise<void>(resolve => { probe.release = resolve })
      return probe.fail ? Promise.reject('播放器未接受操作') : Promise.resolve()
    } } })
  })
  await page.goto('/tests/fixtures/music-card.html')
  await page.evaluate(() => (window as any).cardProbe.set({ trackId: 'source:track-a', sessionId: 'QQMusic.exe', playbackAvailable: true, controls: { previous: true, next: true, play: true, pause: true } }))
})

test('transport dispatches exact selected-session commands and reflects reported playback, not optimistic state', async ({ page }) => {
  await page.getByRole('button', { name: '上一首', exact: true }).click()
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled()
  await page.evaluate(() => (window as any).cardProbe.set({ playing: false }))
  await page.getByRole('button', { name: '播放', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '下一首', exact: true }).click()
  expect(await page.evaluate(() => (window as any).transportProbe.calls)).toEqual(['previous', 'pause', 'play', 'next'].map(action => ({ command: 'control_card_media', args: { action, trackId: 'source:track-a', sessionId: 'QQMusic.exe' } })))
})

test('pending prevents duplicate clicks; failures are visible and a source change clears stale feedback', async ({ page }) => {
  await page.evaluate(() => { (window as any).transportProbe.delayed = true })
  await page.getByRole('button', { name: '下一首', exact: true }).click()
  await expect(page.getByRole('button', { name: '上一首', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => (window as any).transportProbe.calls.length)).toBe(1)
  await page.evaluate(() => { (window as any).transportProbe.release(); (window as any).transportProbe.delayed = false; (window as any).transportProbe.fail = true })
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await expect(page.locator('.mc-control-feedback')).toContainText('播放器未接受操作')
  await page.evaluate(() => (window as any).cardProbe.set({ trackId: 'source-b:track-b', sessionId: 'OtherPlayer.exe', controls: {} }))
  await expect(page.locator('.mc-control-feedback')).toBeEmpty()
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeDisabled()
})

test('unsupported, stale and inactive media never dispatch; buttons fit all three small layouts', async ({ page }) => {
  for (const variant of ['record', 'compact', 'afternoon']) {
    await page.evaluate(variant => { (window as any).cardProbe.layout({ variant, width: 240, height: 80, sound: false }); (window as any).cardProbe.set({ controls: { previous: false, next: true, play: true, pause: true } }) }, variant)
    await expect(page.getByRole('button', { name: '上一首', exact: true })).toBeDisabled()
    for (const button of await page.locator('.mc-control').all()) {
      expect(await button.evaluate(node => { const rect = node.getBoundingClientRect(), card = node.closest('.mc-shell')!.getBoundingClientRect(); return rect.left >= card.left && rect.right <= card.right && rect.top >= card.top && rect.bottom <= card.bottom })).toBe(true)
    }
  }
  await page.evaluate(() => (window as any).cardProbe.set({ updated: Date.now() - 5000 }))
  await expect(page.getByRole('button', { name: '下一首', exact: true })).toBeDisabled()
  await page.evaluate(() => { (window as any).cardProbe.set({}); (window as any).cardProbe.layout({ active: false }) })
  await expect(page.getByRole('button', { name: '下一首', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => (window as any).transportProbe.calls.length)).toBe(0)
})
