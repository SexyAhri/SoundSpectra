import { selectChoice } from './helpers/choices'
import { openDetails, settingsSection } from './helpers/module-settings'
import { test, expect } from '@playwright/test'
import { defaults } from '../src/features/spectrum/model'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => { if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings)) }, { ...defaults, regionVisible: false })
})

test('the inspector scrolls common controls while its heading, region and footer remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 620 })
  await page.goto('/#scene')
  const inspector = page.getByRole('complementary', { name: '对象属性' })
  await expect(inspector.getByRole('tab')).toHaveCount(3)
  await expect(page.getByRole('button', { name: '更换灯效', exact: true })).toBeVisible()
  await settingsSection(page, '外观')
  await page.getByRole('slider', { name: '不透明度', exact: true }).press('Home')
  await settingsSection(page, '位置')
  await page.getByRole('button', { name: '应用居中布局', exact: true }).click()
  await page.getByRole('button', { name: '默认朝向', exact: true }).scrollIntoViewIfNeeded()
  expect(await inspector.locator('.inspector-scroll').evaluate(node => node.scrollTop)).toBeGreaterThan(0)
  await expect(inspector.locator('.inspector-heading')).toBeInViewport()
  await expect(page.getByRole('combobox', { name: '当前装饰区域', exact: true })).toBeInViewport()
  await expect(page.locator('.workspace-footer')).toBeInViewport()
  await settingsSection(page, '外观')
  await page.getByRole('slider', { name: '不透明度', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('slider', { name: '不透明度', exact: true })).toHaveAttribute('aria-valuenow', '10')
  await page.setViewportSize({ width: 390, height: 844 })
  await settingsSection(page, '位置')
  await page.getByRole('button', { name: '默认朝向', exact: true }).scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('rename cancellation preserves the region and module switching keeps the edited region', async ({ page }) => {
  await page.goto('/#scene')
  await page.getByLabel('添加装饰区域').click()
  await page.getByLabel('重命名当前区域').click()
  await page.getByLabel('区域名称', { exact: true }).fill('不要保存')
  await page.getByLabel('区域名称', { exact: true }).press('Escape')
  await expect(page.getByRole('combobox', { name: '当前装饰区域' })).toContainText('区域 2')
  await page.getByLabel('重命名当前区域').click()
  const name = '山谷晚风与屋檐灯光的装饰区域名称'
  await page.getByLabel('区域名称', { exact: true }).fill(name)
  await page.getByLabel('区域名称', { exact: true }).press('Enter')
  await page.getByRole('button', { name: '歌词', exact: true }).click()
  await page.getByRole('button', { name: '灯效', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '当前装饰区域' })).toContainText(name)
  await selectChoice(page, '渲染性能', 'eco')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
  expect(saved.quality).toBe('eco'); expect(saved.regions[0].name).toBe(name)
})
