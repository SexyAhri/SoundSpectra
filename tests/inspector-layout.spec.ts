import { selectChoice } from './helpers/choices'
import { test, expect } from '@playwright/test'

test('inspector separates workflows and keeps region and performance controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 })
  await page.goto('/')
  const inspector = page.getByRole('complementary', { name: '频谱设置' })
  await expect(page.getByRole('tab', { name: '动效', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: '浮光水母', exact: true })).toBeVisible()
  await expect(page.getByRole('slider', { name: '漂游速度', exact: true })).toHaveCount(0)
  expect((await inspector.boundingBox())!.width).toBe(380)
  await page.screenshot({ path: 'artifacts/inspector-effects-1440.png' })
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await page.getByRole('slider', { name: '不透明度', exact: true }).focus()
  await page.keyboard.press('Home')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.screenshot({ path: 'artifacts/inspector-appearance-1440.png' })
  await page.setViewportSize({ width: 1000, height: 620 })
  await page.getByRole('button', { name: '恢复当前灯效参数' }).scrollIntoViewIfNeeded()
  const layout = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth,
    scrolled: document.querySelector('.inspector-scroll')!.scrollTop,
    region: document.querySelector('.region-panel')!.getBoundingClientRect().top,
    quality: document.querySelector('.inspector-performance')!.getBoundingClientRect().bottom,
  }))
  expect(layout.height).toBeLessThanOrEqual(620); expect(layout.width).toBeLessThanOrEqual(1000)
  expect(layout.scrolled).toBeGreaterThan(0); expect(layout.region).toBeGreaterThan(48); expect(layout.quality).toBeLessThanOrEqual(620)
  await page.getByRole('tab', { name: '位置', exact: true }).click()
  await page.getByRole('button', { name: '应用居中布局' }).click()
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await expect(page.getByRole('slider', { name: '不透明度', exact: true })).toHaveAttribute('aria-valuenow', '10')
  await page.screenshot({ path: 'artifacts/inspector-short.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('combobox', { name: '渲染性能' }).scrollIntoViewIfNeeded()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'artifacts/inspector-narrow.png', fullPage: true })
})

test('rename is explicit, cancel preserves the name and tabs retain the selected region', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('添加装饰区域').click()
  await page.getByLabel('重命名当前区域').click()
  await page.getByLabel('区域名称', { exact: true }).fill('不要保存')
  await page.getByLabel('区域名称', { exact: true }).press('Escape')
  await expect(page.getByRole('combobox', { name: '当前装饰区域' })).toContainText('区域 2')
  await page.getByLabel('重命名当前区域').click()
  const name = '山谷晚风与屋檐灯光的装饰区域名称'
  await page.getByLabel('区域名称', { exact: true }).fill(name)
  await page.getByLabel('区域名称', { exact: true }).press('Enter')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.getByRole('tab', { name: '外观', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '位置', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('combobox', { name: '当前装饰区域' })).toContainText(name)
  await selectChoice(page, '渲染性能', 'eco')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
  expect(saved.quality).toBe('eco'); expect(saved.regions[0].name).toBe(name)
})
