import { expect, test } from '@playwright/test'
import { emptyNowPlaying } from '../src/features/desktop-card/use-now-playing'
import { cardPosition } from '../src/features/desktop-card/card-clock'
import { defaults, normalizeDesktopCard } from '../src/features/spectrum/model'
import { regionPatch } from '../src/features/spectrum/regions'
import { desktopLayout, parseDesktopScene } from '../src/features/preview/desktop-scenes'

test('media clock uses observation time and snaps pause, seek, stale and missing timelines', () => {
  const info = { ...emptyNowPlaying, playing: true, timelineAvailable: true, position: 12, duration: 100, updated: 1000 }
  expect(cardPosition(info, 1500)).toBe(12500)
  expect(cardPosition({ ...info, playing: false }, 1500)).toBe(12000)
  expect(cardPosition({ ...info, position: 3, updated: 1500 }, 1500)).toBe(3000)
  expect(cardPosition(info, 5001)).toBeNull()
  expect(cardPosition({ ...info, timelineAvailable: false }, 1500)).toBeNull()
  expect(cardPosition({ ...info, duration: 0 }, 1500)).toBeNull()
  expect(cardPosition({ ...info, playbackAvailable: false }, 1500)).toBeNull()
  expect(cardPosition({ ...info, position: NaN }, 1500)).toBeNull()
  expect(cardPosition({ ...info, updated: 9000 }, 1500)).toBeNull()
})

test('small and large cards preserve readable titles and scale the same composition in preview', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html?parity')
  for (const variant of ['record', 'compact', 'afternoon']) {
    for (const [width, height] of [[240, 80], [320, 100], [480, 152], [720, 220]]) {
      await page.evaluate(({ variant, width, height }) => {
        (window as any).cardProbe.layout({ variant, width, height, sound: false });
        (window as any).cardProbe.set({ title: '中文长歌名 / Cafe\u0301 · 夜の海 — A Very Long Title', artist: '', cover: null, duration: 0, source: '', playing: false })
      }, { variant, width, height })
      const title = page.locator('#card-frame .mc-title')
      await expect(title).toBeVisible()
      const layout = await title.evaluate(node => {
        const rect = node.getBoundingClientRect(), shell = node.closest('.mc-shell')!.getBoundingClientRect()
        return { inside: rect.left >= shell.left && rect.right <= shell.right && rect.top >= shell.top && rect.bottom <= shell.bottom, font: parseFloat(getComputedStyle(node).fontSize) }
      })
      expect(layout.inside, `${variant} ${width}x${height}`).toBe(true)
      expect(layout.font).toBeGreaterThanOrEqual(15)
      const native = await page.locator('#card-frame .mc-title').boundingBox(), preview = await page.locator('#parity-frame .mc-title').boundingBox()
      expect(preview!.width * 2).toBeCloseTo(native!.width, 0)
      expect(preview!.height * 2).toBeCloseTo(native!.height, 0)
    }
  }
})

test('quiet audio settles without DOM writes and never changes the reported playback state', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html')
  await page.evaluate(() => (window as any).cardProbe.layout({ sound: false }))
  await expect(page.locator('.mc-meter')).toHaveAttribute('data-energy', 'quiet')
  expect(await page.evaluate(async () => {
    let writes = 0
    const observer = new MutationObserver(records => { writes += records.length })
    observer.observe(document.querySelector('.mc-meter')!, { attributes: true, subtree: true })
    await new Promise(resolve => setTimeout(resolve, 500)); observer.disconnect()
    return writes
  })).toBe(0)
  await expect(page.locator('.mc')).toHaveAttribute('data-playing', 'true')
  await page.evaluate(() => (window as any).cardProbe.layout({ active: false }))
  await expect(page.locator('.mc')).toHaveAttribute('data-active', 'false')
  const transform = await page.locator('.mc-progress-fill').getAttribute('style')
  await page.waitForTimeout(180)
  expect(await page.locator('.mc-progress-fill').getAttribute('style')).toBe(transform)
})

test('hidden previews stop visual work while an embedded desktop keeps following real input', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }))
  await page.goto('/tests/fixtures/music-card.html')
  const fill = page.locator('.mc-progress-fill')
  const before = await fill.getAttribute('style')
  await page.waitForTimeout(180)
  expect(await fill.getAttribute('style')).toBe(before)
  await expect(page.locator('.mc')).toHaveAttribute('data-hidden', 'true')
  await page.evaluate(() => (window as any).cardProbe.layout({ desktop: true }))
  await expect(page.locator('.mc')).toHaveAttribute('data-hidden', 'false')
  const current = await fill.getAttribute('style')
  await expect.poll(() => fill.getAttribute('style')).not.toBe(current)
  await expect(page.locator('.mc-meter')).toHaveAttribute('data-energy', 'active')
})

test('cover inheritance drops the old palette when the next track has no artwork', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html')
  await page.evaluate(() => (window as any).cardProbe.configure({ followCover: true, color: '#91bdeb' }))
  const accent = () => page.locator('.mc').evaluate(node => (node as HTMLElement).style.getPropertyValue('--mc-accent'))
  await expect.poll(accent).not.toBe('#91bdeb')
  await page.evaluate(() => (window as any).cardProbe.set({ trackId: 'new-without-cover', title: '新歌', cover: null }))
  await expect.poll(accent).toBe('#91bdeb')
  await expect(page.locator('.mc img')).toHaveCount(0)
})

test('legacy cards inherit and invalid accent falls back while region edits keep it global to the card', () => {
  expect(normalizeDesktopCard(defaults.desktopCard)).toEqual(defaults.desktopCard)
  expect(normalizeDesktopCard({ ...defaults.desktopCard, accentColor: 'bad' })).toEqual(defaults.desktopCard)
  const scene = desktopLayout(defaults).desktop!
  expect(parseDesktopScene({ ...scene, card: { ...scene.card, accentColor: 'future-unsupported' } }).card).toEqual(defaults.desktopCard)
  const card = { ...defaults.desktopCard, accentColor: '#efb273' }
  const settings = { ...defaults, regions: [{ id: 'second', name: 'second', visible: true, ...defaults }] }
  expect(regionPatch(settings, 'second', { desktopCard: card }).desktopCard).toEqual(card)
  expect(regionPatch(settings, 'second', { desktopCard: card }).regions?.[0].color).toBe(defaults.color)
})

test('rapid tracks and late covers cannot mix artwork, text or revive an old request', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html')
  const card = page.locator('.mc')
  await expect(card.locator('.mc-sleeve img')).toHaveCount(1)
  let release: (() => void) | undefined
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/late-cover.svg', async route => { await pending; await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>' }) })
  await page.evaluate(() => (window as any).cardProbe.set({ trackId: 'source:b', title: '同名歌曲', cover: '/late-cover.svg' }))
  await expect(card.locator('img')).toHaveCount(0)
  await page.evaluate(() => (window as any).cardProbe.set({ trackId: 'source:c', title: '同名歌曲', artist: '另一个歌手', cover: null, position: 0, duration: 184 }))
  release!()
  await expect(card.locator('.mc-title')).toHaveText('同名歌曲')
  await expect(card.locator('.mc-artist')).toHaveText('另一个歌手')
  await expect(card.locator('img')).toHaveCount(0)
  await page.evaluate(() => (window as any).cardProbe.set({ cover: (window as any).cardProbe.cover }))
  await expect(card.locator('.mc-sleeve img')).toHaveCount(1)
  await page.evaluate(() => (window as any).cardProbe.set({ trackId: 'other-player:d', title: '', artist: '', cover: null, source: '另一个播放器', duration: 0, timelineAvailable: false, issue: '暂不可用' }))
  await expect(card.locator('img')).toHaveCount(0)
  await expect(card.locator('.mc-title')).toHaveText('另一个播放器')
  await expect(card).toHaveAttribute('data-timeline', 'unavailable')
})

test('rotation survives polling and pause, progress advances continuously and seek applies directly', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html')
  const card = page.locator('.mc'), fill = card.locator('.mc-progress-fill')
  await expect(card).toHaveAttribute('data-timeline', 'available')
  const read = () => fill.evaluate(node => getComputedStyle(node).transform)
  const before = await read()
  await expect.poll(read).not.toBe(before)
  await page.evaluate(() => { const disc = document.querySelector('.mc-disc')!; (window as any).__disc = disc; (window as any).__turn = disc.getAnimations()[0]; (window as any).cardProbe.set({ playing: false, position: 80 }) })
  await expect(card).toHaveAttribute('data-playing', 'false')
  const frozen = await read()
  await page.waitForTimeout(250)
  expect(await read()).toBe(frozen)
  await page.evaluate(() => (window as any).cardProbe.set({ position: 4, playing: true }))
  await expect(card.locator('.mc-progress')).toHaveAttribute('aria-valuenow', '4')
  expect(await page.evaluate(() => (window as any).__disc === document.querySelector('.mc-disc') && (window as any).__turn === document.querySelector('.mc-disc')!.getAnimations()[0])).toBe(true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(card.locator('.mc-disc')).toHaveCSS('animation-name', 'none')
})

test('broken covers fall back and stale observations stop the record instead of inventing playback', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html')
  await page.evaluate(() => (window as any).cardProbe.set({ trackId: 'broken', title: '无法读取封面', cover: 'data:image/png;base64,bm90LWFuLWltYWdl' }))
  await expect(page.locator('.mc img')).toHaveCount(0)
  await expect(page.locator('.mc-title')).toHaveText('无法读取封面')
  await page.evaluate(() => (window as any).cardProbe.set({ updated: Date.now() - 3900 }))
  await expect(page.locator('.mc')).toHaveAttribute('data-playing', 'false')
  await expect(page.locator('.mc')).toHaveAttribute('data-timeline', 'unavailable')
  await expect(page.locator('.mc-kicker')).toContainText('媒体状态待确认')
})

test('accent controls retain all placement parameters and isolate scene and lyric settings through round trips', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html')
  const before = await page.evaluate(() => (window as any).cardProbe.settings())
  await page.getByRole('button', { name: '琥珀色卡片' }).click()
  const after = await page.evaluate(() => (window as any).cardProbe.settings())
  expect(after.color).toBe(before.color)
  expect(after.lyrics).toEqual(before.lyrics)
  expect(after.desktopCard.accentColor).toBe('#efb273')
  expect((await page.evaluate(() => (window as any).cardProbe.roundTrip())).desktopCard.accentColor).toBe('#efb273')
  await page.getByText('精确位置', { exact: true }).click()
  await expect(page.getByRole('slider', { name: '卡片大小', exact: true })).toBeVisible()
  await expect(page.getByRole('slider', { name: '卡片距左侧', exact: true })).toBeVisible()
  await expect(page.getByRole('slider', { name: '卡片距顶部', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '继承场景', exact: true }).click()
  expect((await page.evaluate(() => (window as any).cardProbe.settings())).desktopCard.accentColor).toBeUndefined()
})
