import { settingsSection } from './helpers/module-settings'
import { selectChoice } from './helpers/choices'
import { test, expect, type Page } from '@playwright/test'
import { analyzeWallpaper, composeSuggestion, composition } from '../src/features/preview/scene-suggestions'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'
import { luminance } from '../src/features/preview/wallpaper-palette'

const initial = { ...defaults, enabled: false, color: '#55aacc', quality: 'balanced' as const,
  masks: [{ id: 'keep-mask', bounds: { x: .1, y: .2, width: .15, height: .2 }, feather: .02 }] }
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
const settled = (page: Page) => expect(page.getByText('已保存到此浏览器')).toBeVisible()
async function open(page: Page) {
  await page.getByRole('button', { name: '自动搭配', exact: true }).click()
  await expect(page.getByRole('button', { name: '应用搭配', exact: true })).toBeEnabled()
}
function wallpaper(busyLeft: boolean) {
  const data = new Uint8ClampedArray(128 * 72 * 4)
  for (let y = 0; y < 72; y++) for (let x = 0; x < 128; x++) {
    const busy = busyLeft ? x < 64 : x >= 64
    const value = busy ? (x + y) % 2 * 255 : 40
    data.set([value, value, value, 255], (y * 128 + x) * 4)
  }
  return data
}
test('composition moves away from wallpaper detail and all candidates normalize without data loss', () => {
  const left = analyzeWallpaper(wallpaper(true), 128, 72), right = analyzeWallpaper(wallpaper(false), 128, 72)
  expect(left.key).not.toBe(right.key)
  expect(analyzeWallpaper(wallpaper(true), 128, 72)).toEqual(left)
  for (let i = 0; i < 3; i++) {
    expect(left.suggestions[i].layers[0].bounds.x).toBeGreaterThan(right.suggestions[i].layers[0].bounds.x)
  }
  for (const data of [wallpaper(true), new Uint8ClampedArray(128 * 72 * 4).fill(255), new Uint8ClampedArray(128 * 72 * 4)]) {
    for (const suggestion of analyzeWallpaper(data, 128, 72).suggestions) for (const strength of [0, 45, 100]) {
      const scene = composeSuggestion(suggestion, strength)
      const normalized = normalizeSettings({ ...initial, ...scene })
      expect(composition(normalized)).toEqual(scene)
      expect(normalized.masks).toEqual(initial.masks)
      for (const layer of [scene, ...scene.regions]) {
        expect(layer.bounds.x + layer.bounds.width).toBeLessThanOrEqual(1.00001)
        expect(layer.bounds.y + layer.bounds.height).toBeLessThanOrEqual(1.00001)
        expect(luminance(layer.color.slice(1).match(/../g)!.map(channel => parseInt(channel, 16) / 255) as [number, number, number])).toBeGreaterThan(.41)
      }
    }
  }
  // A bright, quiet upper half must not pull every effect into the sky.
  const sky = wallpaper(true)
  for (let y = 0; y < 30; y++) for (let x = 0; x < 128; x++) sky.set([170, 195, 220, 255], (y * 128 + x) * 4)
  const flow = analyzeWallpaper(sky, 128, 72).suggestions[2].layers[0]
  expect(flow.bounds.y + flow.bounds.height / 2).toBeGreaterThan(.55)
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => {
    if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings))
  }, initial)
})

test('preview and cancel are isolated; apply, global edits and undo preserve the right settings', async ({ page }) => {
  await page.goto('/#scene'); await settled(page)
  await page.getByRole('button', { name: '纯色预览背景' }).click()
  const before = await saved(page)
  await open(page)
  await page.getByRole('button', { name: /浮光星海/ }).click()
  await expect(page.locator('canvas')).toHaveCount(2)
  await page.getByRole('slider', { name: '搭配氛围强度' }).focus(); await page.keyboard.press('End')
  expect(await saved(page)).toEqual(before)
  await page.getByRole('button', { name: '关闭自动搭配' }).click()
  await expect(page.getByRole('button', { name: '自动搭配', exact: true })).toBeFocused()
  expect(await saved(page)).toEqual(before)
  await expect(page.locator('canvas')).toHaveCount(1)
  await open(page)
  await page.getByRole('button', { name: /轻雪星光/ }).click()
  await page.getByRole('slider', { name: '搭配氛围强度' }).focus(); await page.keyboard.press('End')
  await page.getByRole('button', { name: '应用搭配', exact: true }).click(); await settled(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await saved(page)).toMatchObject({ effect: 'ripple', sceneMode: 'immersive', enabled: before.enabled, quality: before.quality, masks: before.masks })
  await selectChoice(page, '渲染性能', 'eco'); await settled(page)
  await page.getByRole('button', { name: '遮罩', exact: true }).click()
  await page.getByRole('slider', { name: '遮罩柔边' }).focus(); await page.keyboard.press('ArrowRight'); await settled(page)
  const masks = (await saved(page)).masks
  await page.getByRole('button', { name: '完成遮罩', exact: true }).click()
  await page.getByRole('button', { name: '撤销搭配' }).click(); await settled(page)
  expect(await saved(page)).toEqual({ ...before, quality: 'eco', masks })
  await page.reload(); await settled(page)
  await page.getByRole('button', { name: '纯色预览背景' }).click()
  await open(page)
  await expect(page.getByRole('button', { name: /轻雪星光/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('slider', { name: '搭配氛围强度' })).toHaveAttribute('aria-valuenow', '100')
  expect(await saved(page)).toEqual({ ...before, quality: 'eco', masks })
  await page.getByRole('button', { name: '应用搭配', exact: true }).click(); await settled(page)
  await settingsSection(page, '外观')
  await page.getByRole('slider', { name: '不透明度', exact: true }).focus(); await page.keyboard.press('ArrowLeft'); await settled(page)
  await expect(page.getByRole('button', { name: '撤销搭配' })).toHaveCount(0)
  await expect(page.getByText('搭配已应用，可撤销。')).toHaveCount(0)
})

test('failed apply and failed undo leave committed scene intact and can retry', async ({ page }) => {
  await page.goto('/#scene'); await settled(page)
  await page.getByRole('button', { name: '纯色预览背景' }).click()
  const before = await saved(page)
  await page.evaluate(() => {
    const set = Storage.prototype.setItem
    ;(window as any).__failSave = true
    Storage.prototype.setItem = function(key, value) {
      if (key === 'soundspectra.settings.v1' && (window as any).__failSave) throw new Error('测试：磁盘写入失败')
      return set.call(this, key, value)
    }
  })
  await open(page)
  await page.getByRole('button', { name: /浮光星海/ }).click()
  await page.getByRole('button', { name: '应用搭配', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('磁盘写入失败')
  expect(await saved(page)).toEqual(before)
  expect(await page.evaluate(() => localStorage.getItem('soundspectra.scene-choices.v1'))).toBeNull()
  await page.evaluate(() => { (window as any).__failSave = false })
  await page.getByRole('button', { name: '应用搭配', exact: true }).click(); await settled(page)
  const applied = await saved(page)
  await page.evaluate(() => { (window as any).__failSave = true })
  await page.getByRole('button', { name: '撤销搭配' }).click()
  await expect(page.getByText(/撤销失败/)).toBeVisible()
  expect(await saved(page)).toEqual(applied)
  await page.evaluate(() => { (window as any).__failSave = false })
  await page.getByRole('button', { name: '撤销搭配' }).click(); await settled(page)
  expect(await saved(page)).toEqual(before)
})

test('unavailable wallpaper and read failure have recovery without changing the current scene', async ({ page }) => {
  await page.goto('/#scene'); await settled(page)
  await page.getByRole('button', { name: '自动搭配', exact: true }).click()
  await expect(page.getByText('请先读取桌面壁纸或选择参考图片，也可以使用纯色背景。')).toBeVisible()
  await expect(page.getByRole('button', { name: '应用搭配', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '关闭自动搭配' }).click()
  await page.getByRole('button', { name: '纯色预览背景' }).click()
  await page.evaluate(() => {
    const get = CanvasRenderingContext2D.prototype.getImageData
    ;(window as any).__failRead = true
    CanvasRenderingContext2D.prototype.getImageData = function(...args: Parameters<typeof get>) {
      if ((window as any).__failRead) throw new Error('测试：壁纸采样失败')
      return get.apply(this, args)
    }
  })
  await page.getByRole('button', { name: '自动搭配', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('壁纸采样失败')
  await page.evaluate(() => { (window as any).__failRead = false })
  await page.getByRole('button', { name: '重新分析' }).click()
  await expect(page.getByRole('button', { name: '应用搭配', exact: true })).toBeEnabled()
  expect(await saved(page)).toEqual(initial)
})

test('a slower old wallpaper cannot replace suggestions for the newly displayed wallpaper', async ({ page }) => {
  await page.goto('/#scene'); await settled(page)
  const expected = analyzeWallpaper(wallpaper(false), 128, 72).suggestions[0].layers[0].bounds
  await page.evaluate(async ({ left, right }) => {
    const fixture = '/tests/fixtures/scene-probes.tsx'
    const { mountSceneProbe } = await import(fixture)
    const image = (pixels: number[]) => {
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 72
      canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), 128, 72), 0, 0)
      return { url: canvas.toDataURL(), width: 128, height: 72 }
    }
    const old = image(left), next = image(right), decode = HTMLImageElement.prototype.decode
    HTMLImageElement.prototype.decode = async function() {
      await decode.call(this)
      if (this.src === old.url) await new Promise<void>(resolve => { (window as any).__releaseOld = resolve })
    }
    const render = mountSceneProbe()
    ;(window as any).__nextWallpaper = () => render(next)
    render(old)
  }, { left: Array.from(wallpaper(true)), right: Array.from(wallpaper(false)) })
  await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseOld)).toBe('function')
  await page.evaluate(() => (window as any).__nextWallpaper())
  await expect.poll(() => page.locator('#scene-probe').textContent()).not.toBeNull()
  const scene = JSON.parse((await page.locator('#scene-probe').textContent())!)
  expect(scene.bounds).toEqual(expected)
  await page.evaluate(async () => { (window as any).__releaseOld(); await new Promise(resolve => setTimeout(resolve, 100)) })
  expect(JSON.parse((await page.locator('#scene-probe').textContent())!)).toEqual(scene)
  expect(await saved(page)).toEqual(initial)
})

test('scene commit queues behind earlier edits and a simultaneous close flush saves the new scene', async ({ page }) => {
  await page.addInitScript(settings => {
    const app = window as any
    app.isTauri = true; app.__saved = { ...settings, enabled: true }; app.__writes = []; app.__release = []
    app.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'settings' }, currentWebview: { label: 'settings' } },
      transformCallback: () => 1, unregisterCallback() {},
      invoke: async (command: string, args: any = {}) => {
        switch (command) {
          case 'get_settings': return app.__saved
          case 'apply_scene':
          case 'update_settings': {
            if (command === 'apply_scene') args.settings = { ...app.__saved, ...args.scene }
            app.__writes.push(args.settings)
            await new Promise<void>(resolve => app.__release.push(resolve))
            app.__saved = args.settings; return args.settings
          }
          case 'get_status': return { state: 'waiting', editing: false, desktopAttached: true }
          case 'get_audio_sources': return { selection: { mode: 'auto' }, error: null, catalog: [], discovery: { targets: [], warning: null } }
          case 'application_info': return { version: '0.1.0', repository: '', updaterConfigured: false, development: true }
          case 'get_preferences': return { closeToTray: true, autoCheckUpdates: false, showUpdateButton: true }
          case 'get_desktop_background': return { screen: { x: 0, y: 0, width: 1920, height: 1080 }, virtualScreen: { x: 0, y: 0, width: 1920, height: 1080 }, position: 'fill', color: '#25232c', image: null, revision: 'plain', issue: null }
          case 'plugin:autostart|is_enabled': case 'plugin:window|is_maximized': return false
          case 'plugin:window|is_visible': return true
          case 'plugin:event|listen': return 1
          case 'plugin:event|unlisten': case 'plugin:event|emit': case 'sync_scene_shortcuts': return
          default: throw new Error(`Unexpected IPC: ${command}`)
        }
      },
    }
  }, initial)
  await page.goto('/#scene')
  await page.evaluate(async () => {
    const path = '/tests/fixtures/scene-probes.tsx'
    const { mountSettingsProbe } = await import(path)
    mountSettingsProbe((value: unknown) => { (window as any).__probe = value })
  })
  await expect.poll(() => page.evaluate(() => (window as any).__probe?.loaded)).toBe(true)
  await page.evaluate(() => (window as any).__probe.update({ quality: 'eco' }))
  await expect.poll(() => page.evaluate(() => (window as any).__writes.length)).toBe(1)
  await page.evaluate(() => {
    const app = window as any
    app.__commit = app.__probe.commitScene({ effect: 'dream_stars', regionName: 'Queue test' })
    app.__flush = app.__probe.flush()
  })
  expect(await page.evaluate(() => (window as any).__writes.length)).toBe(1)
  await page.evaluate(() => (window as any).__release.shift()())
  await expect.poll(() => page.evaluate(() => (window as any).__writes.length)).toBe(2)
  expect(await page.evaluate(() => (window as any).__probe.settings.effect)).toBe('rhythm_balls')
  await page.evaluate(() => (window as any).__release.shift()())
  await expect.poll(() => page.evaluate(() => (window as any).__writes.length)).toBe(3)
  expect(await page.evaluate(() => (window as any).__writes[2])).toMatchObject({ effect: 'dream_stars', quality: 'eco', enabled: true, masks: initial.masks })
  await page.evaluate(async () => { const app = window as any; app.__release.shift()(); await Promise.all([app.__commit, app.__flush]) })
  expect(await page.evaluate(() => (window as any).__saved)).toMatchObject({ effect: 'dream_stars', regionName: 'Queue test', quality: 'eco', enabled: true, masks: initial.masks })
})

for (const viewport of [{ width: 1440, height: 940 }, { width: 1000, height: 620 }, { width: 390, height: 700 }]) {
  test(`candidate previews render and controls stay reachable at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/#scene'); await settled(page)
    await page.getByRole('button', { name: '纯色预览背景' }).click()
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await open(page)
    await page.getByRole('switch', { name: '搭配模拟音频', exact: true }).check()
    for (const name of ['星光留白', '浮光星海', '轻雪星光']) {
      await page.getByRole('button', { name: new RegExp(name) }).click()
      await expect(page.locator('canvas')).toHaveCount(name === '星光留白' ? 1 : 2)
      await expect.poll(() => page.locator('canvas').evaluateAll(async canvases => {
        const counts = await Promise.all(canvases.map(canvas => new Promise<number>(resolve => {
          const sample = (remaining: number) => requestAnimationFrame(() => {
            const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!
            const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
            gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
            let count = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 4) count++
            if (count || !remaining) resolve(count); else sample(remaining - 1)
          })
          sample(10)
        })))
        return counts.length > 0 && counts.every(count => count > 0)
      })).toBe(true)
    }
    // Confirm real nontransparent output rather than canvas presence alone.
    const output = await page.locator('canvas').first().evaluate(async canvas => {
      const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!
      for (let frame = 0; frame < 60; frame++) {
        await new Promise(requestAnimationFrame)
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        if (pixels.some((v, i) => i % 4 === 3 && v > 4)) return true
      }
      return false
    })
    expect(output).toBe(true)
    const dimensions = await page.evaluate(() => {
      const dialog = document.querySelector('.auto-scene-dialog')!, stage = document.querySelector('.desktop-preview')!
      return { overflow: dialog.scrollWidth - dialog.clientWidth, width: stage.clientWidth, height: stage.clientHeight }
    })
    expect(dimensions.overflow).toBeLessThanOrEqual(1); expect(dimensions.height).toBeGreaterThan(100)
    expect(dimensions.width / dimensions.height).toBeCloseTo(16 / 9, 1)
    await page.locator('.auto-scene-body').evaluate(element => { element.scrollTop = 0 })
    await page.screenshot({ path: `artifacts/auto-scene-${viewport.width}-top.png` })
    await page.getByRole('slider', { name: '搭配氛围强度' }).scrollIntoViewIfNeeded()
    const button = await page.getByRole('button', { name: '应用搭配', exact: true }).boundingBox()
    expect(button!.y + button!.height).toBeLessThan(viewport.height)
    await page.screenshot({ path: `artifacts/auto-scene-${viewport.width}.png` })
    expect(errors).toEqual([])
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('canvas')).toHaveCount(1)
    expect(await saved(page)).toEqual(initial)
  })
}
