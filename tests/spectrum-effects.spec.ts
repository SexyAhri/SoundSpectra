import { setDemo } from './helpers/demo'
import { settingsSection } from './helpers/module-settings'
import { selectChoice } from './helpers/choices'
import { test, expect, type Page } from '@playwright/test'
import { budgets, drawingSize, FrameBudget } from '../src/features/spectrum/render-budget'
import { normalizeSettings } from '../src/features/spectrum/model'

test('render budgets limit high-DPI surfaces and high-refresh drawing', () => {
  for (const quality of ['eco', 'balanced', 'smooth'] as const) {
    const size = drawingSize(7680, 2160, 3, quality)
    expect(size.width * size.height).toBeLessThanOrEqual(budgets[quality].pixels)
    expect(size.width).toBeLessThanOrEqual(4096)
    const gate = new FrameBudget()
    let draws = 0
    for (let i = 0; i < 2400; i++) if (gate.due(i * 1000 / 240, budgets[quality].fps)) draws++
    expect(draws).toBeLessThanOrEqual(budgets[quality].fps * 10 + 1)
    expect(draws).toBeGreaterThanOrEqual(budgets[quality].fps * 10 - 1)
    expect(gate.due(100_000, budgets[quality].fps)).toBe(true)
    expect(gate.due(100_001, budgets[quality].fps)).toBe(false)
  }
  expect(normalizeSettings({ color: '#205aee' })).toMatchObject({ color: '#205aee', effect: 'rhythm_balls', quality: 'balanced' })
})

const visiblePixels = (page: Page) => page.locator('.three-scene-surface canvas').first().evaluate((canvas: HTMLCanvasElement) => {
  const gl = canvas.getContext('webgl2')!
  return new Promise<number>(resolve => {
    const draw = gl.drawArrays
    const read = () => {
      gl.drawArrays = draw
      clearTimeout(timer)
      if (gl.getParameter(gl.FRAMEBUFFER_BINDING) !== null) { resolve(0); return }
      const data = new Uint8Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data)
      let count = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) count++
      resolve(count)
    }
    // Read on an actual draw: a discarded default framebuffer can otherwise
    // produce false zeroes when rAF runs faster than the selected frame budget.
    const timer = setTimeout(read, 150)
    gl.drawArrays = function (...args) {
      draw.apply(this, args)
      // Bloom draws to intermediate floating-point targets first. Sample only
      // the final composite after it reaches the canvas's default framebuffer.
      if (gl.getParameter(gl.FRAMEBUFFER_BINDING) === null) read()
    }
  })
})

test('idle, obscured previews and offscreen previews stop drawing; quality remains saved', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await selectChoice(page, '渲染性能', 'eco')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.reload(); await setDemo(page)
  await expect(page.getByRole('combobox', { name: '渲染性能' })).toContainText('省电 · 30 帧')
  const canvas = page.locator('.three-scene-surface canvas').first()
  await expect(canvas).toHaveAttribute('data-frames', /^\d+$/)
  const sampleFrames = () => canvas.evaluate(async node => {
    // Sample both ends in the renderer process: CI protocol/CPU latency must
    // not turn a 600 ms test-side timer into a longer unmeasured frame window.
    const start = performance.now(), first = Number(node.dataset.frames)
    await new Promise(resolve => setTimeout(resolve, 600))
    return { frames: Number(node.dataset.frames) - first, elapsed: performance.now() - start }
  })
  const sample = await sampleFrames()
  expect(sample.frames).toBeLessThanOrEqual(Math.ceil(sample.elapsed * 30 / 1000) + 2)
  await page.getByRole('switch', { name: '模拟预览' }).click()
  await page.waitForTimeout(2200)
  expect((await sampleFrames()).frames).toBe(0)
  await page.getByRole('switch', { name: '模拟预览' }).click()
  await expect.poll(() => visiblePixels(page)).toBeGreaterThan(80)
  await page.getByRole('button', { name: '应用设置与更新', exact: true }).click()
  await page.waitForTimeout(300)
  expect((await sampleFrames()).frames).toBe(0)
  await page.getByRole('button', { name: '收起应用设置', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 600 })
  await settingsSection(page, '动效')
  await page.getByRole('button', { name: '恢复当前灯效参数' }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  // At the mobile breakpoint the page flows normally and this scroll hides the preview.
  expect((await sampleFrames()).frames).toBe(0)
  await canvas.scrollIntoViewIfNeeded()
  // Default WebGL buffers may be discarded between the 30 fps draws and
  // 60 Hz test callbacks. Verify resumed draw calls instead of that race.
  const pausedAt = Number(await canvas.getAttribute('data-frames'))
  await expect.poll(async () => Number(await canvas.getAttribute('data-frames'))).toBeGreaterThan(pausedAt + 1)
})
