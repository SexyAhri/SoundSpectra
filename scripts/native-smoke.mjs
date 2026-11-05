// Opt-in integration check against this application's WebView2 debug port.
// No browser-wide or Windows input automation is performed.
import { chromium, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const pages = browser.contexts().flatMap((context) => context.pages())
const page = pages.find((item) => !item.url().includes('window=overlay') && (item.url().includes('127.0.0.1:1420') || item.url().includes('tauri.localhost')))
if (!page) throw new Error('找不到 SoundSpectra 设置窗口，未操作其他页面。')
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
await page.waitForSelector('.app-shell')
const original = await invoke('get_settings')
const report = { original, consoleErrors: [], audio: null, desktop: null, editing: null, restored: null }
page.on('pageerror', (error) => report.consoleErrors.push(error.message))
await page.evaluate(async () => {
  window.__spectrumProbe = { frames: 0, peak: 0, nonzero: 0 }
  const internal = window.__TAURI_INTERNALS__
  const handler = internal.transformCallback(({ payload: bands }) => {
    const peak = Math.max(...bands)
    window.__spectrumProbe.frames++
    window.__spectrumProbe.peak = Math.max(window.__spectrumProbe.peak, peak)
    if (peak > 0.015) window.__spectrumProbe.nonzero++
  })
  const eventId = await internal.invoke('plugin:event|listen', { event: 'spectrum', target: { kind: 'Any' }, handler })
  window.__stopSpectrumProbe = async () => {
    await internal.invoke('plugin:event|unlisten', { event: 'spectrum', eventId })
    internal.unregisterCallback(handler)
  }
})
try {
  await page.waitForTimeout(6000)
  report.audio = { ...await page.evaluate(() => window.__spectrumProbe), status: await invoke('get_status') }
  console.log('Audio:', JSON.stringify(report.audio))
  assert.ok(report.audio.frames > 0, '未收到原生音频帧')
  assert.ok(report.audio.nonzero > 0, 'QQ 音乐播放期间没有非零频谱')
  assert.ok(report.audio.status.processId > 0, '未连接 QQ 音乐进程')
  const desktopSwitch = page.getByRole('switch', { name: '显示到桌面' })
  if (!original.enabled) await desktopSwitch.click()
  await expect(desktopSwitch).toHaveAttribute('aria-checked', 'true')
  await expect.poll(async () => (await invoke('get_status')).desktopAttached, { timeout: 10000 }).toBe(true)
  report.desktop = await invoke('debug_desktop_state')
  console.log('Desktop:', JSON.stringify(report.desktop))
  assert.ok(report.desktop.parentClass === 'WorkerW' || report.desktop.betweenDesktopLayers)
  assert.equal(report.desktop.child, true)
  assert.equal(report.desktop.transparent, true)
  assert.equal(report.desktop.noActivate, true)
  assert.equal(report.desktop.topmost, false)
  assert.equal(report.desktop.visible, true)
  await page.getByRole('button', { name: '调整桌面位置', exact: true }).click()
  await expect(page.getByRole('button', { name: '完成调整', exact: true })).toBeVisible()
  report.editing = await invoke('debug_desktop_state')
  console.log('Editing:', JSON.stringify(report.editing))
  assert.equal(report.editing.child, false)
  assert.equal(report.editing.transparent, false)
  assert.equal(report.editing.topmost, true)
  const overlay = pages.find((item) => item.url().includes('window=overlay'))
  assert.ok(overlay, '找不到频谱效果窗口')
  await expect(overlay.getByRole('button', { name: '完成 · Esc' })).toBeVisible()
  report.overlayPixels = await overlay.locator('canvas').evaluate((canvas) => {
    const gl = canvas.getContext('webgl2')
    return new Promise((resolve, reject) => {
      const draw = gl.drawArrays
      const timeout = setTimeout(() => { gl.drawArrays = draw; reject(new Error('频谱未绘制')) }, 2000)
      gl.drawArrays = function (...args) {
        draw.apply(this, args)
        gl.drawArrays = draw
        clearTimeout(timeout)
        // Read on an actual render, not a skipped frame on a high-refresh monitor.
        const pixels = new Uint8Array(canvas.width * canvas.height * 4)
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        let visible = 0
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 8) visible++
        resolve(visible)
      }
    })
  })
  assert.ok(report.overlayPixels > 100, '真实音频未绘制为可见频谱')
  await overlay.getByRole('button', { name: '完成 · Esc' }).click()
  await expect(page.getByRole('button', { name: '调整桌面位置', exact: true })).toBeVisible()
  report.restored = await invoke('debug_desktop_state')
  assert.equal(report.restored.transparent, true)
  assert.equal(report.restored.topmost, false)
  assert.ok(report.restored.parentClass === 'WorkerW' || report.restored.betweenDesktopLayers)
  await page.waitForTimeout(500)
  mkdirSync('artifacts', { recursive: true })
  await page.screenshot({ path: 'artifacts/settings-native.png' })
} catch (error) {
  report.error = String(error)
  process.exitCode = 1
  console.error(error)
} finally {
  try {
    const status = await invoke('get_status')
    if (status.editing) await invoke('set_editing', { editing: false })
    if (!original.enabled) {
      const latest = await invoke('get_settings')
      await invoke('update_settings', { settings: { ...latest, enabled: false } })
    }
  } catch (error) { report.restoreError = String(error); process.exitCode = 1 }
  await page.evaluate(() => window.__stopSpectrumProbe?.())
  mkdirSync('artifacts', { recursive: true })
  writeFileSync('artifacts/native-smoke.json', JSON.stringify(report, null, 2))
  await browser.close()
}
