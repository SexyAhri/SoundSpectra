import { test, expect } from '@playwright/test'
import { emptyNowPlaying } from '../src/features/desktop-card/use-now-playing'

test('all standby cards show finished artwork without claiming playback or moving their controls', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html?native-parity')
  await page.evaluate(info => (window as any).cardProbe.set(info), emptyNowPlaying)
  const card = page.locator('#card-frame .mc')
  for (const variant of ['record', 'compact', 'afternoon', 'floating']) {
    for (const [width, height] of [[240, 80], [480, 152]]) {
      await page.evaluate(layout => (window as any).cardProbe.layout({ ...layout, sound: false }), { variant, width, height })
      await expect(card.locator('.mc-original-cover').first()).toBeVisible()
      await expect(card.locator('.mc-title')).toHaveText('等一首好歌')
      await expect(card.locator('.mc-artist')).toHaveText('打开播放器，开始聆听')
      await expect(card).toHaveAttribute('data-playing', 'false')
      await expect(card).toHaveAttribute('data-timeline', 'unavailable')
      await expect(card.locator('.mc-meter')).toBeHidden()
      for (const button of await card.locator('.mc-control:visible').all()) await expect(button).toBeDisabled()
      const positions = await page.evaluate(() => ['card-frame', 'native-frame'].map(id => {
        const host = document.getElementById(id)!, box = host.getBoundingClientRect()
        return [...host.querySelectorAll('.mc-control')].map(el => el.getBoundingClientRect())
          .filter(rect => rect.width > 0 && rect.height > 0)
          .map(rect => [rect.left - box.left, rect.top - box.top, rect.width, rect.height])
      }))
      expect(positions[0]).toEqual(positions[1])
      if (width === 480) await page.locator('#card-frame').screenshot({ path: `artifacts/card-standby/${variant}.png`, animations: 'disabled' })
    }
  }
})

test('original artwork recovers broken covers and gives way to decoded player artwork', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html')
  const card = page.locator('#card-frame .mc')
  for (const variant of ['record', 'compact', 'afternoon', 'floating']) {
    await page.evaluate(variant => {
      (window as any).cardProbe.layout({ variant, sound: false });
      (window as any).cardProbe.set({ cover: null, playing: false, title: '没有封面的歌曲' })
    }, variant)
    await expect(card.locator('.mc-original-cover').first()).toBeVisible()
    await expect(card.locator('.mc-title')).toHaveText('没有封面的歌曲')
    await page.evaluate(() => (window as any).cardProbe.set({ cover: 'data:image/png;base64,bm90LWFuLWltYWdl' }))
    await expect(card.locator('img')).toHaveCount(0)
    await page.evaluate(() => (window as any).cardProbe.set({ cover: (window as any).cardProbe.cover }))
    await expect(card.locator('img').first()).toBeVisible()
    await expect(card.locator('.mc-original-cover')).toHaveCount(0)
    await page.evaluate(() => (window as any).cardProbe.set({ cover: null, trackId: `new:${Date.now()}` }))
    await expect(card.locator('img')).toHaveCount(0)
    await expect(card.locator('.mc-original-cover').first()).toBeVisible()
  }
})

test('ambient light respects reduced motion and stops when the card is inactive', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html')
  await page.evaluate(info => {
    (window as any).cardProbe.set(info);
    (window as any).cardProbe.layout({ variant: 'afternoon', sound: false })
  }, emptyNowPlaying)
  const light = page.locator('#card-frame .mc-material-light')
  await expect(light).toHaveCSS('animation-name', 'mc-material-pass')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(light).toHaveCSS('animation-name', 'none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => (window as any).cardProbe.layout({ active: false }))
  await expect(light).toHaveCSS('animation-play-state', 'paused')
})
