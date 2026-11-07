import { chooseStyle } from './helpers/module-settings'
import { settingsSection } from './helpers/module-settings'
import { expect, test, type Locator } from '@playwright/test'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'
import { normalizeMusicSettings } from '../src/features/spectrum/music-engine/catalog'
import { importScene, sceneDocument, layout } from '../src/features/preview/scene-library'
import { selectChoice } from './helpers/choices'

const scenes = [['petal_bloom', '星瓣花境'], ['aurora_flow', '极光流域'], ['star_flight', '星尘航道']] as const

async function pixels(canvas: Locator) {
  return canvas.evaluate((node: HTMLCanvasElement) => new Promise<{ visible: number; lit: number; hash: number; error: number }>(resolve => {
    const gl = node.getContext('webgl2')!, arrays = gl.drawArrays, elements = gl.drawElements, instances = gl.drawElementsInstanced
    const restore = () => { gl.drawArrays = arrays; gl.drawElements = elements; gl.drawElementsInstanced = instances }
    const read = () => {
      restore(); clearTimeout(timer)
      const data = new Uint8Array(node.width * node.height * 4); gl.readPixels(0,0,node.width,node.height,gl.RGBA,gl.UNSIGNED_BYTE,data)
      let visible = 0, lit = 0, hash = 2166136261
      for (let i = 0; i < data.length; i += 4) {
        if (data[i+3] > 8) visible++
        if (Math.max(data[i], data[i+1], data[i+2]) > 45) lit++
        hash = Math.imul(hash ^ data[i] ^ data[i+1] ^ data[i+2] ^ data[i+3],16777619)
      }
      resolve({ visible, lit, hash, error: gl.getError() })
    }
    const timer = setTimeout(read, 1800); let queued = false
    const after = () => { if (!queued) { queued = true; queueMicrotask(read) } }
    gl.drawArrays = function (...args) { arrays.apply(this,args); after() }
    gl.drawElements = function (...args) { elements.apply(this,args); after() }
    gl.drawElementsInstanced = function (...args) { instances.apply(this,args); after() }
  }))
}

test('ambient scene controls are validated, exported and compatible with older settings', () => {
  for (const [effect] of scenes) {
    const settings = normalizeSettings({ ...defaults, effect, sceneMode: 'immersive', music: { ambientDensity: 1.6, ambientSpread: 1.4, fieldPalette: 'lake' } })
    expect(importScene(sceneDocument({ name: effect, scene: layout(settings) })).scene).toMatchObject({ effect, sceneMode: 'immersive', music: { ambientDensity: 1.6, ambientSpread: 1.4, fieldPalette: 'lake' } })
  }
  expect(normalizeMusicSettings({ ambientDensity: NaN, ambientSpread: Infinity })).toMatchObject({ ambientDensity: 1, ambientSpread: 1 })
  expect(normalizeMusicSettings({ ambientDensity: 9, ambientSpread: -1 })).toMatchObject({ ambientDensity: 2, ambientSpread: .6 })
})

for (const [effect, label] of scenes) test(`${effect}: real geometry moves, persists controls, reacts to touch and fades at silence`, async ({ page }) => {
  test.setTimeout(60000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await chooseStyle(page, '灯效', label)
  const canvas = page.locator('.ambient-scene-surface canvas')
  await expect(canvas).toHaveAttribute('data-scene', effect)
  await expect.poll(async () => (await pixels(canvas)).lit, { timeout: 10000 }).toBeGreaterThan(50)
  const before = await pixels(canvas); expect(before.error).toBe(0)
  await expect.poll(async () => (await pixels(canvas)).hash).not.toBe(before.hash)
  const items = Number(await canvas.getAttribute('data-items'))
  await settingsSection(page, '外观')
  await selectChoice(page, '场景氛围', 'immersive'); await selectChoice(page, '声场配色', 'lake')
  await settingsSection(page, '动效')
  await page.getByText('造型细节', { exact: true }).click()
  await page.getByRole('slider', { name: '细节密度', exact: true }).focus(); await page.keyboard.press('Home')
  await expect.poll(async () => Number(await canvas.getAttribute('data-items'))).toBeLessThan(items)
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.reload()
  await expect(canvas).toHaveAttribute('data-scene', effect)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))).toMatchObject({ effect, sceneMode: 'immersive', music: { ambientDensity: .5, fieldPalette: 'lake' } })
  await page.getByRole('switch', { name: '模拟预览', exact: true }).click()
  await expect.poll(async () => (await pixels(canvas)).visible, { timeout: 10000 }).toBe(0)
  const box = (await canvas.boundingBox())!
  await canvas.click({ position: { x: box.width * .5, y: box.height * .55 } })
  await expect.poll(async () => (await pixels(canvas)).lit).toBeGreaterThan(50)
  await page.getByRole('button', { name: '放大预览', exact: true }).click()
  await expect(page.getByRole('dialog').locator('canvas')).toHaveAttribute('data-scene', effect)
  await page.getByRole('button', { name: '关闭放大预览', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await settingsSection(page, '外观')
  await settingsSection(page, '动效')
  await page.getByText('造型细节', { exact: true }).click()
  await expect(page.getByRole('slider', { name: effect==='star_flight'?'航道空间':effect==='aurora_flow'?'薄幕空间':'花境空间', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `artifacts/ambient-${effect}-mobile.png`, fullPage: true })
  await expect(page.getByRole('alert')).toHaveCount(0); expect(errors).toEqual([])
})

test('switching 3D themes releases old buffers while retaining the context; a hard mask hides the whole composite', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(settings => localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings)), {
    ...defaults, effect: 'petal_bloom', sceneMode: 'immersive', bounds: { x: 0, y: 0, width: 1, height: 1 }, masks: [{ id: 'all', bounds: { x: 0, y: 0, width: 1, height: 1 }, feather: 0 }],
  })
  await page.goto('/')
  const canvas = page.locator('.three-scene-surface canvas')
  await expect(canvas).toHaveAttribute('data-preparing', 'false')
  await canvas.evaluate(node => {
    const gl = (node as HTMLCanvasElement).getContext('webgl2')!
    const probe = { gl, deleted: 0 }, remove = gl.deleteBuffer.bind(gl)
    ;(window as any).__sceneResources = probe
    gl.deleteBuffer = buffer => { if (buffer) probe.deleted++; remove(buffer) }
  })
  for (const [effect, label] of [...scenes, ['sound_field', '频谱回响']] as const) {
    const deleted = await page.evaluate(() => (window as any).__sceneResources.deleted)
    const previous = await page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!).effect)
    await chooseStyle(page, '灯效', label)
    await expect(canvas).toHaveAttribute('data-renderer', 'three')
    await expect(canvas).toHaveAttribute('data-scene', effect)
    await expect(canvas).toHaveAttribute('data-preparing', 'false')
    if (previous !== effect) await expect.poll(() => page.evaluate(() => (window as any).__sceneResources.deleted)).toBeGreaterThan(deleted)
    expect(await canvas.evaluate(node => (node as HTMLCanvasElement).getContext('webgl2') === (window as any).__sceneResources.gl)).toBe(true)
    expect((await pixels(canvas)).visible).toBe(0)
  }
  expect(errors).toEqual([])
})

for (const effect of ['petal_bloom', 'star_flight', 'aurora_flow'] as const) test(`${effect}: live scene input expires and reduced motion remains still under a constant analysis frame`, async ({ page }) => {
  test.setTimeout(60000)
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/')
  await page.evaluate(async effect => {
    const { mountSoundFieldProbe } = await import('/tests/fixtures/sound-field-probe.tsx')
    const probe = mountSoundFieldProbe({ effect, quality:'eco' })
    // Software-GPU readPixels must finish within the 350ms live-source expiry.
    // HD resolution and particle size are covered by hd-scenes.spec.ts.
    document.getElementById('sound-field-probe')!.style.cssText='width:320px;height:180px;background:#11151b'
    const state = { probe, live: true, timer: 0 }; (window as any).__ambientProbe = state
    state.timer = window.setInterval(() => { if (state.live) probe.push({ rms: .15, bands: Array(6).fill(.4), spectrum: Array(48).fill(.5), skin: [] }) }, 25)
  }, effect)
  const canvas = page.locator('#sound-field-probe canvas')
  await expect(canvas).toHaveAttribute('data-scene', effect)
  await expect.poll(async () => (await pixels(canvas)).lit).toBeGreaterThan(50)
  await expect(canvas).toHaveAttribute('data-drops', '0')
  let last = 0, stable = 0
  await expect.poll(async () => { const hash = (await pixels(canvas)).hash; stable = hash === last ? stable + 1 : 0; last = hash; return stable }, { timeout: 15000, intervals: [200] }).toBeGreaterThanOrEqual(2)
  await page.evaluate(() => { (window as any).__ambientProbe.live = false })
  await expect.poll(async () => (await pixels(canvas)).visible, { timeout: 10000 }).toBe(0)
  await expect(canvas).toHaveAttribute('data-rms', '0.0000')
  await page.evaluate(() => { const state = (window as any).__ambientProbe; clearInterval(state.timer); state.probe.dispose() })
})
