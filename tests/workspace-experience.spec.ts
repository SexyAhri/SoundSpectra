import { settingsSection } from './helpers/module-settings'
import { test, expect, type Page } from '@playwright/test'
import { defaults } from '../src/features/spectrum/model'
import { regionStyle } from '../src/features/spectrum/regions'
import { SettingsHistory } from '../src/features/settings/settings-history'
import { snapBounds } from '../src/features/preview/preview-geometry'

const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
async function openWorkspace(page: Page, patch: Record<string, unknown> = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(settings => localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings)), {
    ...defaults, regionVisible: false, quality: 'eco', ...patch,
  })
  await page.goto('/#scene')
  await expect(page.getByText('已保存到此浏览器', { exact: true })).toBeVisible()
  await expect(page.locator('.studio-shell')).not.toHaveAttribute('inert', '', { timeout: 15000 })
}

test('history groups a continuous adjustment, keeps live output and branches after undo', () => {
  const history = new SettingsHistory()
  const first = structuredClone(defaults), second = { ...first, opacity: 86 }, third = { ...second, opacity: 87 }
  history.record(first, second, false, 1000); history.record(second, third, false, 1100)
  const live = { ...third, enabled: true, quality: 'eco' as const, lyrics: { ...third.lyrics, folder: 'private-folder' } }
  const undone = { ...live, ...history.undo(live) }
  expect(undone.opacity).toBe(85)
  expect(undone.enabled).toBe(true); expect(undone.quality).toBe('eco'); expect(undone.lyrics.folder).toBe('private-folder')
  expect(history.canUndo).toBe(false); expect(history.canRedo).toBe(true)
  const redone = { ...undone, ...history.redo(undone) }
  expect(redone.opacity).toBe(87)
  history.undo(redone)
  history.record(undone, { ...undone, glow: 50 }, false, 2000)
  expect(history.canRedo).toBe(false)
  history.record(undone, { ...undone, wallpaperDepth: { ...undone.wallpaperDepth, revision: 'new-bitmap' } })
  expect(history.canUndo).toBe(false)
})

test('snapping respects screen pixel thresholds and object alignment', () => {
  const b = { x: .297, y: .101, width: .4, height: .2 }
  const centered = snapBounds(b, 1000, 600)
  expect(centered.bounds.x).toBeCloseTo(.3)
  expect(centered.x).toBe(.5)
  expect(centered.bounds.y).toBe(b.y)
  const distant = snapBounds({ ...b, x: .28 }, 1000, 600)
  expect(distant.bounds.x).toBe(.28)
  const aligned = snapBounds({ ...b, x: .397 }, 1000, 600, [{ x: .4, y: .7, width: .3, height: .2 }])
  expect(aligned.bounds.x).toBe(.4)
  expect(aligned.x).toBe(.4)
})

test('undo and redo persist edits while performance stays independently selected', async ({ page }) => {
  await openWorkspace(page)
  await settingsSection(page, '外观')
  const opacity = page.getByRole('slider', { name: '不透明度', exact: true })
  await opacity.press('ArrowRight'); await opacity.press('ArrowRight')
  await expect.poll(async () => (await stored(page)).opacity).toBe(87)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await expect.poll(async () => (await stored(page)).opacity).toBe(85)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await expect.poll(async () => (await stored(page)).opacity).toBe(87)
  await page.getByRole('combobox', { name: '渲染性能', exact: true }).click()
  await page.getByRole('option', { name: '流畅 · 120 帧', exact: true }).click()
  await expect.poll(async () => (await stored(page)).quality).toBe('smooth')
  await page.getByRole('button', { name: '灯效', exact: true }).click()
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await stored(page)).opacity).toBe(85)
  expect((await stored(page)).quality).toBe('smooth')
  await page.reload()
  expect((await stored(page)).opacity).toBe(85)
  await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeDisabled()
})

test('object list selects hidden overlapping objects and changes the correct region visibility', async ({ page }) => {
  await openWorkspace(page, { regions: [{ ...regionStyle(defaults), id: 'second', name: '区域 2', visible: false }] })
  await page.getByRole('button', { name: '布置', exact: true }).click()
  await page.locator('.preview-object-list summary').click()
  const objects = page.getByRole('group', { name: '桌面对象列表', exact: true })
  await objects.getByRole('button', { name: '选择区域 2', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '当前装饰区域' })).toContainText('区域 2')
  await objects.getByRole('button', { name: '显示区域 2', exact: true }).click()
  await expect.poll(async () => (await stored(page)).regions[0].visible).toBe(true)
  expect((await stored(page)).regionVisible).toBe(false)
  await objects.getByRole('button', { name: '选择歌词', exact: true }).click()
  await expect(page.getByRole('heading', { name: '歌词动效', exact: true })).toBeVisible()
  await objects.getByRole('button', { name: '显示歌词', exact: true }).click()
  await expect(page.getByRole('switch', { name: '显示桌面歌词', exact: true })).toBeChecked()
  await objects.getByRole('button', { name: '上移歌词图层', exact: true }).click()
  await expect.poll(async () => (await stored(page)).layerOrder.at(-1)).toBe('lyrics')
  await page.getByRole('button', { name: '放大预览', exact: true }).click()
  const expanded = page.getByRole('dialog')
  await expanded.locator('.preview-object-list summary').click()
  await expanded.getByRole('button', { name: '选择区域 2', exact: true }).click()
  await expect(expanded.locator('[data-preview-object="effect:second"]')).toHaveAttribute('data-selected', 'true')
  await page.keyboard.press('Escape')
})

test('guide and quick controls support keyboard, focus return and reversible scene switching', async ({ page }) => {
  await openWorkspace(page)
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog')).toContainText('浏览器预览')
  await page.getByRole('button', { name: '关闭工作台工具', exact: true }).click()
  await expect(page.getByRole('button', { name: '使用指南', exact: true })).toBeFocused()
  expect(await page.evaluate(() => localStorage.getItem('soundspectra.guide-seen.v1'))).toBe('1')
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('switch', { name: '快捷音乐视觉输出', exact: true })).toBeDisabled()
  await expect(page.getByRole('switch', { name: '快捷拾光绳输出', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '快速应用清浅专注', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('清浅专注')
  expect((await stored(page)).desktopCard.enabled).toBe(true)
  await page.getByRole('button', { name: '关闭工作台工具', exact: true }).click()
  await expect(page.getByRole('button', { name: '快捷控制', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await expect.poll(async () => (await stored(page)).desktopCard.enabled).toBe(false)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await expect.poll(async () => (await stored(page)).desktopCard.enabled).toBe(true)
})

test('scene search filters compositions and never applies a filtered-out selection', async ({ page }) => {
  await openWorkspace(page)
  await page.getByRole('button', { name: '场景收藏', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('searchbox', { name: '搜索场景', exact: true }).fill('专注')
  await expect(dialog.locator('.desktop-scene-choice')).toHaveCount(1)
  await dialog.locator('.desktop-scene-choice').click()
  await expect(dialog.getByRole('button', { name: '应用此场景', exact: true })).toBeEnabled()
  const beforeCompare = await stored(page)
  await dialog.getByRole('button', { name: '对比当前搭配', exact: true }).click()
  await expect(dialog.locator('.scene-preview-compare > span')).toHaveText('当前工作台')
  expect(await stored(page)).toEqual(beforeCompare)
  await dialog.getByRole('button', { name: '返回所选场景', exact: true }).click()
  await dialog.getByRole('searchbox', { name: '搜索场景', exact: true }).fill('无匹配结果')
  await expect(dialog.getByRole('button', { name: '应用此场景', exact: true })).toBeDisabled()
  await dialog.getByRole('searchbox', { name: '搜索场景', exact: true }).fill('')
  await dialog.getByRole('textbox', { name: '收藏名称', exact: true }).fill('我的专注桌面')
  await dialog.getByRole('button', { name: '保存当前', exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: '收藏排序', exact: true })).toBeVisible()
  await dialog.getByRole('searchbox', { name: '搜索场景', exact: true }).fill('不存在')
  await expect(dialog.getByText('没有找到匹配的场景，试试其他名称。')).toBeVisible()
})

test('card preview resizes with the keyboard and can restore its previous size', async ({ page }) => {
  await openWorkspace(page, { desktopCard: { ...defaults.desktopCard, enabled: true, variant: 'compact' } })
  await page.getByRole('button', { name: '布置', exact: true }).click()
  const resize = page.getByRole('button', { name: '缩放音乐卡片', exact: true })
  await resize.press('ArrowRight')
  await expect.poll(async () => (await stored(page)).desktopCard.bounds.width).toBeGreaterThan(defaults.desktopCard.bounds.width)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await expect.poll(async () => (await stored(page)).desktopCard.bounds.width).toBe(defaults.desktopCard.bounds.width)
})

test('lyric timing nudges have the correct sign and reset without changing layout', async ({ page }) => {
  await openWorkspace(page, { lyrics: { ...defaults.lyrics, enabled: true } })
  await page.getByRole('button', { name: '歌词', exact: true }).click()
  await page.getByRole('tab', { name: '同步与位置', exact: true }).click()
  await page.getByText('位置与高级设置', { exact: true }).click()
  await page.getByRole('button', { name: '提前 0.1 秒', exact: true }).click()
  await expect.poll(async () => (await stored(page)).lyrics.offsetMs).toBe(100)
  await page.getByRole('button', { name: '归零', exact: true }).click()
  await expect.poll(async () => (await stored(page)).lyrics.offsetMs).toBe(0)
  await page.getByRole('button', { name: '延后 0.1 秒', exact: true }).click()
  await expect.poll(async () => (await stored(page)).lyrics.offsetMs).toBe(-100)
  expect((await stored(page)).lyrics.bounds).toEqual(defaults.lyrics.bounds)
})

test('guide and quick controls fit narrow and short windows in both themes', async ({ page }) => {
  await openWorkspace(page)
  for (const theme of ['light','dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    for (const [width,height] of [[900,620],[390,520]]) {
      await page.setViewportSize({ width,height })
      for (const name of ['使用指南','快捷控制']) {
        await page.getByRole('button', { name, exact: true }).click()
        const dialog = page.getByRole('dialog')
        expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
        await expect(dialog.getByRole('button', { name:'关闭工作台工具',exact:true })).toBeInViewport()
        await dialog.locator('.workspace-tools-body').evaluate(el => { el.scrollTop = el.scrollHeight })
        await expect(dialog.getByRole('button', { name:'关闭工作台工具',exact:true })).toBeInViewport()
        await page.keyboard.press('Escape')
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
  }
})
