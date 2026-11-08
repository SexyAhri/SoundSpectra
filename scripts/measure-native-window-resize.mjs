import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const label = process.argv[2]
if (!label || !/^[\w-]+$/.test(label)) throw Error('Pass a unique report label')
const folder = `artifacts/native-window-resize/${label}`
await mkdir(folder, { recursive: true })
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => /^(http:\/\/tauri.localhost|http:\/\/127.0.0.1:1420)\//.test(p.url()) && !p.url().includes('window='))
  if (!page) throw Error('SoundSpectra settings window with local debugging is required')
  await page.waitForSelector('.window-controls button[aria-label="最大化"], .window-controls button[aria-label="还原窗口"]')
  await page.waitForFunction(() => [...document.querySelectorAll('canvas[data-renderer="three"]')].some(c => c.dataset.preparing === 'false' && Number(c.dataset.frames) > 2))
  const result = await page.evaluate(async () => {
    const invoke = (name, args) => window.__TAURI_INTERNALS__.invoke(name, args)
    const before = JSON.stringify(await invoke('get_settings'))
    const initial = await invoke('plugin:window|is_maximized', { label: 'settings' })
    const rows = [], longTasks = [], writes = [], restores = []
    const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))))
    observer.observe({ type: 'longtask' })
    const canvases = () => [...document.querySelectorAll('canvas[data-renderer="three"]')]
    let compiles = 0
    for (const canvas of canvases()) {
      const gl = canvas.getContext('webgl2'), compile = gl.compileShader
      gl.compileShader = function(shader) { compiles++; return compile.call(this, shader) }
      restores.push(() => { gl.compileShader = compile })
    }
    const inspect = () => canvases().map(c => ({ effect: c.dataset.scene, buffer: [c.width, c.height], context: c.dataset.contextId,
      preparations: c.dataset.preparations, programs: c.dataset.programs, frames: c.dataset.frames, frameMs: c.dataset.frameMs, resizeMs: c.dataset.resizeMs,
      firstResizedFrameMs: c.dataset.resizeFirstFrameMs, resumeMs: c.dataset.resizeResumeMs, held: c.dataset.resizePaused }))
    for (const key of ['width', 'height']) {
      const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key)
      Object.defineProperty(HTMLCanvasElement.prototype, key, { ...d, set(value) {
        const start = performance.now(); d.set.call(this, value)
        if (this.dataset.renderer === 'three') writes.push({ start, key, value, cost: performance.now() - start })
      } })
      restores.push(() => Object.defineProperty(HTMLCanvasElement.prototype, key, d))
    }
    try {
      for (const target of [!initial, initial, !initial, initial]) {
        const start = performance.now(), frames = [], firstWrite = writes.length, firstCompile = compiles, prior = inspect()
        let previous = start, raf = 0
        const sample = now => { frames.push({ time: now, gap: now - previous }); previous = now; raf = requestAnimationFrame(sample) }
        raf = requestAnimationFrame(sample)
        try {
          const button = document.querySelector(`.window-controls button[aria-label="${target ? '最大化' : '还原窗口'}"]`)
          if (!button) throw Error('Maximize/restore control unavailable')
          button.click()
          const deadline = performance.now() + 8000
          while (await invoke('plugin:window|is_maximized', { label: 'settings' }) !== target) {
            if (performance.now() > deadline) throw Error('Native window state did not settle')
            await new Promise(r => setTimeout(r, 30))
          }
          const stateAt = performance.now()
          await new Promise(r => setTimeout(r, 1700))
          rows.push({ target, nativeStateMs: stateAt - start, rafMaxGap: Math.max(0, ...frames.map(f => f.gap)),
            rafOver50: frames.filter(f => f.gap > 50), longTasks: longTasks.filter(e => e.start >= start),
            bufferWrites: writes.slice(firstWrite), shaderCompiles: compiles - firstCompile, before: prior, after: inspect() })
        } finally { cancelAnimationFrame(raf) }
      }
    } finally {
      observer.disconnect(); restores.reverse().forEach(restore => restore())
      if (await invoke('plugin:window|is_maximized', { label: 'settings' }) !== initial)
        await invoke('plugin:window|toggle_maximize', { label: 'settings' })
    }
    return { url: location.href, initial, settingsUnchanged: before === JSON.stringify(await invoke('get_settings')), rows,
      method: 'Actual titlebar button in native WebView2; live audio unchanged. RAF and long tasks measure scheduling, not physical presentation FPS.' }
  })
  await writeFile(`${folder}/report.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally { await browser.close() }
