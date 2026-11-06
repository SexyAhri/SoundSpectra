// Explicit integration check: create and remove an isolated note-only test group.
// Never reorder the user's mounts or overwrite a saved configuration snapshot.
import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const pages = () => browser.contexts().flatMap(c => c.pages())
const settings = pages().find(p => !new URL(p.url()).searchParams.has('window'))
assert.ok(settings)
const invoke = (command, args) => settings.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const report = { checks: [], errors: [] }
const ids = []
let groupId
let host
try {
  const original = await invoke('rail_get')
  assert.ok(original.settings.enabled, 'Requires an already-enabled desktop rail')
  assert.ok(original.settings.groups.length < 4, 'Requires a free test group slot')
  assert.ok(!original.settings.groups.some(g => g.id === 'apps' && g.name === '我的晾衣绳'))
  report.checks.push('persisted legacy default name migrated')
  const created = await invoke('rail_change', { change: { type: 'addGroup' } })
  groupId = created.settings.groups.at(-1).id
  await invoke('rail_change', { change: { type: 'group', id: groupId, name: '排序验证', x: .07, y: .45, width: .86 } })
  for (let i = 0; i < 5; i++) {
    const next = await invoke('rail_change', { change: { type: 'addNote', groupId, text: `排序验证 ${i + 1}` } })
    ids.push(next.settings.groups.find(g => g.id === groupId).items.at(-1).id)
  }
  const hasGroup = page => new URL(page.url()).searchParams.get('group') === groupId
  await expect.poll(() => pages().some(p => p.url().includes('window=rail&') && hasGroup(p)), { timeout: 10000 }).toBe(true)
  const source = pages().find(p => p.url().includes('window=rail&') && hasGroup(p))
  const active = source.locator('.rail-items > [data-wheel-active=true]')
  await active.locator('.rail-item').press('Home')
  await active.locator('.rail-item').press('ArrowRight')
  await active.locator('.rail-item').press('ArrowRight')
  await expect(active).toHaveAttribute('data-rail-item', ids[2])
  await source.locator('.rail-surface').evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
  })
  const order = async () => (await invoke('rail_get')).settings.groups.find(g => g.id === groupId).items.map(i => i.id)
  const drag = async (page, from, to, side) => {
    await from.hover()
    const a = await from.boundingBox(), b = await to.boundingBox()
    assert.ok(a && b)
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width * (side === 'after' ? .8 : .2), b.y + b.height / 2, { steps: 12 })
    await expect(to).toHaveAttribute('data-reorder-side', side)
    await page.mouse.up()
  }
  const card = id => source.locator(`[data-rail-item="${id}"]`)
  await expect.poll(async () => {
    const box = await card(ids[3]).boundingBox()
    return box && Math.round(box.x)
  }).not.toBeNull()
  await drag(source, card(ids[1]).locator('.rail-item'), card(ids[3]), 'after')
  const expected = [ids[0], ids[2], ids[3], ids[1], ids[4]]
  await expect.poll(order).toEqual(expected)
  report.checks.push('native source pointer drag saves the insertion order')
  await source.getByRole('button', { name: '点击绳子添加挂件', exact: true }).press('Shift+Enter')
  await expect.poll(() => pages().some(p => p.url().includes('window=rail-popup&') && hasGroup(p)), { timeout: 10000 }).toBe(true)
  host = pages().find(p => p.url().includes('window=rail-popup&') && hasGroup(p))
  const panel = host.locator('.rail-popup-more')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('searchbox', { name: '搜索挂件' })).toBeFocused()
  await panel.evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
  })
  await host.evaluate(() => {
    window.orderGestureEvents = []
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'blur']) {
      window.addEventListener(type, event => window.orderGestureEvents.push({ type, x: event.clientX, y: event.clientY, target: event.target?.dataset?.railListItem, focus: document.hasFocus() }), true)
    }
  })
  await expect(panel.locator('[aria-pressed=true]')).toHaveAttribute('data-rail-list-item', ids[2])
  assert.deepEqual(await panel.locator('[data-rail-list-item]').evaluateAll(nodes => nodes.map(n => n.dataset.railListItem)), expected)
  report.checks.push('companion panel shares the source selection and saved order')
  const tile = id => panel.locator(`[data-rail-list-item="${id}"]`)
  await drag(host, tile(ids[4]), tile(ids[0]), 'before')
  const reordered = [ids[4], ...expected.slice(0, 4)]
  await expect.poll(order).toEqual(reordered)
  await expect(panel).toBeVisible()
  report.checks.push('native companion drag reorders without closing or unmounting')
  await panel.screenshot({ path: 'artifacts/native-rail-order-list.png' })
  await panel.getByRole('button', { name: '关闭挂件面板' }).click()
  await expect(panel).toHaveCount(0)
  await source.reload()
  await expect(source.locator('[data-wheel-active=true]')).toHaveAttribute('data-rail-item', ids[2])
  assert.deepEqual(await order(), reordered)
  await expect.poll(async () => {
    const surface = await source.locator('.rail-surface').boundingBox()
    const card = await source.locator('[data-wheel-active=true]').boundingBox()
    return surface && card ? Math.abs(card.x + card.width / 2 - surface.x - surface.width / 2) : Infinity
  }).toBeLessThan(2)
  await source.screenshot({ path: 'artifacts/native-rail-order-cord.png' })
  report.checks.push('reload retains order and centered selection')
  report.passed = true
} catch (error) {
  report.errors.push(String(error))
  if (host && !host.isClosed()) {
    report.gestureEvents = await host.evaluate(() => window.orderGestureEvents).catch(() => undefined)
    await host.screenshot({ path: 'artifacts/native-rail-order-failure.png' }).catch(() => {})
  }
  process.exitCode = 1
} finally {
  if (groupId) {
    for (const id of ids) {
      const snapshot = await invoke('rail_get')
      if (snapshot.settings.groups.find(g => g.id === groupId)?.items.some(i => i.id === id))
        await invoke('rail_change', { change: { type: 'remove', id } })
    }
    const group = (await invoke('rail_get')).settings.groups.find(g => g.id === groupId)
    if (group && !group.items.length) await invoke('rail_change', { change: { type: 'removeGroup', id: groupId } })
    await settings.evaluate(id => localStorage.removeItem(`soundspectra.rail.selection.${id}`), groupId)
  }
  writeFileSync('artifacts/native-rail-order.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}
