import { expect, test } from '@playwright/test'

test('render diagnostics publish changes without repeatedly mutating equal attributes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/tests/fixtures/canvas-work.html')
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-scene', 'aurora_flow')
  await expect.poll(() => canvas.getAttribute('data-frames').then(Number)).toBeGreaterThan(10)
  const work = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas')!
    const first = Number(canvas.dataset.frames)
    let repeated = 0
    const attributes = ['data-occluded', 'data-transporting', 'data-resize-paused', 'data-programs', 'data-scene', 'data-transition', 'data-transition-progress', 'data-focus', 'data-focus-cue', 'data-draw-calls', 'data-geometries', 'data-textures', 'data-bloom-levels', 'data-render-scale', 'data-scene-buffer']
    const observer = new MutationObserver(records => {
      for (const record of records) if (record.oldValue === canvas.getAttribute(record.attributeName!)) repeated++
    })
    observer.observe(canvas, { attributes: true, attributeOldValue: true, attributeFilter: attributes })
    const deadline = performance.now() + 12000
    while (Number(canvas.dataset.frames) < first + 12 && performance.now() < deadline) await new Promise(requestAnimationFrame)
    observer.disconnect()
    return { repeated, frames: Number(canvas.dataset.frames) - first }
  })
  console.log('diagnostic writes repeating identical values:', work)
  expect(work.frames).toBeGreaterThanOrEqual(12)
  expect(work.repeated).toBe(0)
  await page.evaluate(() => (window as any).canvasWork.suspend(true))
  await expect(canvas).toHaveAttribute('data-occluded', 'true')
  const frames = Number(await canvas.getAttribute('data-frames'))
  await page.waitForTimeout(150)
  expect(Number(await canvas.getAttribute('data-frames'))).toBe(frames)
  await page.evaluate(() => (window as any).canvasWork.suspend(false))
  await expect(canvas).toHaveAttribute('data-occluded', 'false')
  await expect.poll(() => canvas.getAttribute('data-frames').then(Number)).toBeGreaterThan(frames)
  expect(errors).toEqual([])
})

test('paused rehearsal avoids repeated text writes while playback and seeking remain live', async ({ page }) => {
  await page.goto('/tools/performance-lab.html')
  const output = page.locator('.performance-preview output')
  await expect(output).toContainText('0.0 /')
  const repeated = await page.evaluate(async () => {
    const output = document.querySelector('.performance-preview output')!
    let mutations = 0
    const observer = new MutationObserver(records => { mutations += records.length })
    observer.observe(output, { childList: true, characterData: true, subtree: true })
    for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame)
    observer.disconnect()
    return mutations
  })
  console.log('paused rehearsal text mutations in 12 frames:', repeated)
  expect(repeated).toBe(0)
  await page.getByRole('button', { name: '播放预演', exact: true }).click()
  await expect(output).not.toContainText('0.0 /')
  await page.getByRole('button', { name: '暂停预演', exact: true }).click()
  await page.getByLabel('预演播放头').fill('12000')
  await expect(output).toContainText('12.0 /')
  await page.getByRole('button', { name: '回到开头', exact: true }).click()
  await expect(output).toContainText('0.0 /')
})
