import { expect, test } from '@playwright/test'
import { emptyNowPlaying } from '../src/features/desktop-card/use-now-playing'
import { cardPosition } from '../src/features/desktop-card/card-clock'
import { defaults, normalizeDesktopCard } from '../src/features/spectrum/model'
import { regionPatch } from '../src/features/spectrum/regions'
import { desktopLayout, parseDesktopScene } from '../src/features/preview/desktop-scenes'
import { resolveEffectPalette } from '../src/features/spectrum/effect-palette'

test('media clock uses observation time and snaps pause, seek, stale and missing timelines', () => {
  const info = { ...emptyNowPlaying, playing: true, timelineAvailable: true, position: 12, duration: 100, updated: 1000 }
  expect(cardPosition(info, 1500)).toBe(12500)
  expect(cardPosition({ ...info, playing: false }, 1500)).toBe(12000)
  expect(cardPosition({ ...info, position: 3, updated: 1500 }, 1500)).toBe(3000)
  expect(cardPosition(info, 5001)).toBeNull()
  expect(cardPosition({ ...info, timelineAvailable: false }, 1500)).toBeNull()
  expect(cardPosition({ ...info, duration: 0 }, 1500)).toBeNull()
  expect(cardPosition({ ...info, duration: 0, timelineSource: 'kugou-checkpoint', timelineValidUntil: 2000 }, 1500)).toBeNull()
  expect(cardPosition({ ...info, playbackAvailable: false }, 1500)).toBeNull()
  expect(cardPosition({ ...info, position: NaN }, 1500)).toBeNull()
  expect(cardPosition({ ...info, updated: 9000 }, 1500)).toBeNull()
})

test('NetEase event position updates the music card and expires with the native reader', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html')
  await page.evaluate(() => (window as any).cardProbe.set({ position: 61, duration: 260.48, playing: false, timelineAvailable: true, playbackAvailable: true, timelineSource: 'netease-events', timelineValidUntil: Date.now() + 10000, issue: null }))
  await expect(page.locator('#card-frame .mc-time')).toHaveText('1:01 / 4:20')
  await page.evaluate(() => (window as any).cardProbe.set({ position: 12.5 }))
  await expect(page.locator('#card-frame .mc-time')).toHaveText('0:12 / 4:20')
  await page.evaluate(() => (window as any).cardProbe.set({ timelineValidUntil: Date.now() - 1 }))
  await expect(page.locator('#card-frame article')).toHaveAttribute('data-timeline', 'unavailable')
})

test('small and large cards preserve readable titles and scale the same composition in preview', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/tests/fixtures/music-card.html?parity')
  await page.waitForFunction(() => typeof (window as any).cardProbe?.layout === 'function')
  for (const variant of ['record', 'compact', 'afternoon', 'floating']) {
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
  await expect(page.locator('#card-frame .mc-meter')).toHaveAttribute('data-energy', 'quiet')
  expect(await page.evaluate(async () => {
    let writes = 0
    const observer = new MutationObserver(records => { writes += records.length })
    observer.observe(document.querySelector('.mc-meter')!, { attributes: true, subtree: true })
    await new Promise(resolve => setTimeout(resolve, 500)); observer.disconnect()
    return writes
  })).toBe(0)
  // This fixture has no media poller; keep the observation fresh for the state assertion.
  await page.evaluate(() => (window as any).cardProbe.set({ updated: Date.now() }))
  await expect(page.locator('#card-frame .mc')).toHaveAttribute('data-playing', 'true')
  await page.evaluate(() => (window as any).cardProbe.layout({ active: false }))
  await expect(page.locator('#card-frame .mc')).toHaveAttribute('data-active', 'false')
  const transform = await page.locator('#card-frame .mc-progress-fill').getAttribute('style')
  await page.waitForTimeout(180)
  expect(await page.locator('#card-frame .mc-progress-fill').getAttribute('style')).toBe(transform)
})

test('hidden previews stop visual work while an embedded desktop keeps following real input', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }))
  await page.goto('/tests/fixtures/music-card.html')
  const fill = page.locator('#card-frame .mc-progress-fill')
  const before = await fill.getAttribute('style')
  await page.waitForTimeout(180)
  expect(await fill.getAttribute('style')).toBe(before)
  await expect(page.locator('#card-frame .mc')).toHaveAttribute('data-hidden', 'true')
  await page.evaluate(() => (window as any).cardProbe.layout({ desktop: true }))
  await expect(page.locator('#card-frame .mc')).toHaveAttribute('data-hidden', 'false')
  const current = await fill.getAttribute('style')
  await expect.poll(() => fill.getAttribute('style')).not.toBe(current)
  await expect(page.locator('#card-frame .mc-meter')).toHaveAttribute('data-energy', 'active')
})

test('cover inheritance drops the old palette when the next track has no artwork', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html')
  await page.evaluate(() => (window as any).cardProbe.configure({ followCover: true, color: '#91bdeb' }))
  const accent = () => page.locator('#card-frame .mc').evaluate(node => (node as HTMLElement).style.getPropertyValue('--mc-accent'))
  const fallback = resolveEffectPalette({ ...defaults, color: '#91bdeb' }).main
  await expect.poll(accent).not.toBe(fallback)
  await page.evaluate(() => (window as any).cardProbe.set({ trackId: 'new-without-cover', title: '新歌', cover: null }))
  await expect.poll(accent).toBe(fallback)
  await expect(page.locator('#card-frame .mc img')).toHaveCount(0)
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
  const floating = { ...card, variant: 'floating' as const }
  expect(normalizeDesktopCard(floating)).toEqual(floating)
  expect(parseDesktopScene({ ...scene, card: floating }).card).toEqual(floating)
})

test('rapid tracks and late covers cannot mix artwork, text or revive an old request', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html')
  const card = page.locator('#card-frame .mc')
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
  const card = page.locator('#card-frame .mc')
  const arc = card.locator('.mc-arc-fill')
  await expect(card).toHaveAttribute('data-timeline', 'available')
  const read = () => arc.evaluate(node => parseFloat(getComputedStyle(node).strokeDashoffset))
  const before = await read()
  await expect.poll(read).not.toBe(before)
  await page.evaluate(() => { const disc = document.querySelector('.mc-disc')!; (window as any).__disc = disc; (window as any).__turn = disc.getAnimations()[0]; (window as any).cardProbe.set({ playing: false, position: 80 }) })
  await expect(card).toHaveAttribute('data-playing', 'false')
  const frozen = await read()
  await page.waitForTimeout(250)
  expect(await read()).toBe(frozen)
  await page.evaluate(() => (window as any).cardProbe.set({ position: 59, duration: 236, playing: false }))
  await expect.poll(read).toBe(.75)
  await page.evaluate(() => (window as any).cardProbe.set({ position: 4, playing: true }))
  await expect(card.locator('.mc-progress')).toHaveAttribute('aria-valuenow', '4')
  expect(await page.evaluate(() => (window as any).__disc === document.querySelector('.mc-disc') && (window as any).__turn === document.querySelector('.mc-disc')!.getAnimations()[0])).toBe(true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(card.locator('.mc-disc')).toHaveCSS('animation-name', 'none')
})

test('broken covers fall back and stale observations stop the record instead of inventing playback', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html')
  await page.evaluate(() => (window as any).cardProbe.set({ trackId: 'broken', title: '无法读取封面', cover: 'data:image/png;base64,bm90LWFuLWltYWdl' }))
  await expect(page.locator('#card-frame .mc img')).toHaveCount(0)
  await expect(page.locator('#card-frame .mc-title')).toHaveText('无法读取封面')
  await page.evaluate(() => (window as any).cardProbe.set({ updated: Date.now() - 3900 }))
  await expect(page.locator('#card-frame .mc')).toHaveAttribute('data-playing', 'false')
  await expect(page.locator('#card-frame .mc')).toHaveAttribute('data-timeline', 'unavailable')
  await expect(page.locator('#card-frame .mc-kicker')).toContainText('媒体状态待确认')
})

test('switching to and from floating while paused immediately restores the frozen timeline', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html')
  await page.evaluate(() => (window as any).cardProbe.set({ playing: false, position: 59, duration: 236 }))
  for (const variant of ['floating', 'record', 'afternoon', 'floating']) {
    await page.evaluate(variant => (window as any).cardProbe.layout({ variant }), variant)
    await expect(page.locator('#card-frame .mc-progress')).toHaveAttribute('aria-valuenow', '59')
    await expect(page.locator('#card-frame .mc-progress-fill')).toHaveAttribute('style', 'transform: scaleX(0.25);')
  }
})

test('all cards keep the same hit positions with artwork or the native controls-only placeholder', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/tests/fixtures/music-card.html?native-parity')
  for (const variant of ['record', 'compact', 'afternoon', 'floating']) {
    for (const [width, height] of [[240, 80], [480, 152], [720, 220]]) {
      for (const artwork of [true, false]) {
        await page.evaluate(({ width, height, artwork, variant }) => {
          const probe = (window as any).cardProbe
          probe.layout({ variant, width, height, sound: false })
          probe.set({ cover: artwork ? probe.cover : null, artist: '', album: '海风手记' })
        }, { width, height, artwork, variant })
        await expect(page.locator(`#card-frame .mc-${variant}`)).toBeVisible()
        const positions = await page.evaluate(() => ['card-frame', 'native-frame'].map(id => {
          const host = document.getElementById(id)!, box = host.getBoundingClientRect()
          return Array.from(host.querySelectorAll('.mc-control')).map(node => node.getBoundingClientRect())
            .filter(rect => rect.width > 0 && rect.height > 0)
            .map(rect => [rect.left - box.left, rect.top - box.top, rect.width, rect.height])
        }))
        expect(positions[0]).toEqual(positions[1])
      }
    }
  }
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

test('all four cards render scene palettes and keep fixed colors through scene, cover and persistence changes', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/tests/fixtures/music-card.html')
  const rendered = () => page.locator('#card-frame .mc').evaluate(node => {
    const button = getComputedStyle(node.querySelector('.mc-control-primary')!)
    const surface = getComputedStyle(node.querySelector('.mc-shell')!)
    return { button: button.backgroundColor, surface: surface.backgroundImage + surface.backgroundColor }
  })
  for (const variant of ['record', 'compact', 'afternoon', 'floating']) {
    await page.evaluate(variant => {
      const probe = (window as any).cardProbe
      const settings = probe.settings()
      probe.layout({ variant, width: 480, height: 152, sound: false })
      probe.configure({ followCover: false, color: '#d4c3ff', music: { ...settings.music, fieldPalette: 'iris' } })
    }, variant)
    await page.getByRole('button', { name: '继承场景', exact: true }).click()
    const inherited = await rendered()
    await page.evaluate(() => {
      const probe = (window as any).cardProbe
      probe.configure({ music: { ...probe.settings().music, fieldPalette: 'ember' } })
    })
    await expect.poll(async () => (await rendered()).button, variant).not.toBe(inherited.button)
    await page.getByRole('button', { name: '蔷薇色卡片' }).click()
    const fixed = await rendered()
    const before = await page.evaluate(() => (window as any).cardProbe.settings())
    await page.evaluate(() => {
      const probe = (window as any).cardProbe
      probe.configure({ followCover: true, music: { ...probe.settings().music, fieldPalette: 'lake' } })
      probe.set({ trackId: 'color-cover', cover: probe.cover, playing: true })
    })
    expect(await rendered()).toEqual(fixed)
    await page.getByRole('button', { name: '继承场景', exact: true }).click()
    await expect.poll(async () => (await rendered()).button, variant).not.toBe(fixed.button)
    const coverColor = await rendered()
    await page.evaluate(() => (window as any).cardProbe.set({ cover: null }))
    await expect.poll(async () => (await rendered()).button, variant).not.toBe(coverColor.button)
    await page.getByRole('button', { name: '蔷薇色卡片' }).click()
    expect(await rendered()).toEqual(fixed)
    await page.evaluate(() => {
      const probe = (window as any).cardProbe
      probe.set({ trackId: 'another-cover', cover: probe.cover })
      probe.configure(probe.roundTrip())
    })
    expect(await rendered()).toEqual(fixed)
    const after = await page.evaluate(() => (window as any).cardProbe.settings())
    expect(after.desktopCard).toEqual(before.desktopCard)
    expect(after.lyrics).toEqual(before.lyrics)
    expect(after.color).toEqual(before.color)
    await page.getByRole('button', { name: '继承场景', exact: true }).click()
    expect((await page.evaluate(() => (window as any).cardProbe.roundTrip())).desktopCard.accentColor).toBeUndefined()
  }
})

test('compact keeps play visible at minimum size and restores skip controls when wider', async ({ page }) => {
  await page.goto('/tests/fixtures/music-card.html')
  for (const [width, count] of [[240, 1], [320, 3], [480, 3], [720, 3]]) {
    await page.evaluate(width => (window as any).cardProbe.layout({ variant: 'compact', width, height: 80 }), width)
    await expect(page.locator('#card-frame .mc-control:visible')).toHaveCount(count)
    await expect(page.locator('#card-frame .mc-control-primary')).toBeVisible()
  }
})
