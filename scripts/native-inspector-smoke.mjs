import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('artifacts', { recursive: true })
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('http://tauri.localhost') && !p.url().includes('window=overlay'))
assert.ok(page, 'Requires the packaged settings window')
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const report = { errors: [] }
page.on('pageerror', error => report.errors.push(error.message))
let originalTab
try {
  await expect(page.getByText('设置已保存', { exact: true })).toBeVisible()
  report.before = await invoke('get_settings')
  const windowArgs = { label: 'settings' }
  const [size, position, monitor, scale] = await Promise.all([
    invoke('plugin:window|inner_size', windowArgs), invoke('plugin:window|outer_position', windowArgs),
    invoke('plugin:window|current_monitor', windowArgs), invoke('plugin:window|scale_factor', windowArgs),
  ])
  report.window = { size, position, monitor, scale }
  assert.ok(Math.abs(size.width / scale - Math.min(1440, monitor.workArea.size.width / scale - 48)) < 2)
  assert.ok(Math.abs(size.height / scale - Math.min(940, monitor.workArea.size.height / scale - 48)) < 2)
  assert.ok(position.x >= monitor.workArea.position.x && position.y >= monitor.workArea.position.y)
  assert.ok(position.x + size.width <= monitor.workArea.position.x + monitor.workArea.size.width + 1)
  assert.ok(position.y + size.height <= monitor.workArea.position.y + monitor.workArea.size.height + 1)
  originalTab = await page.getByRole('tab', { selected: true }).innerText()
  for (const [name, file] of [['动效', 'effects'], ['外观', 'appearance'], ['位置', 'position']]) {
    await page.getByRole('tab', { name, exact: true }).click()
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.screenshot({ path: `artifacts/native-inspector-${file}.png` })
  }
  report.layout = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight,
    documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight,
    inspectorWidth: document.querySelector('.inspector').getBoundingClientRect().width,
    qualityBottom: document.querySelector('.inspector-performance').getBoundingClientRect().bottom,
  }))
  assert.ok(report.layout.documentWidth <= report.layout.width)
  assert.ok(report.layout.documentHeight <= report.layout.height)
  assert.ok(report.layout.inspectorWidth >= 340 && report.layout.qualityBottom <= report.layout.height)
  report.status = await invoke('get_status'); report.desktop = await invoke('debug_desktop_state')
  if (report.before.enabled && report.status.desktopAttached && !report.status.editing) {
    assert.equal(report.desktop.transparent, true); assert.equal(report.desktop.topmost, false)
    if (report.desktop.parentClass === 'Progman') assert.equal(report.desktop.betweenDesktopLayers, true)
  }
  report.after = await invoke('get_settings')
  report.preferencesUnchanged = JSON.stringify(report.before) === JSON.stringify(report.after)
  assert.deepEqual(report.errors, [])
} catch (error) { report.error = String(error); process.exitCode = 1 }
finally {
  if (originalTab) await page.getByRole('tab', { name: originalTab.trim(), exact: true }).click()
  writeFileSync('artifacts/native-inspector.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2)); await browser.close()
}
