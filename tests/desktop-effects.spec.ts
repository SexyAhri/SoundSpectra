import { settingsSection } from './helpers/module-settings'
import { expect, test } from '@playwright/test'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'
import { resizeBounds } from '../src/features/preview/preview-geometry'

test('fullscreen bounds are supported independently of the small music card bounds', () => {
  const settings = normalizeSettings({ ...defaults, bounds: { x: 0, y: 0, width: 1, height: 1 } })
  expect(settings.bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  expect(settings.desktopCard.bounds.height).toBeLessThanOrEqual(.24)
  expect(resizeBounds({ x: .1, y: .1, width: .8, height: .8 }, 1, 1)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
})

test('desktop layout actions persist full-height scenes and preserve the music card', async ({ page }) => {
  await page.goto('/')
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!)) ?? structuredClone(defaults)
  await page.getByRole('button', { name: '全屏展示当前灯效', exact: true }).click()
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
  await expect.poll(async () => (await saved()).bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  expect((await saved()).desktopCard).toEqual(before.desktopCard)
  await page.reload()
  await settingsSection(page, '位置')
  await page.getByText('精确位置', { exact: true }).click()
  await expect(page.getByRole('slider', { name: '高度', exact: true })).toHaveAttribute('aria-valuenow', '100')
  await expect(page.getByRole('slider', { name: '距顶部', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '应用中下部布局', exact: true }).click()
  await expect.poll(async () => (await saved()).bounds).toEqual({ x: .12, y: .7, width: .76, height: .22 })
})
