import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'
import { FrameBudget, drawingSize, budgets } from '../src/features/spectrum/render-budget'
import { selectChoice } from './helpers/choices'

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
const library = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.scene-library.v1') ?? '[]'))
const settled = (page: Page) => expect(page.getByText('已保存到此浏览器')).toBeVisible()
test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => {
    if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings))
  }, defaults)
})

test('unlimited frame pacing keeps pixel budgets and old configurations migrate', () => {
  const gate = new FrameBudget()
  for (let i = 0; i < 1000; i++) expect(gate.due(i / 10, 0)).toBe(true)
  expect(gate.due(100, 120)).toBe(true); expect(gate.due(102, 120)).toBe(false)
  for (const count of [1, 2, 4]) {
    const size = drawingSize(7680, 4320, 2, 'unlimited', count)
    expect(size.width * size.height * count).toBeLessThanOrEqual(budgets.unlimited.pixels)
  }
  expect(normalizeSettings({ effect: 'valley', quality: 'unlimited' })).toMatchObject({ effect: 'ripple', quality: 'unlimited', atmosphere: defaults.atmosphere })
  expect(normalizeSettings({ atmosphere: { wind: NaN, fog: -50, direction: 2000, lights: Infinity } })).toMatchObject({ atmosphere: { direction: 180, wind: 40, fog: 0, lights: 60 } })
})

test('custom quality menu retains 120 and unlimited for multiple source regions and works with keyboard', async ({ page }) => {
  await page.goto('/'); await settled(page)
  await page.getByRole('button', { name: '雪花飘舞', exact: false }).click()
  await page.getByLabel('添加装饰区域').click(); await settled(page)
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).find(name => name.includes('/src/features/spectrum/render-budget.ts'))!
    const { FrameBudget } = await import(path), original = FrameBudget.prototype.due
    ;(window as any).__fps = []
    FrameBudget.prototype.due = function(now: number, fps: number) { (window as any).__fps.push(fps); return original.call(this, now, fps) }
  })
  await selectChoice(page, '渲染性能', 'smooth'); await settled(page)
  await page.evaluate(() => { (window as any).__fps = [] })
  await expect.poll(() => page.evaluate(() => (window as any).__fps.length)).toBeGreaterThan(10)
  expect(await page.evaluate(() => [...new Set((window as any).__fps)])).toEqual([120])
  const trigger = page.getByRole('combobox', { name: '渲染性能' })
  await trigger.focus(); await page.keyboard.press('Enter')
  await expect(page.getByRole('option', { name: /不限制/ })).toBeVisible()
  const menu = await page.getByRole('listbox').boundingBox()
  expect(menu!.y).toBeGreaterThanOrEqual(0); expect(menu!.y + menu!.height).toBeLessThanOrEqual(840)
  await page.screenshot({ path: 'artifacts/quality-menu.png' })
  await page.keyboard.press('End')
  await expect(page.getByRole('option', { name: /不限制/ })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await saved(page)).quality).toBe('unlimited')
  await settled(page)
  await page.evaluate(() => { (window as any).__fps = [] })
  await expect.poll(() => page.evaluate(() => (window as any).__fps.length)).toBeGreaterThan(10)
  expect(await page.evaluate(() => [...new Set((window as any).__fps)])).toEqual([0])
  await page.reload(); await settled(page)
  await expect(trigger).toContainText('不限制')
  await trigger.click(); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused()
})

async function openLibrary(page: Page) {
  await page.getByRole('button', { name: '场景收藏', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存当前', exact: true })).toBeEnabled()
}
test('saved layouts restore on demand, preserve quality, undo and exchange without a wallpaper image', async ({ page }) => {
  await page.goto('/'); await settled(page)
  await page.getByRole('button', { name: '纯色预览背景' }).click()
  await page.getByRole('button', { name: '雪花飘舞', exact: false }).click(); await settled(page)
  const original = await saved(page)
  await openLibrary(page)
  await page.getByLabel('收藏名称').fill('我的晚风')
  await page.getByRole('button', { name: '保存当前', exact: true }).click()
  await expect(page.getByRole('button', { name: /我的晚风.*当前壁纸/ })).toBeVisible()
  expect((await library(page))[0].wallpaper).toMatch(/^v1-/)
  expect(await saved(page)).toEqual(original)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const file = await download, document = JSON.parse(await readFile((await file.path())!, 'utf8'))
  expect(document).toMatchObject({ format: 'SoundSpectra.scene', version: 1, name: '我的晚风' })
  expect(document.scene.music).toEqual(original.music)
  for (const field of ['enabled', 'quality', 'wallpaper', 'image']) expect(document.scene).not.toHaveProperty(field)
  await page.getByLabel('导入场景文件').setInputFiles({ name: 'scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...document, name: '导入的晚风' })) })
  await expect(page.getByRole('button', { name: /导入的晚风.*未关联壁纸/ })).toBeVisible()
  expect(await saved(page)).toEqual(original)
  await page.getByLabel('导入场景文件').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...document, version: 99 })) })
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('不是受支持')
  expect(await library(page)).toHaveLength(2)
  await page.getByRole('button', { name: '关闭场景收藏' }).click()
  await page.getByRole('button', { name: '浮光水母', exact: true }).click()
  await selectChoice(page, '渲染性能', 'unlimited'); await settled(page)
  const changed = await saved(page)
  await page.reload(); await settled(page)
  await openLibrary(page)
  await page.getByRole('button', { name: '当前壁纸', exact: true }).click()
  await expect(page.getByRole('button', { name: /导入的晚风.*未关联壁纸/ })).toHaveCount(0)
  await page.getByRole('button', { name: /我的晚风.*当前壁纸/ }).click()
  expect(await saved(page)).toEqual(changed)
  await page.getByRole('button', { name: '应用此场景', exact: true }).click(); await settled(page)
  expect(await saved(page)).toEqual({ ...original, quality: 'unlimited' })
  await page.getByRole('button', { name: '撤销搭配' }).click(); await settled(page)
  expect(await saved(page)).toEqual(changed)
})

test('library save failures, overwrite, duplicate, delete and recovery keep current desktop settings', async ({ page }) => {
  await page.goto('/'); await settled(page)
  await page.getByRole('button', { name: '纯色预览背景' }).click()
  const before = await saved(page)
  await openLibrary(page)
  await page.getByLabel('收藏名称').fill('第一份')
  await page.evaluate(() => {
    const original = Storage.prototype.setItem; (window as any).__failLibrary = true
    Storage.prototype.setItem = function(key, value) { if (key === 'soundspectra.scene-library.v1' && (window as any).__failLibrary) throw new Error('测试：存储已满'); return original.call(this, key, value) }
  })
  await page.getByRole('button', { name: '保存当前', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('存储已满')
  expect(await library(page)).toEqual([])
  await page.evaluate(() => { (window as any).__failLibrary = false })
  await page.getByRole('button', { name: '保存当前', exact: true }).click()
  await page.getByLabel('收藏名称').fill('改名后的收藏')
  await page.getByRole('button', { name: '保存当前', exact: true }).click()
  expect(await library(page)).toHaveLength(1)
  await page.getByRole('button', { name: '另存为', exact: true }).click()
  expect(await library(page)).toHaveLength(2)
  await page.getByRole('button', { name: '删除所选收藏' }).click()
  expect(await library(page)).toHaveLength(1)
  await page.getByRole('button', { name: '撤销删除' }).click()
  expect(await library(page)).toHaveLength(2)
  await page.getByRole('button', { name: '关闭场景收藏' }).click()
  await page.evaluate(() => localStorage.setItem('soundspectra.scene-library.v1', 'broken fixture'))
  await page.getByRole('button', { name: '场景收藏', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('读取失败')
  await expect(page.getByRole('button', { name: '保存当前', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '备份并重建' }).click()
  expect(await library(page)).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('soundspectra.scene-library.v1.backup.') && localStorage.getItem(key) === 'broken fixture'))).toBe(true)
  expect(await saved(page)).toEqual(before)
})

test('library and new menus remain reachable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 }); await page.goto('/'); await settled(page)
  await page.getByRole('button', { name: '纯色预览背景' }).click(); await openLibrary(page)
  await page.getByLabel('收藏名称').fill('窄屏场景')
  await page.getByRole('button', { name: '保存当前', exact: true }).click()
  await page.getByRole('button', { name: /窄屏场景.*当前壁纸/ }).click()
  const bounds = await page.getByRole('button', { name: '应用此场景' }).boundingBox()
  expect(bounds!.y + bounds!.height).toBeLessThan(700)
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: 'artifacts/library-narrow.png' })
  await page.getByRole('button', { name: '关闭场景收藏' }).click()
  await page.getByRole('combobox', { name: '渲染性能' }).click()
  await expect(page.getByRole('option', { name: /不限制/ })).toBeVisible()
  await page.screenshot({ path: 'artifacts/quality-narrow.png' })
})
