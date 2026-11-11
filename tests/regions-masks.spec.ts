import { chooseStyle } from './helpers/module-settings'
import { setDemo } from './helpers/demo'
import { settingsSection } from './helpers/module-settings'
import { selectChoice } from './helpers/choices'
import { test, expect, type Page } from '@playwright/test'
import { defaults, normalizeSettings, effectIds } from '../src/features/spectrum/model'
import { regionStyle, regionPatch, displayBounds } from '../src/features/spectrum/regions'
import { drawingSize, budgets } from '../src/features/spectrum/render-budget'
import { withSceneMasks } from '../src/features/spectrum/mask-shader'

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
const settled = (page: Page) => expect(page.getByText('已保存到此浏览器')).toBeVisible()

test('selecting region two keeps preview gestures and inspector edits on that region', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto('/#scene'); await settled(page)
  await page.getByRole('button', { name: '全屏展示当前灯效', exact: true }).click()
  await page.getByLabel('添加装饰区域', { exact: true }).click(); await settled(page)
  const original = await saved(page), id = original.regions[0].id
  await expect(page.getByRole('combobox', { name: '当前装饰区域' })).toContainText('区域 2')
  const primary = page.locator('[data-region-id="primary"] canvas').first()
  const box = (await primary.boundingBox())!
  // Outside region two: the underlying primary canvas must not steal selection.
  await page.mouse.move(box.x + box.width * .1, box.y + box.height * .1)
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .18, box.y + box.height * .15, { steps: 5 }); await page.mouse.up()
  await expect(page.getByRole('combobox', { name: '当前装饰区域' })).toContainText('区域 2')
  await chooseStyle(page, '灯效', '雪花飘舞')
  await settingsSection(page, '外观')
  await page.getByRole('slider', { name: '不透明度', exact: true }).focus(); await page.keyboard.press('Home')
  await settingsSection(page, '位置')
  await page.getByText('精细视角', { exact: true }).click()
  await page.getByRole('slider', { name: '左右旋转', exact: true }).press('ArrowRight'); await settled(page)
  const changed = await saved(page)
  expect(regionStyle(changed)).toEqual(regionStyle(original))
  expect(changed.regions[0]).toMatchObject({ id, effect: 'ripple', view: { yaw: original.regions[0].view.yaw + 1 }, opacity: 10 })
  const secondary = page.locator(`[data-region-id="${id}"] canvas`).first()
  const secondBox = (await secondary.boundingBox())!
  await page.mouse.move(secondBox.x + secondBox.width * .4, secondBox.y + secondBox.height * .4)
  await page.mouse.down(); await page.mouse.move(secondBox.x + secondBox.width * .6, secondBox.y + secondBox.height * .4, { steps: 5 }); await page.mouse.up()
  await expect.poll(async () => (await saved(page)).regions[0].view.yaw).not.toBe(changed.regions[0].view.yaw)
  expect(regionStyle(await saved(page))).toEqual(regionStyle(original))
  await page.screenshot({ path: 'artifacts/region-two-isolation.png' })
  await page.reload(); await settled(page)
  await selectChoice(page, '当前装饰区域', id)
  await settingsSection(page, '外观')
  await expect(page.getByRole('slider', { name: '不透明度', exact: true })).toHaveAttribute('aria-valuenow', '10')
  expect(regionStyle(await saved(page))).toEqual(regionStyle(original))
})
test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => {
    if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings))
  }, defaults)
})

test('legacy settings, region isolation and total drawing budgets', () => {
  const legacy = normalizeSettings({ color: '#123456', bounds: defaults.bounds })
  expect(legacy).toMatchObject({ color: '#123456', regionVisible: true, regions: [], masks: [] })
  const region = { ...regionStyle(defaults), id: 'extra', name: '天空', visible: true, bounds: { x: 0, y: 0, width: 1, height: .3 } }
  const settings = { ...legacy, regions: [region] }
  const changed = { ...settings, ...regionPatch(settings, 'extra', { color: '#abcdef', quality: 'eco' }) }
  expect(changed.color).toBe('#123456'); expect(changed.quality).toBe('eco'); expect(changed.regions[0].color).toBe('#abcdef')
  expect(regionPatch(settings, 'removed-region', { effect: 'ripple', opacity: 10 })).toEqual({})
  expect(displayBounds(settings)).toEqual({ x: 0, y: 0, width: 1, height: .9199999999999999 })
  const invalid = normalizeSettings({ masks: [{ id: 'm', bounds: { width: 1, height: 1 } }, { id: 'm' }, { id: 'primary' }] })
  expect(invalid.masks).toHaveLength(1); expect(invalid.masks[0].bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  for (const quality of ['eco', 'balanced', 'smooth'] as const) {
    const size = drawingSize(3840, 2160, 2, quality, 4)
    expect(size.width * size.height * 4).toBeLessThanOrEqual(budgets[quality].pixels)
  }
})

test('regions keep independent appearance, visibility and placement through reload and promotion', async ({ page }) => {
  await page.goto('/#scene'); await settled(page)
  const original = await saved(page)
  await page.getByLabel('添加装饰区域').click()
  await page.getByLabel('重命名当前区域').click()
  await page.getByLabel('区域名称', { exact: true }).fill('天空')
  await page.getByLabel('区域名称', { exact: true }).press('Enter')
  await chooseStyle(page, '灯效', '银河')
  await page.getByRole('button', { name: '布置', exact: true }).click()
  await page.getByRole('button', { name: '应用天空布局' }).click()
  await settled(page)
  const scene = await saved(page)
  expect(scene.effect).toBe(original.effect); expect(scene.bounds).toEqual(original.bounds)
  expect(scene.regions[0]).toMatchObject({ name: '天空', effect: 'dream_stars', bounds: { x: 0, y: 0, width: 1, height: .6 } })
  await page.getByRole('button', { name: '完成布置', exact: true }).click()
  await expect(page.locator('canvas')).toHaveCount(2)
  await page.getByRole('switch', { name: '显示当前区域' }).click(); await settled(page)
  await expect(page.locator('canvas')).toHaveCount(1)
  await page.reload(); await settled(page)
  expect((await saved(page)).regions[0].visible).toBe(false)
  await selectChoice(page, '当前装饰区域', scene.regions[0].id)
  await page.getByRole('switch', { name: '显示当前区域' }).click()
  await selectChoice(page, '当前装饰区域', 'primary')
  await page.getByLabel('删除当前区域').click(); await settled(page)
  expect(await saved(page)).toMatchObject({ regionName: '天空', effect: 'dream_stars', regions: [] })
  await expect(page.getByLabel('删除当前区域')).toBeDisabled()
  for (let i = 0; i < 3; i++) await page.getByLabel('添加装饰区域').click()
  await expect(page.getByLabel('添加装饰区域')).toBeDisabled()
  await expect(page.locator('canvas')).toHaveCount(4)
  await page.getByRole('combobox', { name: '渲染性能' }).click()
  await expect(page.getByRole('option', { name: '流畅 · 120 帧', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.screenshot({ path: 'artifacts/regions-four.png' })
})

test('mask drawing, cancellation, centered resize, feather and persistence', async ({ page }) => {
  await page.goto('/#scene'); await settled(page)
  await page.getByRole('button', { name: '遮罩', exact: true }).click()
  const area = await page.getByLabel('遮罩绘制区域').boundingBox(); if (!area) throw new Error('No mask area')
  const drag = async () => { await page.mouse.move(area.x + area.width * .2, area.y + area.height * .2); await page.mouse.down(); await page.mouse.move(area.x + area.width * .5, area.y + area.height * .6, { steps: 5 }) }
  await drag(); await page.keyboard.press('Escape'); await page.mouse.up(); await settled(page)
  expect((await saved(page)).masks).toHaveLength(0)
  await drag(); await page.mouse.up(); await settled(page)
  const mask = (await saved(page)).masks[0]
  expect(mask.bounds.width).toBeCloseTo(.3, 2); expect(mask.bounds.y).toBeCloseTo(.2, 2)
  await page.getByRole('group', { name: '遮罩 1，方向键移动' }).focus(); await page.keyboard.press('ArrowRight'); await settled(page)
  expect((await saved(page)).masks[0].bounds.x).toBeCloseTo(mask.bounds.x + .002, 5)
  await page.getByLabel('缩放遮罩 1').focus(); await page.keyboard.press('ArrowRight'); await settled(page)
  const resized = (await saved(page)).masks[0]
  expect(resized.bounds.width).toBeCloseTo(mask.bounds.width + .004, 5)
  expect(resized.bounds.x + resized.bounds.width / 2).toBeCloseTo(mask.bounds.x + .002 + mask.bounds.width / 2, 5)
  await page.getByRole('slider', { name: '遮罩柔边' }).focus(); await page.keyboard.press('End'); await settled(page)
  await page.reload(); await settled(page)
  expect((await saved(page)).masks[0].feather).toBe(.08)
  await page.getByRole('button', { name: '遮罩', exact: true }).click()
  await expect(page.locator('.mask-box.selected')).toHaveCount(1)
  await page.getByLabel('删除当前遮罩').click(); await settled(page)
  expect((await saved(page)).masks).toHaveLength(0)
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: '添加遮罩', exact: true }).click()
  await expect(page.getByRole('button', { name: '添加遮罩', exact: true })).toBeDisabled()
  await page.getByLabel('删除当前遮罩').click(); await settled(page)
  await expect(page.locator('.mask-box.selected')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '选择遮罩 1', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'artifacts/masks-narrow.png', fullPage: true })
  await page.setViewportSize({ width: 1100, height: 650 })
  await page.getByLabel('放大预览').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.screenshot({ path: 'artifacts/masks-expanded.png' })
})

test('mask shader uses global top-left coordinates and produces real alpha feathering', async ({ page }) => {
  await page.goto('/#scene')
  const result = await page.evaluate(fragment => {
    const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100
    const gl = canvas.getContext('webgl2')!, program = gl.createProgram()!
    for (const [type, source] of [[gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}'], [gl.FRAGMENT_SHADER, fragment]] as [number, string][]) {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!)
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!)
    gl.useProgram(program); gl.viewport(0, 0, 100, 100)
    const u = (name: string) => gl.getUniformLocation(program, 'u_' + name)
    gl.uniform4fv(u('maskBounds[0]'), new Float32Array([.2, .1, .4, .4])); gl.uniform1fv(u('maskFeather[0]'), new Float32Array([.08])); gl.uniform1i(u('maskCount'), 1); gl.uniform2f(u('maskSize'), 100, 100)
    const sample = (x: number, y: number) => { const data = new Uint8Array(4); gl.readPixels(x, 99-y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data); return [...data] }
    gl.uniform4f(u('regionBounds'), 0, 0, 1, 1); gl.drawArrays(gl.TRIANGLES, 0, 3)
    const whole = { inside: sample(35, 25), feather: sample(23, 25), outside: sample(70, 25), below: sample(35, 75) }
    gl.uniform4f(u('regionBounds'), .2, .1, .4, .4); gl.drawArrays(gl.TRIANGLES, 0, 3)
    return { whole, offsetCenter: sample(50, 50), error: gl.getError() }
  }, withSceneMasks('#version 300 es\nprecision highp float;out vec4 outColor;void main(){outColor=vec4(1.);}'))
  expect(result.error).toBe(0); expect(result.whole.inside).toEqual([0, 0, 0, 0]); expect(result.offsetCenter).toEqual([0, 0, 0, 0])
  expect(result.whole.outside).toEqual([255, 255, 255, 255]); expect(result.whole.below[3]).toBe(255)
  expect(result.whole.feather[3]).toBeGreaterThan(0); expect(result.whole.feather[3]).toBeLessThan(255)
})

for (const effect of effectIds) test(`${effect}: disappears under a hard mask and recovers when removed`, async ({ page }) => {
  const sample = () => page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => new Promise<number>((resolve, reject) => {
    const gl = canvas.getContext('webgl2')!, draw = gl.drawArrays, instances = gl.drawElementsInstanced
    const restore = () => { gl.drawArrays = draw; gl.drawElementsInstanced = instances }
    const timer = setTimeout(() => { restore(); reject(new Error('No rendered frame')) }, 4000)
    let queued = false
    const read = () => {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        restore(); clearTimeout(timer)
        const data = new Uint8Array(canvas.width * canvas.height * 4)
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data)
        let alpha = 0; for (let i = 3; i < data.length; i += 4) alpha += data[i]
        resolve(alpha)
      })
    }
    gl.drawArrays = function (...args) { draw.apply(this, args); read() }
    gl.drawElementsInstanced = function (...args) { instances.apply(this, args); read() }
  }))
  await page.addInitScript(settings => localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings)), { ...defaults, effect, masks: [{ id: 'full', bounds: { x: 0, y: 0, width: 1, height: 1 }, feather: 0 }] })
  await page.goto('/#scene'); await settled(page)
  await setDemo(page)
  expect(await sample(), effect).toBe(0)
  await page.getByRole('button', { name: '遮罩', exact: true }).click(); await page.getByLabel('删除当前遮罩').click(); await settled(page)
  await expect.poll(sample, { timeout: 5000 }).toBeGreaterThan(0)
})

test('repeated expanded previews release detached contexts and keep every region rendering', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('/#scene'); await settled(page)
  for (let i = 0; i < 3; i++) await page.getByLabel('添加装饰区域').click()
  for (let i = 0; i < 5; i++) {
    await page.getByLabel('放大预览').click(); await page.getByLabel('关闭放大预览').click()
  }
  await expect(page.locator('canvas')).toHaveCount(4)
  await page.waitForTimeout(500)
  const lost = await page.locator('canvas').evaluateAll(canvases => canvases.map(canvas => (canvas as HTMLCanvasElement).getContext('webgl2')!.isContextLost()))
  expect(lost).toEqual([false, false, false, false])
  await expect(page.locator('.render-error')).toHaveCount(0); expect(errors).toEqual([])
})
