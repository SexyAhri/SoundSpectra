import { expect, test } from '@playwright/test'
import { defaults } from '../src/features/spectrum/model'
import type { RailSettings } from '../src/features/rail/model'

const initial: RailSettings = { version: 1, enabled: false, groups: [
  { id: 'apps', name: '日常工具', x: .03, y: .1, width: .94, collapsed: false, items: [
    { id: 'editor', name: '编辑器', kind: 'app', path: 'C:/editor.exe', crop: 'cover' },
    { id: 'note', name: '今天的灵感', kind: 'note', path: '', crop: 'cover', text: '音乐响起，留住此刻。' },
    { id: 'file', name: '歌单.txt', kind: 'file', path: 'C:/song.txt', crop: 'cover' },
  ] },
  { id: 'work', name: '工作资料', x: .1, y: .5, width: .8, collapsed: false, skin: 'woodland', items: [] },
] }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ settings, rail }) => {
    if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings))
    if (!localStorage.getItem('soundspectra.rail.v1')) localStorage.setItem('soundspectra.rail.v1', JSON.stringify(rail))
  }, { settings: { ...defaults, regionVisible: false }, rail: initial })
})

test('skin changes persist per group while cancel and legacy loading preserve data', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/#rail')
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  const surface = page.locator('.rail-wheel').first()
  await expect(surface).toHaveAttribute('data-rail-skin', 'floral')
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.rail.v1')!) as RailSettings)
  const before = await stored()
  const musicBefore = await page.evaluate(() => localStorage.getItem('soundspectra.settings.v1'))
  const open = page.getByRole('button', { name: '更换拾光绳皮肤' })
  await open.click()
  await page.getByRole('button', { name: '关闭拾光绳皮肤选择' }).click()
  expect(await stored()).toEqual(before)
  for (const [skin, name] of [['woodland', '原木拾光'], ['wisteria', '紫藤轻垂'], ['autumn', '秋枝来信'], ['floral', '花间小径']] as const) {
    await open.click()
    await page.getByRole('button', { name, exact: true }).press('Enter')
    await expect(page.getByRole('dialog', { name: '选择拾光绳皮肤' })).toHaveCount(0)
    await expect(surface).toHaveAttribute('data-rail-skin', skin)
    const ropeMaterials = await page.evaluate(() => ['.rail-wheel', '.module-style-thumbnail .rail-skin-preview'].map(selector => {
      const root = document.querySelector(selector)!
      const rope = root.querySelector('.rail-braid-strand, .rail-branch-main, .rail-themed-thread')!
      const style = getComputedStyle(rope)
      const unit = parseFloat(getComputedStyle(root).getPropertyValue('--rail-unit'))
      return { stroke: style.stroke, width: parseFloat(style.strokeWidth) / unit }
    }))
    expect(ropeMaterials[0].stroke).toBe(ropeMaterials[1].stroke)
    expect(ropeMaterials[0].width).toBeCloseTo(ropeMaterials[1].width, 4)
    await expect.poll(async () => (await stored()).groups[0].skin).toBe(skin)
    const next = await stored()
    expect(next.groups[0]).toEqual({ ...before.groups[0], skin })
    expect(next.groups[1]).toEqual(before.groups[1])
    await page.reload()
    await page.getByRole('tab', { name: '外观', exact: true }).click()
    await expect(surface).toHaveAttribute('data-rail-skin', skin)
  }
  await page.getByRole('combobox', { name: '当前拾光绳', exact: true }).click()
  await page.getByRole('option').filter({ hasText: '工作资料' }).click()
  await expect(page.getByRole('group', { name: '当前拾光绳皮肤', exact: true })).toContainText('原木拾光')
  expect(await page.evaluate(() => localStorage.getItem('soundspectra.settings.v1'))).toBe(musicBefore)
})

test('four skins remain readable in both themes and the chooser fits narrow screens', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/#rail')
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    for (const [skin, name] of [['floral', '花间小径'], ['wisteria', '紫藤轻垂'], ['autumn', '秋枝来信']] as const) {
      await page.getByRole('button', { name: '更换拾光绳皮肤' }).click()
      await page.getByRole('button', { name, exact: true }).click()
      const surface = page.locator('.rail-wheel').first()
      await expect(surface).toHaveAttribute('data-rail-skin', skin)
      const tag = surface.locator('.rail-file .rail-item')
      await expect(tag).toHaveCSS('color', { floral: 'rgb(96, 84, 62)', wisteria: 'rgb(86, 81, 94)', autumn: 'rgb(90, 64, 49)' }[skin])
      await expect(surface.locator('.rail-note-content')).toHaveCSS('color', { floral: 'rgb(105, 93, 68)', wisteria: 'rgb(96, 86, 105)', autumn: 'rgb(102, 80, 55)' }[skin])
      await surface.screenshot({ path: `artifacts/floral-rail/skin-${skin}-${theme}.png` })
    }
  }
  for (const size of [{ width: 1280, height: 840 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size)
    await page.getByRole('button', { name: '更换拾光绳皮肤' }).click()
    const dialog = page.getByRole('dialog', { name: '选择拾光绳皮肤' })
    await expect(dialog.locator('.module-style-option')).toHaveCount(4)
    await expect(dialog).toBeInViewport({ ratio: 1 })
    const box = (await dialog.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(size.width)
    expect(box.y + box.height).toBeLessThanOrEqual(size.height)
    await dialog.screenshot({ path: `artifacts/floral-rail/skin-chooser-${size.width}.png` })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  }
})
