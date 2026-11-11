// Opt-in test against the running debug WebView2, not a mocked Tauri event.
// Chromium creates real disk-backed File objects; Windows OLE hit-testing and
// a human Explorer drag remain a separate manual check. Only our fixtures are
// mounted and removed; existing items and Desktop files are never modified.
import { chromium, expect } from '@playwright/test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const folder = resolve(`artifacts/rail-incoming-${Date.now()}`)
mkdirSync(folder, { recursive: true })
mkdirSync(`${folder}/工作 文件夹`)
mkdirSync(`${folder}/工作 文件夹/子目录`)
writeFileSync(`${folder}/测试文件.txt`, 'SoundSpectra incoming drag fixture')
writeFileSync(`${folder}/软件.lnk`, 'unopened shortcut fixture')
writeFileSync(`${folder}/照片.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a90sAAAAASUVORK5CYII=', 'base64'))
const files = ['测试文件.txt', '软件.lnk', '照片.png', '工作 文件夹'].map(name => resolve(folder, name))
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const pages = () => browser.contexts().flatMap(c => c.pages())
await expect.poll(() => pages().some(p => p.url().includes('window=rail&')), { timeout: 10000 }).toBe(true)
const source = pages().find(p => p.url().includes('window=rail&'))
assert.ok(source, 'Requires an enabled rail in the current debug app')
let page = source
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const report = { files: files.map(path => path.split(/[\\/]/).at(-1)), errors: [] }
const original = await invoke('rail_get')
const originalIds = new Set(original.settings.groups.flatMap(g => g.items.map(item => item.id)))
const existingPanel = pages().find(p => p.url().includes('window=rail-popup&'))
const wasOpen = !!existingPanel && await existingPanel.locator('.rail-popup-more').isVisible()
let restoreProbe
try {
  const diagnostics = await invoke('debug_rail_drop_state')
  assert.ok(diagnostics.find(d => d.label.startsWith('rail-'))?.fileObjectBridge)
  for (const target of diagnostics) {
    assert.ok(target.nativeDropReady)
    const surfaces = target.windows.filter(w => w.dropSurface)
    assert.equal(surfaces.length, 1, 'Each host needs one native receiving surface')
    assert.ok(surfaces.every(w => w.process === target.process && w.oleTarget !== '0'), 'Receiving surface must own its OLE target')
    const foreign = target.windows.filter(w => w.process !== target.process)
    assert.ok(foreign.every(w => !w.registered && w.oleTarget === '0'), 'Never replace browser-owned OLE targets')
  }
  if (!wasOpen) {
    const point = await source.locator('.rail-cord-hit').evaluate(path => {
      const p = path.getPointAtLength(path.getTotalLength() * .025)
      const s = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM())
      return { x: s.x, y: s.y }
    })
    await source.mouse.dblclick(point.x, point.y, { delay: 90 })
  }
  await expect.poll(() => pages().some(p => p.url().includes('window=rail-popup&')), { timeout: 10000 }).toBe(true)
  page = pages().find(p => p.url().includes('window=rail-popup&'))
  const panel = page.locator('.rail-popup-more')
  await expect(panel).toBeVisible()
  await page.evaluate(async () => {
    window.__incomingSmoke = { events: [], messages: [], stop: [] }
    const probe = window.__incomingSmoke
    const event = await import('/node_modules/@tauri-apps/api/event.js')
    for (const kind of ['rail-native-drop', 'rail-drop-error']) probe.stop.push(await event.listen(kind, e => probe.messages.push({ kind, payload: e.payload })))
    for (const type of ['dragover', 'drop']) {
      const listener = e => probe.events.push({ type, trusted: e.isTrusted, prevented: e.defaultPrevented, effect: e.dataTransfer.dropEffect, names: [...e.dataTransfer.files].map(f => f.name) })
      window.addEventListener(type, listener)
      probe.stop.push(() => window.removeEventListener(type, listener))
    }
  })
  restoreProbe = async () => page.evaluate(() => { window.__incomingSmoke?.stop.forEach(stop => stop()); delete window.__incomingSmoke })
  const box = await panel.boundingBox()
  const session = await page.context().newCDPSession(page)
  for (const type of ['dragEnter', 'dragOver', 'drop']) await session.send('Input.dispatchDragEvent', {
    type, x: box.x + box.width / 2, y: box.y + box.height / 2,
    data: { items: [], files, dragOperationsMask: 7 },
  })
  await expect.poll(async () => {
    const snapshot = await invoke('rail_get')
    return snapshot.settings.groups.flatMap(g => g.items).filter(i => files.some(path => path.toLowerCase() === i.path.toLowerCase())).length
  }, { timeout: 6000 }).toBe(4)
  report.probe = await page.evaluate(() => ({ events: window.__incomingSmoke.events, messages: window.__incomingSmoke.messages }))
  report.items = (await invoke('rail_get')).settings.groups.flatMap(g => g.items).filter(i => !originalIds.has(i.id)).map(i => ({ name: i.name, kind: i.kind, desktopManaged: i.desktopManaged }))
  assert.deepEqual(report.items.map(i => i.kind).sort(), ['app', 'file', 'folder', 'image'])
  assert.ok(report.probe.events.some(e => e.type === 'drop' && e.trusted && e.prevented))
  assert.ok(report.probe.messages.some(e => e.kind === 'rail-native-drop' && e.payload.paths.length === 4))
  assert.ok(!report.probe.messages.some(e => e.kind === 'rail-drop-error'))
  const groupId = new URL(source.url()).searchParams.get('group')
  const existingCount = original.settings.groups.find(group => group.id === groupId).items.length
  await expect(panel.locator('.rail-overflow-entry')).toHaveCount(existingCount + 4)
  await expect.poll(() => page.evaluate(() => {
    const bounds = document.querySelector('.rail-popup').getBoundingClientRect()
    return bounds.bottom <= innerHeight - 10
  })).toBe(true)
  await page.screenshot({ path: 'artifacts/native-rail-incoming.png' })
  await panel.getByRole('button', { name: '选择工作 文件夹，文件夹', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await source.locator('.rail-items > [data-wheel-active=true] .rail-folder-expand').click()
  const folderPanel = page.locator('.rail-popup-folder')
  await expect(folderPanel).toBeVisible()
  await folderPanel.getByRole('button', { name: '子目录，文件夹', exact: true }).dblclick()
  await expect(folderPanel.getByRole('status')).toHaveText('这个文件夹是空的')
  report.folderNavigation = true
  report.passed = true
} catch (error) {
  report.errors.push(String(error))
  report.probe = await page.evaluate(() => window.__incomingSmoke && ({ events: window.__incomingSmoke.events, messages: window.__incomingSmoke.messages }))
  process.exitCode = 1
} finally {
  const current = await invoke('rail_get')
  for (const item of current.settings.groups.flatMap(g => g.items).filter(i => !originalIds.has(i.id) && files.some(path => path.toLowerCase() === i.path.toLowerCase()))) {
    await invoke('rail_change', { change: { type: 'remove', id: item.id } })
  }
  report.concurrentSettingsChanges = JSON.stringify((await invoke('rail_get')).settings) !== JSON.stringify(original.settings)
  if (!wasOpen) await page.getByRole('button', { name: '关闭挂件面板', exact: true }).click({ timeout: 2000 }).catch(() => {})
  await restoreProbe?.()
  await browser.close()
  // This exact fixture directory was created above, inside ignored artifacts/.
  rmSync(folder, { recursive: true, force: true })
  writeFileSync('artifacts/native-rail-incoming.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
