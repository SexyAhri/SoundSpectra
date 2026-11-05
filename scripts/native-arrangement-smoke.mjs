import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('artifacts', { recursive: true })
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
await expect.poll(() => browser.contexts().flatMap(c => c.pages()).filter(p => p.url().startsWith('http://tauri.localhost')).length, { timeout: 10000 }).toBeGreaterThanOrEqual(2)
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('http://tauri.localhost') && !p.url().includes('window=overlay'))
const invoke = command => page.evaluate(command => window.__TAURI_INTERNALS__.invoke(command), command)
const report = { errors: [] }
page.on('pageerror', e => report.errors.push(e.message))
try {
  await expect(page.getByText('设置已保存', { exact: true })).toBeVisible()
  report.before = await invoke('get_settings')
  const background = await invoke('get_desktop_background')
  report.wallpaper = { ...background, image: Boolean(background.image) }
  const mode = await page.getByRole('group', { name: '预览背景' }).locator('[aria-pressed="true"]').innerText()
  report.previewMode = mode
  const palette = page.getByRole('group', { name: /配色建议/ })
  if (mode === '纯色') {
    assert.equal(await palette.count(), 0)
    report.palette = 'User selected plain background; no palette shown'
  } else {
    assert.equal(background.issue, null)
    const suggestions = palette.getByRole('button', { name: /^应用/ })
    await expect(suggestions.first()).toBeVisible()
    report.palette = await suggestions.evaluateAll(buttons => buttons.map(button => ({ label: button.getAttribute('aria-label'), selected: button.getAttribute('aria-pressed'), disabled: button.disabled })))
    assert.ok(report.palette.length >= 1 && report.palette.length <= 3)
    for (const color of report.palette) assert.match(color.label, /^应用.+色 #[0-9a-f]{6}$/)
  }
  report.status = await invoke('get_status')
  report.desktop = await invoke('debug_desktop_state')
  if (report.before.enabled && !report.status.editing) {
    assert.equal(report.desktop.attached, true)
    assert.equal(report.desktop.transparent, true)
    assert.equal(report.desktop.topmost, false)
    if (report.desktop.parentClass === 'Progman') assert.equal(report.desktop.betweenDesktopLayers, true)
    const screen = background.screen, bounds = report.before.bounds
    const x = screen.x + Math.round(bounds.x * screen.width), y = screen.y + Math.round(bounds.y * screen.height)
    assert.deepEqual(report.desktop.rect, [x, y, x + Math.round(bounds.width * screen.width), y + Math.round(bounds.height * screen.height)])
  }
  report.after = await invoke('get_settings')
  report.settingsUnchanged = JSON.stringify(report.after) === JSON.stringify(report.before)
  assert.ok(report.settingsUnchanged, 'This read-only verification must not write preferences')
  await page.screenshot({ path: 'artifacts/native-arrangement.png' })
  assert.deepEqual(report.errors, [])
} catch (error) { report.error = String(error); process.exitCode = 1 }
finally {
  writeFileSync('artifacts/native-arrangement.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}
