// Explicit integration check against the running development app. Only the
// uniquely named fixture is mounted, moved, restored, and removed. Never replay
// a settings snapshot: the user may be editing other items at the same time.
import { chromium, expect } from '@playwright/test'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const sourcePage = () => browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('window=rail&'))
await expect.poll(() => !!sourcePage(), { timeout: 10000 }).toBe(true)
const source = sourcePage()
assert.ok(source, 'Enable a rail in the development app first')
const invoke = (command, args) => source.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const groupId = new URL(source.url()).searchParams.get('group')
const root = resolve('artifacts', `rail-recovery-${Date.now()}`)
const originalPath = join(root, '恢复检查.txt')
const movedPath = join(root, '重新关联的文件.txt')
const report = { checks: [] }
let fixtureId
mkdirSync(root, { recursive: true })
writeFileSync(originalPath, 'SoundSpectra recovery fixture')
try {
  const mounted = await invoke('rail_add_paths', { groupId, paths: [originalPath], replaceId: null })
  const group = mounted.settings.groups.find(group => group.id === groupId)
  const item = group.items.find(item => item.path === originalPath)
  assert.ok(item)
  fixtureId = item.id
  const card = source.locator(`[data-rail-item="${fixtureId}"] .rail-item`)
  await expect(card).toBeVisible()
  const healthy = () => invoke('debug_rail_drop_state').then(windows => windows.find(window => window.label === `rail-${groupId}`)?.layoutHealthy)
  await expect.poll(healthy, { timeout: 10000 }).toBe(true)
  report.checks.push('native window matches the saved layout')
  renameSync(originalPath, movedPath)
  await expect(card).toContainText('需重新关联', { timeout: 10000 })
  report.checks.push('moving a real file updates the desktop UI automatically')
  const relinked = await invoke('rail_add_paths', { groupId, paths: [movedPath], replaceId: fixtureId })
  const relinkedGroup = relinked.settings.groups.find(group => group.id === groupId)
  assert.deepEqual(relinkedGroup.items.find(item => item.id === fixtureId), { ...item, path: movedPath })
  await expect(card).not.toContainText('需重新关联')
  await expect(card.locator('.rail-item-media img')).toBeVisible()
  report.checks.push('relink preserves the item and refreshes its native icon')
  rmSync(movedPath)
  await expect(card).toContainText('需重新关联', { timeout: 10000 })
  writeFileSync(movedPath, 'Restored fixture')
  await expect(card).not.toContainText('需重新关联', { timeout: 10000 })
  await expect(card.locator('.rail-item-media img')).toBeVisible()
  report.checks.push('deleting and restoring a file updates status and reloads the icon')
  await expect.poll(healthy, { timeout: 10000 }).toBe(true)
  console.log(JSON.stringify(report))
} finally {
  if (fixtureId) await invoke('rail_change', { change: { type: 'remove', id: fixtureId } })
  rmSync(root, { recursive: true, force: true })
  writeFileSync('artifacts/native-rail-recovery.json', JSON.stringify(report, null, 2))
  await browser.close()
}
