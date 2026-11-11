import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page) {
  await page.goto('/tests/fixtures/palette-work.html')
  await expect(page.locator('output')).toContainText('#556677')
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame) })
}

test('unchanged fixed colors avoid extra React commits on visibility changes', async ({ page }) => {
  await fixture(page)
  const commits = await page.evaluate(async () => {
    const probe = (window as any).paletteWork
    probe.samples = []
    for (let index = 0; index < 6; index++) {
      probe.active(index % 2 === 1)
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
    }
    return probe.samples.length
  })
  console.log('palette commits for six visibility changes:', commits)
  expect(commits).toBe(6)
})

test('quantized palette steps publish only when the displayed RGB color changes', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => (window as any).paletteWork.configure({ followCover: true }))
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame) })
  await page.evaluate(() => {
    const probe = (window as any).paletteWork
    probe.configure({ color: '#566677' })
    probe.samples = []
  })
  await page.waitForTimeout(1250)
  const samples = await page.evaluate(() => (window as any).paletteWork.samples)
  console.log('React commits during a one-channel RGB transition:', samples.length)
  expect(samples).toEqual([{ primary: '#566677', regions: [{ id: 'secondary', color: '#667788' }] }])
})

test('region color changes and replacement are preserved and full transitions still animate', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => (window as any).paletteWork.region('secondary', '#998877'))
  await expect(page.locator('output')).toContainText('#998877')
  await page.evaluate(() => (window as any).paletteWork.region('replacement', '#aabbcc'))
  await expect(page.locator('output')).toContainText('replacement')
  await expect(page.locator('output')).not.toContainText('secondary')
  await page.evaluate(() => {
    const probe = (window as any).paletteWork
    probe.configure({ followCover: true, color: '#ccbbaa' })
    probe.samples = []
  })
  await page.waitForTimeout(1250)
  const samples = await page.evaluate(() => (window as any).paletteWork.samples)
  expect(new Set(samples.map((sample: any) => sample.primary)).size).toBeGreaterThan(3)
  expect(samples.at(-1)).toEqual({ primary: '#ccbbaa', regions: [{ id: 'replacement', color: '#aabbcc' }] })
  expect(samples.every((sample: any, index: number) => index === 0 || JSON.stringify(sample) !== JSON.stringify(samples[index - 1]))).toBe(true)
  const settled = samples.length
  await page.waitForTimeout(150)
  expect(await page.evaluate(() => (window as any).paletteWork.samples.length)).toBe(settled)
})
