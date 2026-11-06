import { test, expect, type Page } from '@playwright/test'
import { defaults } from '../src/features/spectrum/model'
import { desktopLayout, desktopPresets, parseDesktopScene, scenePatch } from '../src/features/preview/desktop-scenes'
import { layout, parseLayout, sceneDocument } from '../src/features/preview/scene-library'

const initial = { ...structuredClone(defaults), enabled: false, quality: 'eco' as const,
  lyrics: { ...defaults.lyrics, folder: 'C:/private/lyrics', offsetMs: 250 } }
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
const settled = (page: Page) => expect(page.getByText('已保存到此浏览器')).toBeVisible()
const open = async (page: Page) => {
  await page.getByRole('button', { name: '场景收藏', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存当前', exact: true })).toBeEnabled()
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => {
    if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings))
  }, initial)
})

test('desktop scene format protects private settings and keeps legacy exchange compatible', () => {
  for (const preset of desktopPresets) {
    expect(parseLayout(preset.scene)).toEqual(preset.scene)
    const next = { ...initial, ...scenePatch(initial, preset.scene) }
    expect(next).toMatchObject({ enabled: false, quality: 'eco', lyrics: { folder: 'C:/private/lyrics', offsetMs: 250 } })
    expect(desktopLayout(next)).toEqual(preset.scene)
  }
  expect(scenePatch(initial, layout(defaults))).not.toHaveProperty('lyrics')
  const desktop = desktopLayout(initial).desktop!
  expect(() => parseDesktopScene({ ...desktop, version: 2 })).toThrow()
  expect(() => parseDesktopScene({ ...desktop, lyrics: { ...desktop.lyrics, folder: 'private' } })).toThrow()
  const exported = JSON.parse(sceneDocument({ name: 'fixture', scene: desktopLayout(initial) }))
  expect(exported.scene).not.toHaveProperty('desktop')
  expect(JSON.stringify(exported)).not.toContain('private')
})

test('complete scene previews, failed saves, retry, undo and reload preserve personal state', async ({ page }) => {
  await page.goto('/'); await settled(page)
  await open(page)
  await page.getByRole('button', { name: /暮蓝听歌/ }).click()
  expect(await saved(page)).toEqual(initial)
  await page.evaluate(() => {
    const set = Storage.prototype.setItem
    ;(window as any).__failScene = true
    Storage.prototype.setItem = function(key, value) {
      if (key === 'soundspectra.settings.v1' && (window as any).__failScene) throw Error('场景写入测试失败')
      return set.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: '应用此场景', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('场景写入测试失败')
  expect(await saved(page)).toEqual(initial)
  await page.evaluate(() => { (window as any).__failScene = false })
  await page.getByRole('button', { name: '应用此场景', exact: true }).click(); await settled(page)
  const expected = { ...initial, ...scenePatch(initial, desktopPresets[1].scene) }
  expect(await saved(page)).toEqual(expected)
  await page.getByRole('button', { name: '撤销搭配' }).click(); await settled(page)
  expect(await saved(page)).toEqual(initial)
  await open(page)
  await expect(page.getByLabel('收藏名称')).toHaveValue('暮蓝听歌')
  await page.getByRole('button', { name: '另存为', exact: true }).click()
  const collection = await page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.scene-library.v1')!))
  expect(collection[0].scene).toEqual(desktopPresets[1].scene)
  await page.getByRole('button', { name: '应用此场景', exact: true }).click(); await settled(page)
  await page.reload(); await settled(page)
  expect(await saved(page)).toEqual(expected)
  await open(page)
  await expect(page.getByRole('button', { name: /暮蓝听歌.*最近使用/ })).toHaveAttribute('aria-pressed', 'true')
})

for (const theme of ['light', 'dark']) for (const viewport of [{ width: 1440, height: 940 }, { width: 1000, height: 620 }, { width: 390, height: 700 }]) {
  test(`featured schemes fit ${theme} at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/'); await settled(page)
    await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme
      document.documentElement.classList.toggle('dark', theme === 'dark')
    }, theme)
    await open(page)
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
    for (const name of ['暖砂日常', '暮蓝听歌', '清浅专注']) {
      await page.getByRole('button', { name: new RegExp(name) }).click()
      await expect(page.getByRole('button', { name: '应用此场景', exact: true })).toBeEnabled()
      await expect(page.locator('.auto-scene-dialog .music-card')).toBeVisible()
    }
    await page.getByRole('button', { name: /暮蓝听歌/ }).click()
    await page.getByLabel('收藏名称').scrollIntoViewIfNeeded()
    const input = await page.getByLabel('收藏名称').boundingBox()
    const footer = await page.locator('.auto-scene-footer').boundingBox()
    expect(input!.y + input!.height).toBeLessThanOrEqual(footer!.y)
    expect(footer!.y + footer!.height).toBeLessThan(viewport.height)
    expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    await page.locator('.auto-scene-body').evaluate(el => { el.scrollTop = 0 })
    await page.screenshot({ path: `artifacts/desktop-scenes-${theme}-${viewport.width}.png` })
    expect(errors).toEqual([])
    expect(await saved(page)).toEqual(initial)
  })
}

test('cover colors ignore stale decoding, cache artwork, recover and never persist songs', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/'); await settled(page)
  await page.evaluate(async () => {
    const path = '/tests/fixtures/cover-probe.tsx'
    const { mountCoverProbe } = await import(path)
    const app = window as any
    app.__coverProbe = mountCoverProbe()
    const artwork = (first: string, second: string) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = first; ctx.fillRect(0, 0, 48, 48)
      ctx.fillStyle = second; ctx.fillRect(0, 0, 24, 48)
      return canvas.toDataURL()
    }
    app.__art = { old: artwork('#cc2233', '#aaff44'), fresh: artwork('#2244cc', '#77ccff'), flat: artwork('#2244cc', '#2244cc'), gray: artwork('#333333', '#cccccc') }
    const decode = HTMLImageElement.prototype.decode
    app.__decodes = {}
    HTMLImageElement.prototype.decode = async function() {
      const src = this.src
      app.__decodes[src] = (app.__decodes[src] ?? 0) + 1
      await decode.call(this)
      if (src === app.__art.old) await new Promise<void>(resolve => { app.__releaseOld = resolve })
    }
  })
  const probe = page.locator('#cover-probe')
  const state = async () => JSON.parse((await probe.locator('output').textContent())!)
  await expect(probe).toBeVisible()
  await page.evaluate(() => { const a = window as any; a.__coverProbe.change({ cover: a.__art.old }) })
  await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseOld)).toBe('function')
  await page.evaluate(() => { const a = window as any; a.__coverProbe.change({ cover: a.__art.fresh }) })
  await expect.poll(async () => (await state()).available).toBe(true)
  const fresh = (await state()).color
  expect(fresh).not.toEqual(initial.color)
  await page.evaluate(() => (window as any).__releaseOld())
  await expect.poll(async () => (await state()).color).toBe(fresh)
  await page.evaluate(() => (window as any).__coverProbe.change({ playing: false }))
  await expect.poll(async () => (await state()).color).not.toBe(fresh)
  await page.evaluate(() => (window as any).__coverProbe.change({ playing: true }))
  await expect.poll(async () => (await state()).color).toBe(fresh)
  for (const cover of ['flat', 'gray', 'missing', 'none']) {
    await page.evaluate(key => { const a = window as any; a.__coverProbe.change({ cover: key === 'none' ? null : key === 'missing' ? 'data:image/png;base64,broken' : a.__art[key] }) }, cover)
    await expect.poll(async () => (await state()).color).toBe(defaults.color)
    await expect.poll(async () => (await state()).available).toBe(false)
  }
  await page.evaluate(() => { const a = window as any; a.__coverProbe.change({ cover: a.__art.fresh }) })
  await expect.poll(async () => (await state()).color).toBe(fresh)
  expect(await page.evaluate(() => { const a = window as any; return a.__decodes[a.__art.fresh] })).toBe(1)
  await probe.getByRole('switch', { name: '跟随封面配色' }).click()
  await expect.poll(async () => (await state()).color).toBe(defaults.color)
  await probe.getByRole('switch', { name: '跟随封面配色' }).click()
  await expect.poll(async () => (await state()).color).toBe(fresh)
  await probe.getByRole('button', { name: '固定当前配色' }).click()
  expect(await state()).toMatchObject({ color: fresh, stored: fresh, following: false })
  expect(await saved(page)).toEqual(initial)
  await page.evaluate(() => (window as any).__coverProbe.unmount())
})

test('ordinary cover transitions ease into a color and stop rendering after settling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/'); await settled(page)
  await page.evaluate(async () => {
    const path = '/tests/fixtures/cover-probe.tsx'
    const { mountCoverProbe } = await import(path)
    ;(window as any).__coverProbe = mountCoverProbe()
  })
  const probe = page.locator('#cover-probe')
  await expect(probe).toBeVisible()
  await page.evaluate(async () => {
    const app = window as any
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#cc5522'; ctx.fillRect(0, 0, 48, 48)
    ctx.fillStyle = '#33bb77'; ctx.fillRect(0, 0, 24, 48)
    const cover = canvas.toDataURL()
    const path = '/src/features/desktop-card/cover-colors.ts'
    app.__targetColor = await (await import(path)).readCoverAccent(cover)
    app.__colorSteps = []
    const output = document.querySelector('#cover-probe output')!
    app.__colorObserver = new MutationObserver(() => app.__colorSteps.push(JSON.parse(output.textContent!).color))
    app.__colorObserver.observe(output, { subtree: true, characterData: true, childList: true })
    app.__coverProbe.change({ cover })
  })
  await expect.poll(() => page.evaluate(() => {
    const app = window as any
    return JSON.parse(document.querySelector('#cover-probe output')!.textContent!).color === app.__targetColor
  })).toBe(true)
  expect(await page.evaluate(() => new Set((window as any).__colorSteps).size)).toBeGreaterThan(3)
  // A settled cover should not keep scheduling React renders.
  await page.waitForTimeout(100)
  const count = await page.evaluate(() => (window as any).__colorSteps.length)
  await page.waitForTimeout(150)
  expect(await page.evaluate(() => (window as any).__colorSteps.length)).toBe(count)
  expect(await saved(page)).toEqual(initial)
  await page.evaluate(() => { const app = window as any; app.__colorObserver.disconnect(); app.__coverProbe.unmount() })
})
