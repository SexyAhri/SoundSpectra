import { expect, test } from '@playwright/test'
import { defaults } from '../src/features/spectrum/model'
import { clickCord } from './rail-helpers'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => {
    localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings))
    localStorage.setItem('soundspectra.rail.v1', JSON.stringify({ version: 1, enabled: false, groups: [{ id: 'apps', name: '日常工具', x: .07, y: .12, width: .86, collapsed: false, items: Array.from({ length: 12 }, (_, index) => ({ id: `item-${index}`, name: `工具 ${index + 1}`, kind: index === 2 ? 'image' : 'app', path: index === 2 ? 'C:/photo.png' : `C:/apps/${index}.exe`, crop: 'cover' })) }] }))
  }, { ...defaults, regionVisible: false })
})

test('selected item follows the arc into the middle and hidden slots cannot intercept input', async ({ page }) => {
  await page.goto('/#rail')
  await page.locator('.startup-screen').waitFor({ state: 'hidden' })
  const surface = page.locator('.rail-surface')
  const active = surface.locator('.rail-items > [data-wheel-active=true]')
  await expect(active).toHaveAttribute('data-rail-item', 'item-0')
  const centered = async () => {
    const box = (await surface.boundingBox())!, item = (await active.boundingBox())!
    return Math.abs(item.x + item.width / 2 - box.x - box.width / 2)
  }
  await expect.poll(centered).toBeLessThan(2)
  const adjacent = surface.locator('.rail-items > [data-rail-item="item-1"] .rail-item')
  await adjacent.click()
  await expect(active).toHaveAttribute('data-rail-item', 'item-1')
  await expect.poll(centered).toBeLessThan(2)
  await expect(surface.locator('.rail-items > [data-rail-item="item-6"]')).toHaveAttribute('inert', '')
  await page.locator('[data-control-item="item-8"] .rail-control-select').click()
  await expect(active).toHaveAttribute('data-rail-item', 'item-8')
  await expect.poll(centered).toBeLessThan(2)
  await page.screenshot({ path: 'artifacts/rail-wheel-desktop.png' })
})

test('right click centers a hanging without opening its operations panel', async ({ page }) => {
  await page.goto('/#rail')
  await page.locator('.startup-screen').waitFor({ state: 'hidden' })
  const surface = page.locator('.rail-surface')
  const item = surface.locator('[data-rail-item="item-1"]')
  await item.locator('.rail-item').click({ button: 'right' })
  await expect(item).toHaveAttribute('data-wheel-active', 'true')
  await expect(item.locator('.rail-item')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.rail-popup-menu')).toHaveCount(0)
  await expect.poll(async () => {
    const host = (await surface.boundingBox())!, card = (await item.boundingBox())!
    return Math.abs(card.x + card.width / 2 - host.x - host.width / 2)
  }).toBeLessThan(2)
  await item.locator('.rail-item-menu').click()
  await expect(page.locator('.rail-popup-menu')).toBeVisible()
})

test('wheel, keyboard, wrapping and removal always keep an available item centered', async ({ page }) => {
  await page.goto('/#rail')
  await page.locator('.startup-screen').waitFor({ state: 'hidden' })
  const active = page.locator('.rail-items > [data-wheel-active=true]')
  await active.locator('.rail-item').press('ArrowLeft')
  await expect(active).toHaveAttribute('data-rail-item', 'item-11')
  await active.locator('.rail-item').press('ArrowRight')
  await expect(active).toHaveAttribute('data-rail-item', 'item-0')
  await active.getByRole('button', { name: '工具 1，软件', exact: true }).press('ArrowRight')
  await expect(active).toHaveAttribute('data-rail-item', 'item-1')
  await active.hover()
  const scrollTop = await page.locator('.main-pane').evaluate(node => node.scrollTop)
  await page.mouse.wheel(0, 70)
  await expect(active).toHaveAttribute('data-rail-item', 'item-2')
  expect(await page.locator('.main-pane').evaluate(node => node.scrollTop)).toBe(scrollTop)
  await page.getByRole('button', { name: '取消挂载', exact: true }).click()
  await expect(page.locator('.rail-items > [data-rail-item="item-2"]')).toHaveCount(0)
  await expect(active).toHaveCount(1)
  await expect(active).toHaveAttribute('data-rail-item', 'item-3')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await active.locator('.rail-item').press('ArrowRight')
  expect(await active.evaluate(node => parseFloat(getComputedStyle(node).transitionDuration))).toBe(.38)
})

test('arc remains contained on narrow screens and its add menu stays accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#rail')
  await page.locator('.startup-screen').waitFor({ state: 'hidden' })
  await expect(page.locator('.rail-wheel')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '点击绳子添加挂件', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: '添加挂件', exact: true })).toBeVisible()
  const panel = page.getByRole('region', { name: '添加挂件', exact: true })
  const bounds = (await panel.boundingBox())!
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844)
  const note = panel.getByRole('button', { name: /写便签/ })
  await note.click()
  await expect(panel.getByRole('textbox', { name: '便签内容', exact: true })).toBeVisible()
  await page.screenshot({ path: 'artifacts/rail-wheel-mobile.png', fullPage: true })
})

test('all items use equal tiles and choosing one closes the panel and centers it', async ({ page }) => {
  await page.goto('/#rail')
  await page.locator('.startup-screen').waitFor({ state: 'hidden' })
  await clickCord(page, true)
  const panel = page.getByRole('region', { name: '更多挂件', exact: true })
  const tiles = panel.locator('.rail-overflow-entry')
  await expect(tiles).toHaveCount(12)
  const sizes = await tiles.evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return [Math.round(box.width), Math.round(box.height)] }))
  expect(new Set(sizes.map(size => size.join('x'))).size).toBe(1)
  await expect(panel.locator('.rail-hanging')).toHaveCount(0)
  await page.screenshot({ path: 'artifacts/rail-overflow-grid.png' })
  await panel.getByRole('button', { name: '选择工具 9，软件', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.locator('[data-wheel-active=true]')).toHaveAttribute('data-rail-item', 'item-8')
})

test('cord single and double clicks open separate panels without a navigation strip in either theme', async ({ page }) => {
  await page.goto('/#rail')
  await page.locator('.startup-screen').waitFor({ state: 'hidden' })
  await expect(page.locator('.rail-wheel-nav, .rail-more')).toHaveCount(0)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    await clickCord(page, true)
    const list = page.getByRole('region', { name: '更多挂件', exact: true })
    await expect(list).toBeVisible()
    await expect(page.getByRole('region', { name: '添加挂件', exact: true })).toHaveCount(0)
    await list.screenshot({ path: `artifacts/rail-list-${theme}.png` })
    await page.getByRole('button', { name: '关闭挂件面板' }).click()
    await clickCord(page)
    await expect(page.getByRole('region', { name: '添加挂件', exact: true })).toBeVisible()
    await expect(list).toHaveCount(0)
    await page.getByRole('button', { name: '关闭挂件面板' }).click()
  }
})

test('rotation restores the centered item after reload and falls back when that item is removed', async ({ page }) => {
  await page.goto('/#rail')
  await page.locator('.startup-screen').waitFor({ state: 'hidden' })
  await clickCord(page, true)
  await page.getByRole('button', { name: '选择工具 9，软件', exact: true }).click()
  const active = page.locator('.rail-items > [data-wheel-active=true]:not([inert])')
  await expect(active).toHaveAttribute('data-rail-item', 'item-8')
  const stored = await page.evaluate(() => localStorage.getItem('soundspectra.rail.v1'))
  await page.reload()
  await expect(active).toHaveAttribute('data-rail-item', 'item-8')
  expect(await page.evaluate(() => localStorage.getItem('soundspectra.rail.v1'))).toBe(stored)
  await page.evaluate(() => {
    const key = 'soundspectra.rail.v1'
    const settings = JSON.parse(localStorage.getItem(key)!)
    settings.groups[0].items = settings.groups[0].items.filter((item: { id: string }) => item.id !== 'item-8')
    localStorage.setItem(key, JSON.stringify(settings))
    window.dispatchEvent(new Event('rail-browser-changed'))
  })
  await expect(active).toHaveAttribute('data-rail-item', 'item-9')
  expect(await page.evaluate(() => localStorage.getItem('soundspectra.rail.selection.apps'))).toBe('item-9')
})

test('all-items search finds names and paths, supports clearing, and keeps long names and empty states usable', async ({ page }) => {
  await page.goto('/#rail')
  await page.locator('.startup-screen').waitFor({ state: 'hidden' })
  await clickCord(page, true)
  const panel = page.getByRole('region', { name: '更多挂件', exact: true })
  const search = panel.getByRole('searchbox', { name: '搜索挂件' })
  await search.fill('  工具   12  ')
  await expect(panel.locator('.rail-overflow-entry')).toHaveCount(1)
  await expect(panel.getByRole('button', { name: '选择工具 12，软件', exact: true })).toBeVisible()
  await search.press('Escape')
  await expect(panel).toBeVisible()
  await expect(search).toHaveValue('')
  await search.fill('C:/apps/8.exe')
  await expect(panel.locator('.rail-overflow-entry')).toHaveCount(1)
  await panel.getByRole('button', { name: '清空挂件搜索' }).click()
  await search.fill('不存在的挂件')
  await expect(panel.getByRole('status').filter({ hasText: '没有找到匹配的挂件' })).toBeVisible()
  await expect(panel.locator('.rail-overflow-entry')).toHaveCount(0)
  await search.fill('8.exe')
  await panel.getByRole('button', { name: '选择工具 9，软件', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.locator('[data-wheel-active=true]')).toHaveAttribute('data-rail-item', 'item-8')
})

test('a full list of long names stays searchable and its last item is reachable on a narrow screen', async ({ page }) => {
  await page.addInitScript(() => {
    const key = 'soundspectra.rail.v1'
    const settings = JSON.parse(localStorage.getItem(key)!)
    settings.groups[0].items = Array.from({ length: 48 }, (_, index) => ({
      id: `long-${index}`, name: `项目 ${index + 1} 的设计说明与资料归档最终确认版本`,
      kind: 'file', path: `C:/Work/${index + 1}.docx`, crop: 'cover',
    }))
    localStorage.setItem(key, JSON.stringify(settings))
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#rail')
  await page.locator('.startup-screen').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '点击绳子添加挂件', exact: true }).press('Shift+Enter')
  const panel = page.getByRole('region', { name: '更多挂件', exact: true })
  await expect(panel.locator('.rail-overflow-entry')).toHaveCount(48)
  const last = panel.locator('.rail-overflow-entry').last()
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
  await expect(panel.getByRole('searchbox', { name: '搜索挂件' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    await panel.screenshot({ path: `artifacts/rail-long-list-${theme}.png` })
  }
  await panel.getByRole('searchbox', { name: '搜索挂件' }).fill('48.docx')
  await expect(panel.locator('.rail-overflow-entry')).toHaveCount(1)
  await last.click()
  await expect(panel).toHaveCount(0)
  await expect(page.locator('.rail-items > [data-wheel-active=true]:not([inert])')).toHaveAttribute('data-rail-item', 'long-47')
})
