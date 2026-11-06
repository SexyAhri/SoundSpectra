// Explicit desktop integration check. Opens panels and briefly collapses the
// existing rail, then restores its settings. Never launches a mounted program.
import { chromium, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const pages = () => browser.contexts().flatMap(c => c.pages())
await expect.poll(() => pages().some(p => p.url().includes('window=rail&')), { timeout: 10000 }).toBe(true)
const source = pages().find(p => p.url().includes('window=rail&'))
assert.ok(source)
const invoke = (command, args) => source.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const original = (await invoke('rail_get')).settings
const groupId = new URL(source.url()).searchParams.get('group')
const group = original.groups.find(g => g.id === groupId)
assert.ok(group?.items.length)
let panelPage
let originalDraft
const draftKey = `soundspectra.rail.note-draft.new-${groupId}`
const report = { checks: [], errors: [] }
const nativeRoot = async () => (await invoke('debug_rail_drop_state')).find(d => d.label === `rail-${groupId}`).windows[0]
const baseline = await nativeRoot()
const unchanged = async name => {
  const now = await nativeRoot()
  assert.equal(now.hwnd, baseline.hwnd)
  assert.equal(now.parent, baseline.parent)
  assert.deepEqual(now.rect, baseline.rect)
  assert.ok(now.visible)
  report.checks.push(name)
}
const close = async () => {
  const panel = panelPage?.locator('.rail-popup')
  if (panel && await panel.isVisible()) {
    await panel.getByRole('button', { name: '关闭挂件面板', exact: true }).click()
    await expect(panel).toHaveCount(0)
  }
}
const cord = async twice => {
  const point = await source.locator('.rail-cord-hit').evaluate(path => {
    const p = path.getPointAtLength(path.getTotalLength() * .025)
    const s = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM())
    return { x: s.x, y: s.y }
  })
  if (twice) await source.mouse.dblclick(point.x, point.y, { delay: 90 })
  else await source.mouse.click(point.x, point.y)
}
try {
  if (group.collapsed) await invoke('rail_change', { change: { type: 'group', id: groupId, collapsed: false } })
  const active = source.locator('.rail-items > [data-wheel-active=true]')
  for (let i = 0; i < 3; i++) {
    await active.locator('.rail-item-menu').click()
    await expect.poll(() => pages().some(p => p.url().includes('window=rail-popup&')), { timeout: 10000 }).toBe(true)
    panelPage = pages().find(p => p.url().includes('window=rail-popup&'))
    const menu = panelPage.locator('.rail-popup-menu')
    await expect(menu).toBeVisible()
    await unchanged(`menu open ${i + 1}`)
    if (i === 0) {
      await menu.getByRole('button', { name: '修改显示名称', exact: true }).click()
      const input = menu.getByRole('textbox', { name: '新的显示名称', exact: true })
      await input.fill('输入检查，不保存')
      await expect(input).toBeFocused()
      await panelPage.keyboard.type('完成')
      await expect(input).toHaveValue('输入检查，不保存完成')
      report.checks.push('native text input remains focused')
      await menu.screenshot({ path: 'artifacts/native-rail-menu.png' })
    }
    await close()
    await unchanged(`menu close ${i + 1}`)
  }
  await cord(true)
  const list = panelPage.locator('.rail-popup-more')
  await expect(list).toBeVisible()
  await expect(list.locator('.rail-overflow-entry')).toHaveCount(group.items.length)
  await unchanged('all items list')
  const last = list.locator('.rail-overflow-entry').last()
  const chosenId = await last.getAttribute('data-rail-list-item')
  await last.click()
  await expect(list).toHaveCount(0)
  await expect(active).toHaveAttribute('data-rail-item', chosenId)
  report.checks.push('list choice centers the same item in the desktop rail')
  await unchanged('list close')
  await cord(false)
  const add = panelPage.locator('.rail-popup-add')
  await expect(add).toBeVisible()
  await add.getByRole('button', { name: /写便签/ }).click()
  const text = add.getByRole('textbox', { name: '便签内容', exact: true })
  originalDraft = await panelPage.evaluate(key => sessionStorage.getItem(key), draftKey)
  await text.fill('仅检查编辑框，不保存')
  await expect(text).toBeFocused()
  await unchanged('add panel and note editor')
  await close()
  await source.getByRole('button', { name: `收起${group.name}`, exact: true }).click()
  await expect(source.locator('.rail-body')).toHaveCount(0)
  await unchanged('collapsed rail keeps its backing window')
  await source.getByRole('button', { name: `展开${group.name}`, exact: true }).click()
  await expect(source.locator('.rail-body')).toBeVisible()
  await unchanged('expanded rail')
  await source.screenshot({ path: 'artifacts/native-rail-stable.png' })
  report.passed = true
} catch (error) {
  report.errors.push(String(error))
  process.exitCode = 1
} finally {
  await close().catch(() => {})
  if (originalDraft !== undefined) await panelPage.evaluate(({ key, value }) => {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  }, { key: draftKey, value: originalDraft })
  const settings = (await invoke('rail_get')).settings
  const current = settings.groups.find(g => g.id === groupId)
  if (current.collapsed !== group.collapsed) await invoke('rail_change', { change: { type: 'group', id: groupId, collapsed: group.collapsed } })
  // The user may continue mounting/unmounting while a local check runs. Report
  // that separately, and never replay an old settings snapshot over their edits.
  report.concurrentSettingsChanges = JSON.stringify((await invoke('rail_get')).settings) !== JSON.stringify(original)
  await browser.close()
  writeFileSync('artifacts/native-rail-motion.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
