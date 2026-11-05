import { expect, test } from '@playwright/test'
import { defaults } from '../src/features/spectrum/model'

const stored = (page: import('@playwright/test').Page) => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))

test('global editors have their own scope and preserve the selected effect region', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 })
  await page.goto('/')
  await page.getByLabel('添加装饰区域', { exact: true }).click()
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  const before = await stored(page)
  await page.getByRole('button', { name: '歌词', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '当前装饰区域' })).toHaveCount(0)
  await expect(page.getByRole('switch', { name: '显示桌面音乐卡片' })).toHaveCount(0)
  await page.getByRole('switch', { name: '显示桌面歌词' }).click()
  await expect(page.getByText('已保存到此浏览器', { exact: true })).toBeVisible()
  expect((await stored(page)).regions).toEqual(before.regions)
  await page.getByRole('button', { name: '音乐卡片', exact: true }).click()
  await expect(page.getByRole('switch', { name: '显示桌面歌词' })).toHaveCount(0)
  await expect(page.getByRole('switch', { name: '显示桌面音乐卡片' })).toBeVisible()
  await page.getByRole('button', { name: '壁纸', exact: true }).click()
  await expect(page.getByRole('switch', { name: '立体壁纸', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '当前装饰区域' })).toHaveCount(0)
  await page.getByRole('button', { name: '灯效', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '当前装饰区域' })).toContainText('区域 2')
  await expect(page.getByRole('tab', { name: '外观', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: '歌词', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: '歌词', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('switch', { name: '显示桌面歌词' })).toBeChecked()
})

test('preview and transport stay visible while each inspector scrolls independently', async ({ page }) => {
  await page.addInitScript(settings => localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings)), {
    ...defaults, effect: 'dream_stars', sceneMode: 'immersive', opacity: 100, bounds: { x: 0, y: 0, width: 1, height: 1 },
    lyrics: { ...defaults.lyrics, enabled: true },
  })
  await page.setViewportSize({ width: 1440, height: 940 })
  await page.goto('/')
  await expect.poll(() => page.locator('.three-scene-surface canvas').first().getAttribute('data-frames')).not.toBeNull()
  for (const [width, height] of [[1440, 940], [1000, 620], [900, 620]]) {
    await page.setViewportSize({ width, height })
    for (const name of ['灯效', '歌词', '音乐卡片', '壁纸']) {
      await page.getByRole('button', { name, exact: true }).click()
      if (width === 1440 && name === '歌词') await page.screenshot({ path: 'artifacts/workspace-overview.png' })
      if (name === '歌词') { await page.getByText('位置与同步', { exact: true }).click(); await page.getByRole('button', { name: '恢复歌词位置与同步' }).scrollIntoViewIfNeeded() }
      if (name === '音乐卡片') await page.getByRole('button', { name: '恢复卡片位置' }).scrollIntoViewIfNeeded()
      const geometry = await page.evaluate(() => {
        const main = document.querySelector('.main-pane')!, footer = document.querySelector('.workspace-footer')!.getBoundingClientRect()
        const preview = document.querySelector('.desktop-preview')!.getBoundingClientRect()
        return { documentHeight: document.documentElement.scrollHeight, documentWidth: document.documentElement.scrollWidth,
          mainHeight: main.clientHeight, mainScroll: main.scrollHeight, footerBottom: footer.bottom, previewTop: preview.top, previewBottom: preview.bottom, previewWidth: preview.width }
      })
      expect(geometry.documentHeight).toBeLessThanOrEqual(height)
      expect(geometry.documentWidth).toBeLessThanOrEqual(width)
      expect(geometry.mainScroll).toBeLessThanOrEqual(geometry.mainHeight)
      expect(geometry.footerBottom).toBeLessThanOrEqual(height)
      expect(geometry.previewBottom).toBeLessThanOrEqual(height - 60)
      expect(geometry.previewTop).toBeGreaterThan(54)
      expect(geometry.previewWidth).toBeGreaterThan(width === 1440 ? 850 : 440)
      if (width === 1440 && ['灯效', '歌词'].includes(name)) await page.screenshot({ path: `artifacts/workspace-${name === '歌词' ? 'lyrics' : 'effects'}-1440.png` })
    }
  }
  await page.getByRole('button', { name: '歌词', exact: true }).click()
  expect(await page.locator('.inspector-scroll').evaluate(node => node.scrollTop)).toBe(0)
  await page.screenshot({ path: 'artifacts/workspace-short-900.png' })
})
