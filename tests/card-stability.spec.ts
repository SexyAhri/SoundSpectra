import { expect, test } from '@playwright/test'

for (const variant of ['record', 'compact', 'afternoon', 'floating']) {
  test(`${variant} keeps text, artwork and controls vertically anchored through partial track metadata`, async ({ page }) => {
    await page.goto('/tests/fixtures/music-card.html')
    await page.evaluate(variant => (window as any).cardProbe.layout({ variant, sound: false }), variant)
    await expect(page.locator('#card-frame .mc')).toHaveClass(new RegExp(`mc-${variant}`))
    const positions = await page.evaluate(async () => {
      const probe = (window as any).cardProbe
      const selectors = ['.mc-shell', '.mc-title', '.mc-control-primary', '.mc-record-art, .mc-square, .mc-paper-art, .mc-float-art']
      const measure = () => selectors.map(selector => {
        const rect = document.querySelector(selector)!.getBoundingClientRect()
        return { top: rect.top, height: rect.height }
      })
      const baseline = measure()
      const frames: ReturnType<typeof measure>[] = []
      for (const patch of [
        { trackId: 'stability:b', title: '另一首歌', artist: '', cover: null },
        { artist: '迟到的歌手 / Another Artist', cover: probe.cover },
        { trackId: 'stability:c', title: '同名歌曲', artist: '歌手甲' },
        { trackId: 'stability:d', title: '同名歌曲', artist: '' },
        { playing: false },
        { playing: true, artist: '歌手乙' },
        { album: '' },
        { album: '迟到的专辑信息 / A Long Album Title', cover: probe.cover },
      ]) {
        probe.set(patch)
        const started = performance.now()
        while (performance.now() - started < 320) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          frames.push(measure())
        }
      }
      return { baseline, frames }
    })
    for (const frame of positions.frames) {
      for (const [index, rect] of frame.entries()) {
        expect(Math.abs(rect.top - positions.baseline[index].top), `vertical position of element ${index}`).toBeLessThan(.2)
        expect(Math.abs(rect.height - positions.baseline[index].height), `height of element ${index}`).toBeLessThan(.2)
      }
    }
  })
}
