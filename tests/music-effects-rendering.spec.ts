import { expect, test, type Page } from '@playwright/test'
import { classicMusicEffects } from '../src/features/spectrum/music-engine/catalog'
import { defaults } from '../src/features/spectrum/model'
import { selectChoice } from './helpers/choices'

const pixels = async (page: Page) => {
  await page.bringToFront()
  return page.locator('.spectrum-surface canvas').first().evaluate((canvas: HTMLCanvasElement) => {
  const gl = canvas.getContext('webgl2')!
  return new Promise<{ visible: number; hash: number; error: number }>(resolve => {
    const arrays = gl.drawArrays, elements = gl.drawElements
    const arraysInstanced = gl.drawArraysInstanced, elementsInstanced = gl.drawElementsInstanced
    let queued = false, settled = false
    const read = () => {
      if (settled) return
      settled = true
      gl.drawArrays = arrays; gl.drawElements = elements
      gl.drawArraysInstanced = arraysInstanced; gl.drawElementsInstanced = elementsInstanced
      clearTimeout(timer)
      const data = new Uint8Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data)
      let visible = 0, hash = 2166136261
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 8) visible++
        hash = Math.imul(hash ^ data[i] ^ data[i + 1] ^ data[i + 2] ^ data[i + 3], 16777619)
      }
      resolve({ visible, hash, error: gl.getError() })
    }
    // Three first draws into its scene target, then composites into the canvas.
    // A microtask runs after both passes, rather than sampling an intermediate target.
    const timer = setTimeout(read, 1500)
    const after = () => { if (!queued) { queued = true; queueMicrotask(read) } }
    gl.drawArrays = function (...args) { arrays.apply(this, args); after() }
    gl.drawElements = function (...args) { elements.apply(this, args); after() }
    gl.drawArraysInstanced = function (...args) { arraysInstanced.apply(this, args); after() }
    gl.drawElementsInstanced = function (...args) { elementsInstanced.apply(this, args); after() }
  })
  })
}

for (const effect of classicMusicEffects) {
  test(`${effect.value}: spatial effect renders, moves, persists and fades to transparent`, async ({ page }, testInfo) => {
    test.setTimeout(45000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/')
    await page.getByRole('button', { name: effect.label, exact: true }).click()
    const canvas = page.locator('.three-scene-surface canvas').first()
    await expect(canvas).toHaveAttribute('data-renderer', 'three')
    await expect(canvas).toHaveAttribute('data-scene', effect.value)
    await expect(canvas).toHaveAttribute('data-geometry', 'spatial')
    await expect.poll(async () => (await pixels(page)).visible).toBeGreaterThan(30)
    const first = await pixels(page)
    expect(first.error).toBe(0)
    await expect.poll(async () => { const next = await pixels(page); return next.visible > 0 && next.hash !== first.hash }, { timeout: 8000 }).toBe(true)
    await expect(page.getByText('已保存到此浏览器')).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: effect.label, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await pixels(page)).visible).toBeGreaterThan(30)
    await page.screenshot({ path: testInfo.outputPath(`music-engine-${effect.value}.png`) })
    await page.getByRole('switch', { name: '模拟预览' }).click()
    await expect.poll(async () => (await pixels(page)).visible, { timeout: 6000 }).toBe(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('repeated spatial effect switches release prior Three contexts; effect parameters persist', async ({ page }) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  const canvas = page.locator('.three-scene-surface canvas').first()
  await expect(canvas).toHaveAttribute('data-renderer', 'three')
  const rememberContext = () => canvas.evaluate((node: HTMLCanvasElement) => {
    const store = window as unknown as { __spatialContexts?: WebGL2RenderingContext[] }
    const contexts = store.__spatialContexts ??= []
    const context = node.getContext('webgl2')!
    if (!contexts.includes(context)) contexts.push(context)
    return contexts.indexOf(context)
  })
  const liveContexts = () => page.evaluate(() => (window as unknown as { __spatialContexts: WebGL2RenderingContext[] }).__spatialContexts.filter(context => !context.isContextLost()).length)
  let previous = await rememberContext()
  for (let i = 0; i < 3; i++) {
    for (const [id, label] of [['volume_rain', '晴空浮游'], ['rhythm_balls', '浮光水母']]) {
      await page.getByRole('button', { name: label, exact: true }).click()
      await expect(canvas).toHaveAttribute('data-scene', id)
      await expect.poll(() => page.evaluate(index => (window as unknown as { __spatialContexts: WebGL2RenderingContext[] }).__spatialContexts[index].isContextLost(), previous)).toBe(true)
      previous = await rememberContext()
      await expect.poll(liveContexts).toBe(1)
      const before = Number(await canvas.getAttribute('data-frames'))
      await expect.poll(async () => Number(await canvas.getAttribute('data-frames'))).toBeGreaterThan(before)
      await expect.poll(async () => (await pixels(page)).visible).toBeGreaterThan(30)
    }
  }
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(errors).toEqual([])
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await page.getByText('造型细节', { exact: true }).click()
  const speed = page.getByRole('slider', { name: '伞体大小', exact: true })
  await speed.focus(); await speed.press('Home'); await speed.press('ArrowRight')
  await expect(speed).toHaveAttribute('aria-valuenow', '1.3')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.reload()
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await page.getByText('造型细节', { exact: true }).click()
  await expect(page.getByRole('slider', { name: '伞体大小', exact: true })).toHaveAttribute('aria-valuenow', '1.3')
})

test('spatial effects respect global masks and live silence', async ({ page }) => {
  await page.addInitScript(settings => {
    if (sessionStorage.getItem('music-engine-mask-seeded')) return
    localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings))
    sessionStorage.setItem('music-engine-mask-seeded', 'true')
  }, {
    ...defaults, effect: 'ripple', masks: [{ id: 'full', bounds: { x: 0, y: 0, width: 1, height: 1 }, feather: 0 }],
  })
  await page.goto('/')
  await page.waitForTimeout(250)
  expect((await pixels(page)).visible).toBe(0)
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('soundspectra.settings.v1')!)
    settings.masks = []; localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings))
  })
  await page.reload()
  await expect.poll(async () => (await pixels(page)).visible).toBeGreaterThan(30)
  await page.getByRole('switch', { name: '模拟预览' }).click()
  await expect.poll(async () => (await pixels(page)).visible, { timeout: 6000 }).toBe(0)
})

test('all performance presets render spatial scenes', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto('/')
  await page.getByRole('button', { name: '银河', exact: true }).click()
  for (const quality of ['eco', 'balanced', 'smooth', 'unlimited']) {
    await selectChoice(page, '渲染性能', quality)
    await expect.poll(async () => (await pixels(page)).visible).toBeGreaterThan(30)
  }
  expect((await pixels(page)).error).toBe(0)
})

for (const label of ['银河', '浮光水母']) test(`${label}: reduced-motion settles under constant input and still fades at silence`, async ({ page }) => {
  test.setTimeout(45000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: label, exact: true }).click()
  await expect.poll(async () => (await pixels(page)).visible).toBeGreaterThan(30)
  expect((await pixels(page)).error).toBe(0)
  let last = 0, stable = 0
  await expect.poll(async () => {
    const hash = (await pixels(page)).hash
    stable = hash === last ? stable + 1 : 0; last = hash
    return stable
  }, { timeout: 15000, intervals: [200] }).toBeGreaterThanOrEqual(2)
  await page.getByRole('switch', { name: '模拟预览' }).click()
  await expect.poll(async () => (await pixels(page)).visible, { timeout: 6000 }).toBe(0)
})
