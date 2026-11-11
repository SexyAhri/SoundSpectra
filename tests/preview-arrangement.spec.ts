import { test, expect, type Page } from '@playwright/test'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'
import { railDefaults } from '../src/features/rail/model'
import { avoidRail, overlapArea, railObstacles } from '../src/features/lyrics/avoid-rail'
import { duplicateRegion, layerIndex, moveLayer, removeRegion, sceneLayers } from '../src/features/preview/scene-layers'
import { desktopLayout, parseDesktopScene, scenePatch } from '../src/features/preview/desktop-scenes'

const fixture = { ...structuredClone(defaults), bounds: { x: .1, y: .65, width: .4, height: .3 },
  desktopCard: { ...defaults.desktopCard, enabled: true, bounds: { x: .7, y: .81, width: .23, height: .13 } },
  lyrics: { ...defaults.lyrics, enabled: true, bounds: { x: .1, y: .06, width: .8, height: .4 } } }
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
const settled = (page: Page) => expect(page.getByText('已保存到此浏览器')).toBeVisible()
const object = (page: Page, id: string) => page.locator(`[data-preview-object="${id}"]`)
const openMenu = async (page: Page, id: string) => {
  await object(page, id).click({ button: 'right', position: { x: 12, y: 12 } })
  await expect(page.getByRole('menu')).toBeVisible()
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => {
    if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings))
  }, fixture)
})

test('layer order survives deletion, primary promotion, old scenes and full scene save', () => {
  let settings = { ...fixture, ...duplicateRegion(fixture, 'primary', 'copy') }
  settings = { ...settings, ...moveLayer(settings, 'effect:primary', 'front') }
  expect(layerIndex(settings, 'effect:primary')).toBeGreaterThan(layerIndex(settings, 'card'))
  const originalCopy = settings.regions[0]
  settings = { ...settings, ...removeRegion(settings, 'primary') }
  expect(settings.regions).toHaveLength(0)
  expect(settings.bounds).toEqual(originalCopy.bounds)
  expect(sceneLayers(settings)).toEqual(['effect:primary', 'lyrics', 'card'])
  const scene = desktopLayout(settings)
  expect(parseDesktopScene(scene.desktop)).toEqual(scene.desktop)
  expect({ ...fixture, ...scenePatch(fixture, scene) }.layerOrder).toEqual(settings.layerOrder)
  const { layerOrder: _order, ...old } = scene.desktop!
  expect(parseDesktopScene(old)).toEqual(old)
  expect(normalizeSettings({ ...settings, layerOrder: ['card', 'card', {}, 'invalid'] }).layerOrder).toEqual(['card'])
})

test('avoidance moves first, shrinks only when needed, handles multiple rails and restores authored bounds', () => {
  const authored = { x: .1, y: .1, width: .8, height: .3 }
  const rail = { ...railDefaults, enabled: true }
  const obstacles = railObstacles(rail, { width: 1920, height: 1080 })
  const shifted = avoidRail(authored, obstacles)
  expect(shifted.crowded).toBe(false)
  expect(shifted.bounds.width).toBe(authored.width)
  expect(shifted.bounds.height).toBe(authored.height)
  expect(overlapArea(shifted.bounds, obstacles[0])).toBeCloseTo(0)
  const larger = { ...authored, height: .65 }
  const reduced = avoidRail(larger, obstacles)
  expect(reduced.bounds.height).toBeLessThan(larger.height)
  expect(reduced.bounds.height).toBeGreaterThanOrEqual(.1)
  for (const dimensions of [{ width: 1280, height: 720 }, { width: 2560, height: 1440 }]) {
    const crowded = railObstacles({ enabled: true, version: 1, groups: [railDefaults.groups[0], { ...railDefaults.groups[0], id: 'second', x: .4, y: .6, width: .5 }] }, dimensions)
    const result = avoidRail(authored, crowded)
    expect(result.crowded).toBe(false)
    expect(crowded.every(rect => overlapArea(result.bounds, rect) < 1e-8)).toBe(true)
  }
  expect(avoidRail(authored, railObstacles({ ...rail, enabled: false }, { width: 1920, height: 1080 })).bounds).toEqual(authored)
  expect(avoidRail(authored, [{ x: 0, y: 0, width: 1, height: 1 }]).crowded).toBe(true)
})

test('right click copies only the target, changes persistent layers and never changes order on selection', async ({ page }) => {
  await page.goto('/#scene'); await settled(page)
  await page.getByRole('button', { name: '布置', exact: true }).click()
  await openMenu(page, 'effect:primary')
  await page.getByRole('menuitem', { name: '复制区域', exact: true }).click(); await settled(page)
  let next = await saved(page)
  expect(next.regions).toHaveLength(1)
  const copied = next.regions[0].id
  expect(next.regions[0].bounds).not.toEqual(fixture.bounds)
  expect(next.bounds).toEqual(fixture.bounds)
  await openMenu(page, `effect:${copied}`)
  await page.getByRole('menuitem', { name: '置于顶层', exact: true }).click(); await settled(page)
  next = await saved(page)
  expect(next.layerOrder.at(-1)).toBe(`effect:${copied}`)
  const top = await object(page, `effect:${copied}`).evaluate(el => getComputedStyle(el).zIndex)
  await object(page, 'effect:primary').focus()
  expect(await object(page, `effect:${copied}`).evaluate(el => getComputedStyle(el).zIndex)).toBe(top)
  expect((await saved(page)).layerOrder).toEqual(next.layerOrder)
  await openMenu(page, `effect:${copied}`)
  await page.getByRole('menuitem', { name: '隐藏', exact: true }).click(); await settled(page)
  expect((await saved(page)).regions[0].visible).toBe(false)
  await openMenu(page, `effect:${copied}`)
  await page.getByRole('menuitem', { name: '显示', exact: true }).click(); await settled(page)
  await page.reload(); await settled(page)
  expect((await saved(page)).layerOrder.at(-1)).toBe(`effect:${copied}`)
})

test('card and lyrics context actions stay local; keyboard menu closes without ending arrangement', async ({ page }) => {
  await page.goto('/#scene'); await settled(page)
  await page.getByRole('button', { name: '布置', exact: true }).click()
  await openMenu(page, 'card')
  await expect(page.getByRole('menuitem', { name: '复制区域' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: '水平居中', exact: true }).click(); await settled(page)
  expect((await saved(page)).desktopCard.bounds.x).toBeCloseTo((1 - fixture.desktopCard.bounds.width) / 2)
  expect((await saved(page)).lyrics).toEqual(fixture.lyrics)
  await object(page, 'lyrics').focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(object(page, 'lyrics')).toBeFocused()
  await expect(page.getByRole('button', { name: '完成布置', exact: true })).toBeVisible()
  await openMenu(page, 'lyrics')
  await page.getByRole('menuitem', { name: '隐藏', exact: true }).click(); await settled(page)
  expect((await saved(page)).lyrics.enabled).toBe(false)
  expect((await saved(page)).desktopCard.enabled).toBe(true)
})

for (const theme of ['light', 'dark']) {
  test(`arrangement menu fits the screen edge and enlarged preview in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 620 })
    await page.goto('/#scene'); await settled(page)
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle('dark', theme === 'dark') }, theme)
    await page.getByRole('button', { name: '放大预览' }).click()
    await page.getByRole('button', { name: '布置', exact: true }).last().click()
    await openMenu(page, 'card')
    const box = await page.getByRole('menu').boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(1000)
    expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(620)
    await page.screenshot({ path: `artifacts/arrangement-menu-${theme}.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: '关闭放大预览' }).click()
    expect(await saved(page)).toEqual(fixture)
  })
}

test('preview avoids a live rail and returns to saved placement when rail is disabled', async ({ page }) => {
  const rail = { ...structuredClone(railDefaults), enabled: true }
  await page.addInitScript(rail => localStorage.setItem('soundspectra.rail.v1', JSON.stringify(rail)), rail)
  await page.goto('/#scene'); await settled(page)
  await expect(page.getByLabel('桌面拾光绳预览')).toBeVisible()
  const bounds = await object(page, 'lyrics').boundingBox()
  const rope = await page.locator('.rail-surface').boundingBox()
  expect(bounds!.y).toBeGreaterThanOrEqual(rope!.y + rope!.height)
  expect((await saved(page)).lyrics.bounds).toEqual(fixture.lyrics.bounds)
  await page.screenshot({ path: 'artifacts/lyrics-avoid-rail.png' })
  await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('soundspectra.rail.v1')!); current.enabled = false
    localStorage.setItem('soundspectra.rail.v1', JSON.stringify(current))
    window.dispatchEvent(new Event('rail-browser-changed'))
  })
  await expect(page.getByLabel('桌面拾光绳预览')).toHaveCount(0)
  await expect.poll(() => object(page, 'lyrics').evaluate(el => (el as HTMLElement).style.top)).toBe('6%')
  expect((await saved(page)).lyrics.bounds).toEqual(fixture.lyrics.bounds)
})

test('global arrangement selects, moves and resizes the rail without opening or rearranging its items', async ({ page }) => {
  const rail = { ...structuredClone(railDefaults), enabled: true }
  rail.groups[0].items = [{ id: 'note', name: '便签', kind: 'note', path: '', crop: 'cover', text: '保留这张便签' }]
  await page.addInitScript(value => {
    if (!localStorage.getItem('soundspectra.rail.v1')) localStorage.setItem('soundspectra.rail.v1', JSON.stringify(value))
  }, rail)
  const savedRail = () => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.rail.v1')!))
  await page.goto('/#scene'); await settled(page)
  // Stay in the lighting inspector: arranging the rail must not require its tab first.
  await page.getByRole('button', { name: '布置', exact: true }).click()
  const target = object(page, 'rail:apps')
  await page.getByRole('button', { name: '移动我的拾光绳', exact: true }).click()
  await expect(target).toHaveAttribute('data-selected', 'true')
  await expect(page.getByRole('button', { name: '完成布置', exact: true })).toBeVisible()
  const original = (await savedRail()).groups[0]
  const before = await target.boundingBox()
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2)
  await page.mouse.down(); await page.mouse.move(before!.x + before!.width / 2 + 16, before!.y + before!.height / 2 + 28, { steps: 6 }); await page.mouse.up()
  await expect.poll(async () => (await savedRail()).groups[0].y).toBeGreaterThan(original.y)
  await expect(target).not.toHaveAttribute('inert')
  const resize = await page.getByRole('button', { name: '调整我的拾光绳宽度', exact: true }).boundingBox()
  await page.mouse.move(resize!.x + resize!.width / 2, resize!.y + resize!.height / 2)
  await page.mouse.down(); await page.mouse.move(resize!.x - 70, resize!.y, { steps: 6 }); await page.mouse.up()
  await expect.poll(async () => (await savedRail()).groups[0].width).toBeLessThan(original.width)
  await openMenu(page, 'rail:apps')
  await expect(page.getByRole('menuitem', { name: '置于顶层' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: '水平居中' }).click()
  await expect.poll(async () => { const group = (await savedRail()).groups[0]; return Math.abs(group.x - (1 - group.width) / 2) }).toBeLessThan(.00001)
  await target.focus(); await page.keyboard.press('ArrowDown')
  const settledRail = await savedRail()
  const position = await target.boundingBox()
  await page.mouse.move(position!.x + position!.width / 2, position!.y + 30)
  await page.mouse.down(); await page.mouse.move(position!.x + position!.width / 2 + 30, position!.y + 65, { steps: 6 })
  await page.keyboard.press('Escape'); await page.mouse.up()
  expect(await savedRail()).toEqual(settledRail)
  expect((await savedRail()).groups[0].items).toEqual(original.items)
  expect((await saved(page)).bounds).toEqual(fixture.bounds)
  await expect(page.locator('.rail-popup')).toHaveCount(0)
  await page.screenshot({ path: 'artifacts/rail-global-arrangement.png' })
  await page.reload(); await settled(page)
  expect((await savedRail()).groups[0]).toEqual(settledRail.groups[0])
})
