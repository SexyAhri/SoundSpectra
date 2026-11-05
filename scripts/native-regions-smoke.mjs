import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

mkdirSync('artifacts', { recursive: true })
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const pages = browser.contexts().flatMap(c => c.pages())
const page = pages.find(p => p.url().startsWith('http://tauri.localhost') && !p.url().includes('window=overlay'))
const overlay = pages.find(p => p.url().includes('window=overlay'))
assert.ok(page && overlay, 'Requires packaged settings and overlay windows')
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const id = `test-${randomUUID()}`, maskId = `test-${randomUUID()}`
const report = { errors: [] }
for (const target of [page, overlay]) target.on('pageerror', e => report.errors.push(e.message))
const visible = s => [{ id: 'primary', visible: s.regionVisible, bounds: s.bounds }, ...s.regions].filter(r => r.visible)
const envelope = s => {
  const regions = visible(s), x = Math.min(...regions.map(r => r.bounds.x)), y = Math.min(...regions.map(r => r.bounds.y))
  return { x, y, width: Math.max(...regions.map(r => r.bounds.x + r.bounds.width)) - x, height: Math.max(...regions.map(r => r.bounds.y + r.bounds.height)) - y }
}
async function checkGeometry(settings) {
  const state = await invoke('debug_desktop_state'), background = await invoke('get_desktop_background')
  assert.equal(state.attached, true); assert.equal(state.transparent, true); assert.equal(state.topmost, false)
  if (state.parentClass === 'Progman') assert.equal(state.betweenDesktopLayers, true)
  const b = envelope(settings), screen = background.screen
  const x = screen.x + Math.round(b.x * screen.width), y = screen.y + Math.round(b.y * screen.height)
  const expected = [x, y, x + Math.round(b.width * screen.width), y + Math.round(b.height * screen.height)]
  state.rect.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) <= 1))
  let boxes
  await expect.poll(async () => {
    boxes = await overlay.locator('.desktop-region').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { id: el.dataset.regionId, x: r.x / innerWidth, y: r.y / innerHeight, width: r.width / innerWidth, height: r.height / innerHeight } }))
    return visible(settings).every(region => {
      const rect = boxes.find(r => r.id === region.id)
      return rect && Object.entries({ x: (region.bounds.x - b.x) / b.width, y: (region.bounds.y - b.y) / b.height, width: region.bounds.width / b.width, height: region.bounds.height / b.height }).every(([key, expected]) => Math.abs(rect[key] - expected) < .002)
    })
  }, { timeout: 3000, message: 'Overlay DOM must settle after the native HWND resize' }).toBe(true)
  return { state, boxes }
}
const sample = () => overlay.locator(`[data-region-id="${id}"] canvas`).evaluate(canvas => new Promise((resolve, reject) => {
  const gl = canvas.getContext('webgl2'), draw = gl.drawArrays
  const timer = setTimeout(() => { gl.drawArrays = draw; reject(new Error('No audio-driven draw within 4s')) }, 4000)
  gl.drawArrays = function (...args) {
    draw.apply(this, args); gl.drawArrays = draw; clearTimeout(timer)
    const pixels = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    let leftAlpha = 0, rightAlpha = 0
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const alpha = pixels[(y * canvas.width + x) * 4 + 3]
      if (x < canvas.width / 2 - 2) leftAlpha += alpha
      if (x > canvas.width / 2 + 2) rightAlpha += alpha
    }
    resolve({ leftAlpha, rightAlpha, width: canvas.width, height: canvas.height, error: gl.getError() })
  }
}))
try {
  await expect(page.getByText('设置已保存', { exact: true })).toBeVisible()
  report.before = await invoke('get_settings'); report.status = await invoke('get_status')
  assert.ok(report.before.enabled && !report.status.editing, 'Desktop must be enabled and not being dragged')
  assert.ok(report.before.regions.length < 3 && report.before.masks.length < 8, 'Needs one free region and mask slot')
  const keys = ['effect', 'sceneMode', 'color', 'opacity', 'sensitivity', 'decay', 'reflection', 'glow']
  const region = { ...Object.fromEntries(keys.map(k => [k, report.before[k]])), effect: 'bars', id, name: '验证区域', visible: true, bounds: { x: .05, y: .08, width: .4, height: .25 } }
  const mask = { id: maskId, bounds: { x: .05, y: .08, width: .2, height: .25 }, feather: 0 }
  // Read fresh before each write; cleanup removes only our uniquely identified fixtures.
  const latest = await invoke('get_settings')
  await invoke('update_settings', { settings: { ...latest, regions: [...latest.regions, region], masks: [...latest.masks, mask] } })
  await expect(overlay.locator(`[data-region-id="${id}"] canvas`)).toHaveCount(1)
  report.during = await invoke('get_settings'); report.geometry = await checkGeometry(report.during)
  if (report.status.state === 'listening') {
    await expect.poll(async () => { report.masked = await sample(); return report.masked.rightAlpha }, { timeout: 10000 }).toBeGreaterThan(0)
    assert.equal(report.masked.leftAlpha, 0); assert.equal(report.masked.error, 0)
    const current = await invoke('get_settings')
    assert.ok(current.regions.some(r => r.id === id), 'Test region was removed during verification')
    await invoke('update_settings', { settings: { ...current, masks: current.masks.filter(m => m.id !== maskId) } })
    await expect.poll(async () => { report.unmasked = await sample(); return report.unmasked.leftAlpha }, { timeout: 10000 }).toBeGreaterThan(0)
  } else report.audio = 'No live playback; geometry checked, live alpha verification skipped'
  const current = await invoke('get_settings')
  await invoke('update_settings', { settings: { ...current, regions: current.regions.map(r => r.id === id ? { ...r, visible: false } : r) } })
  await expect(overlay.locator(`[data-region-id="${id}"] canvas`)).toHaveCount(0)
  report.hidden = await invoke('get_settings')
  if (visible(report.hidden).length) report.hiddenGeometry = await checkGeometry(report.hidden)
  assert.deepEqual(report.errors, [])
} catch (error) { report.error = String(error); process.exitCode = 1 }
finally {
  const latest = await invoke('get_settings')
  const clean = { ...latest, regions: latest.regions.filter(r => r.id !== id), masks: latest.masks.filter(m => m.id !== maskId) }
  if (JSON.stringify(clean) !== JSON.stringify(latest)) await invoke('update_settings', { settings: clean })
  report.after = await invoke('get_settings')
  report.originalPreferencesPreserved = JSON.stringify(report.before) === JSON.stringify(report.after)
  await page.screenshot({ path: 'artifacts/native-regions.png' })
  writeFileSync('artifacts/native-regions.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2)); await browser.close()
}
