import { expect, test, type Locator, type Page } from '@playwright/test'
import { defaults } from '../src/features/spectrum/model'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => {
    if (localStorage.getItem('soundspectra.rail.v1')) return
    localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings))
    localStorage.setItem('soundspectra.rail.selection.apps', 'item-2')
    localStorage.setItem('soundspectra.rail.v1', JSON.stringify({ version: 1, enabled: false, groups: [{
      id: 'apps', name: '我的晾衣绳', x: .07, y: .12, width: .86, collapsed: false,
      items: Array.from({ length: 5 }, (_, i) => ({ id: `item-${i}`, name: `工具 ${i + 1}`, kind: 'app', path: `C:/apps/${i}.exe`, crop: 'cover' })),
    }] }))
  }, { ...defaults, regionVisible: false })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#rail')
})

const storedOrder = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.rail.v1')!).groups[0].items.map((item: { id: string }) => item.id))
const openList = async (page: Page) => {
  await page.getByRole('button', { name: '点击绳子添加挂件', exact: true }).press('Shift+Enter')
  return page.getByRole('region', { name: '更多挂件', exact: true })
}
async function drag(page: Page, source: Locator, target: Locator, side: 'before' | 'after', gap = false) {
  const a = (await source.boundingBox())!, b = (await target.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  const x = gap ? b.x + (side === 'before' ? -3 : b.width + 3) : b.x + b.width * (side === 'before' ? .2 : .8)
  await page.mouse.move(x, b.y + b.height / 2, { steps: 10 })
  await expect(target).toHaveAttribute('data-reorder-side', side)
  await page.mouse.up()
}
async function consistent(page: Page, expected: string[]) {
  await expect.poll(() => storedOrder(page)).toEqual(expected)
  await expect.poll(() => page.locator('[data-control-item]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.controlItem))).toEqual(expected)
  // The visual order is a contiguous slice of the circular saved order.
  const ids = await page.locator('.rail-items > [data-rail-item]:not([inert])').evaluateAll(nodes => nodes
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
    .map(node => (node as HTMLElement).dataset.railItem!))
  expect(ids.length).toBeGreaterThan(1)
  for (let i = 1; i < ids.length; i++) expect(expected[(expected.indexOf(ids[i - 1]) + 1) % expected.length]).toBe(ids[i])
}

test('legacy default name migrates and the popup selection matches the centered item', async ({ page }) => {
  await expect(page.getByRole('button', { name: '选择并移动我的拾光绳', exact: true })).toBeVisible()
  const panel = await openList(page)
  await expect(panel.locator('[aria-pressed=true]')).toHaveAttribute('data-rail-list-item', 'item-2')
  await expect(panel.locator('.rail-popup-heading')).toContainText('我的拾光绳')
  await page.reload()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.rail.v1')!).groups[0].name)).toBe('我的拾光绳')
})

test('list drag inserts before and after, including gaps, and survives reload in all three views', async ({ page }) => {
  let panel = await openList(page)
  const tile = (id: number) => panel.locator(`[data-rail-list-item="item-${id}"]`)
  await drag(page, tile(0), tile(3), 'after')
  let expected = ['item-1', 'item-2', 'item-3', 'item-0', 'item-4']
  await consistent(page, expected)
  await expect(panel).toBeVisible()
  await expect(panel.locator('.rail-overflow-entry')).toHaveCount(5)
  await drag(page, tile(4), tile(1), 'before', true)
  expected = ['item-4', 'item-1', 'item-2', 'item-3', 'item-0']
  await consistent(page, expected)
  await expect.poll(() => panel.locator('[data-rail-list-item]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.railListItem))).toEqual(expected)
  await page.reload()
  await consistent(page, expected)
  panel = await openList(page)
  await expect.poll(() => panel.locator('[data-rail-list-item]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.railListItem))).toEqual(expected)
})

test('cord reorders both ways without opening and keeps circular order across the seam', async ({ page }) => {
  const card = (id: number) => page.locator(`.rail-items > [data-rail-item="item-${id}"]`)
  await drag(page, card(1).locator('.rail-item'), card(3), 'after')
  await consistent(page, ['item-0', 'item-2', 'item-3', 'item-1', 'item-4'])
  await expect(page.locator('.rail-popup, .rail-inline-notice')).toHaveCount(0)
  await drag(page, card(3).locator('.rail-item'), card(0), 'before', true)
  await consistent(page, ['item-3', 'item-0', 'item-2', 'item-1', 'item-4'])
  await card(2).locator('.rail-item').press('End')
  await expect(page.locator('[data-wheel-active=true]')).toHaveAttribute('data-rail-item', 'item-4')
  await consistent(page, ['item-3', 'item-0', 'item-2', 'item-1', 'item-4'])
  await drag(page, card(4).locator('.rail-item'), card(3), 'after')
  await consistent(page, ['item-3', 'item-4', 'item-0', 'item-2', 'item-1'])
  await expect(page.locator('.rail-popup, .rail-inline-notice')).toHaveCount(0)
})

test('filtered reordering preserves hidden items and a held edge drag scrolls a long list', async ({ page }) => {
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('soundspectra.rail.v1')!)
    settings.groups[0].items = Array.from({ length: 24 }, (_, i) => ({ id: `item-${i}`, name: `${i === 1 || i === 23 ? '筛选组' : '工具'} ${i + 1}`, kind: 'app', path: `C:/apps/${i}.exe`, crop: 'cover' }))
    localStorage.setItem('soundspectra.rail.v1', JSON.stringify(settings))
    window.dispatchEvent(new Event('rail-browser-changed'))
  })
  const panel = await openList(page)
  const search = panel.getByRole('searchbox', { name: '搜索挂件' })
  await search.fill('筛选组')
  await expect(panel.locator('.rail-overflow-entry')).toHaveCount(2)
  const first = panel.locator('[data-rail-list-item="item-1"]')
  const last = panel.locator('[data-rail-list-item="item-23"]')
  await last.scrollIntoViewIfNeeded()
  await drag(page, last, first, 'before')
  const expected = ['item-0', 'item-23', ...Array.from({ length: 22 }, (_, i) => `item-${i + 1}`)]
  await expect.poll(() => storedOrder(page)).toEqual(expected)
  await search.fill('')
  const list = panel.locator('.rail-overflow-items')
  await list.evaluate(node => { node.scrollTop = 0 })
  const entry = panel.locator('[data-rail-list-item="item-0"]')
  const a = (await entry.boundingBox())!, box = (await list.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 10, { steps: 10 })
  await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(100)
  await page.mouse.up()
  await expect(panel).toBeVisible()
  await expect.poll(async () => (await storedOrder(page))[0]).toBe('item-23')
  expect(new Set(await storedOrder(page))).toEqual(new Set(expected))
  await expect(panel.locator('.rail-overflow-entry[data-dragging]')).toHaveCount(0)
})

test('Escape cancels a captured drag even when keyboard focus is outside the rail', async ({ page }) => {
  const before = await storedOrder(page)
  const source = page.locator('[data-rail-item="item-1"] .rail-item')
  const target = page.locator('[data-rail-item="item-3"]')
  const a = (await source.boundingBox())!, b = (await target.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * .8, b.y + b.height / 2, { steps: 10 })
  await expect(target).toHaveAttribute('data-reorder-side', 'after')
  await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus() })
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-dragging=true]')).toHaveCount(0)
  await page.mouse.up()
  expect(await storedOrder(page)).toEqual(before)
  await expect(page.locator('.rail-popup')).toHaveCount(0)
})

test('window blur cancels sorting without opening a target or throwing a DOM error', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const before = await storedOrder(page)
  const source = page.locator('[data-rail-item="item-1"] .rail-item')
  const target = page.locator('[data-rail-item="item-3"]')
  const a = (await source.boundingBox())!, b = (await target.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * .8, b.y + b.height / 2, { steps: 10 })
  await expect(target).toHaveAttribute('data-reorder-side', 'after')
  await page.evaluate(() => window.dispatchEvent(new FocusEvent('blur')))
  await expect(page.locator('[data-dragging=true]')).toHaveCount(0)
  await page.mouse.up()
  expect(await storedOrder(page)).toEqual(before)
  expect(errors).toEqual([])
  await expect(page.locator('.rail-popup, .rail-inline-notice')).toHaveCount(0)
})
