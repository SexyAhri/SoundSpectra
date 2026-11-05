import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('artifacts', { recursive: true })
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('http://tauri.localhost') && !p.url().includes('window=overlay'))
assert.ok(page, 'Requires the packaged settings window')
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const report = { schemes: [], errors: [] }
page.on('pageerror', error => report.errors.push(error.message))
let background
try {
  await expect(page.getByText('设置已保存', { exact: true })).toBeVisible()
  report.before = await invoke('get_settings')
  background = await page.locator('.preview-background-controls button[aria-pressed="true"]').textContent()
  await page.getByRole('button', { name: '桌面壁纸', exact: true }).click()
  await expect(page.getByTestId('preview-wallpaper')).toHaveCSS('background-image', /data:image/)
  await page.getByRole('button', { name: '自动搭配', exact: true }).click()
  await expect(page.getByRole('button', { name: '应用搭配', exact: true })).toBeEnabled()
  // Simulation belongs only to this draft dialog; never change the user's scene or audio source.
  const simulate = page.getByRole('switch', { name: '搭配模拟音频' })
  if (await simulate.getAttribute('aria-checked') !== 'true') await simulate.click()
  for (const name of ['星光留白', '流萤轻舞', '流光律动', '山谷晚风']) {
    await page.getByRole('button', { name: new RegExp(name) }).click()
    await expect(page.locator('canvas')).toHaveCount(['星光留白', '山谷晚风'].includes(name) ? 1 : 2)
    const output = await page.locator('canvas').evaluateAll(canvases => Promise.all(canvases.map(canvas => {
      const gl = canvas.getContext('webgl2'), draw = gl.drawArrays
      return new Promise(resolve => {
        let frames = 0, visible = 0
        gl.drawArrays = function(...args) {
          draw.apply(this, args); frames++
          if (frames % 6 !== 0 || !gl.getParameter(gl.COLOR_WRITEMASK)[0]) return
          const pixels = new Uint8Array(canvas.width * canvas.height * 4)
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
          let count = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 4) count++
          visible = Math.max(visible, count)
        }
        setTimeout(() => { gl.drawArrays = draw; resolve({ frames, visible, error: gl.getError(), width: canvas.width, height: canvas.height }) }, 1200)
      })
    })))
    assert.ok(output.every(item => item.frames > 0 && item.visible > 0 && item.error === 0), `Invalid GPU output for ${name}`)
    report.schemes.push({ name, output })
  }
  await page.getByRole('slider', { name: '搭配氛围强度' }).focus()
  await page.keyboard.press('End')
  await page.screenshot({ path: 'artifacts/native-auto-scene.png' })
  await page.getByRole('button', { name: '关闭自动搭配' }).click()
  report.after = await invoke('get_settings')
  assert.deepEqual(report.after, report.before, 'Preview/cancel must preserve the user configuration')
  report.status = await invoke('get_status'); report.desktop = await invoke('debug_desktop_state')
  if (report.before.enabled && report.status.desktopAttached && !report.status.editing) {
    assert.equal(report.desktop.transparent, true); assert.equal(report.desktop.topmost, false)
    if (report.desktop.parentClass === 'Progman') assert.equal(report.desktop.betweenDesktopLayers, true)
  }
  assert.deepEqual(report.errors, [])
} catch (error) { report.error = String(error); process.exitCode = 1 }
finally {
  const close = page.getByRole('button', { name: '关闭自动搭配' })
  if (await close.count()) await close.click()
  if (background && background.trim() !== '桌面壁纸') {
    const label = background.trim() === '纯色' ? '纯色预览背景' : background.trim()
    await page.getByRole('button', { name: label, exact: true }).click()
  }
  writeFileSync('artifacts/native-auto-scene.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2)); await browser.close()
}
