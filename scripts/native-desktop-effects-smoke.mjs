// Read-only check of desktop presentation on the user's currently saved scene.
import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const report = { errors: [] }
try {
  await expect.poll(() => browser.contexts().flatMap(c => c.pages()).filter(p => p.url().startsWith('http://tauri.localhost')).length).toBeGreaterThanOrEqual(2)
  const pages = browser.contexts().flatMap(c => c.pages())
  const page = pages.find(p => p.url().startsWith('http://tauri.localhost') && !p.url().includes('window=overlay'))
  const overlay = pages.find(p => p.url().includes('window=overlay'))
  assert.ok(page && overlay)
  const invoke = command => page.evaluate(command => window.__TAURI_INTERNALS__.invoke(command),command)
  for (const target of [page,overlay]) target.on('pageerror',error => report.errors.push(error.message))
  await expect.poll(async () => (await invoke('get_status')).state,{ timeout: 15000 }).toBe('listening')
  await expect(page.getByRole('switch',{ name: '模拟预览' })).toHaveAttribute('aria-checked','false')
  await page.evaluate(async () => {
    const internal = window.__TAURI_INTERNALS__
    window.__desktopAudio = { frames: 0, nonzero: 0, minRms: 1, maxRms: 0 }
    const handler = internal.transformCallback(({ payload }) => {
      const probe = window.__desktopAudio
      probe.frames++; if (payload.rms > .006) probe.nonzero++
      probe.minRms = Math.min(probe.minRms,payload.rms); probe.maxRms = Math.max(probe.maxRms,payload.rms)
    })
    const eventId = await internal.invoke('plugin:event|listen',{ event: 'music-analysis', target: { kind: 'Any' },handler })
    window.__stopDesktopAudio = async () => { await internal.invoke('plugin:event|unlisten',{ event: 'music-analysis',eventId }); internal.unregisterCallback(handler) }
  })
  report.canvases = await overlay.locator('.spectrum-surface canvas').evaluateAll(canvases => Promise.all(canvases.map(canvas => {
    const gl = canvas.getContext('webgl2'), draw = gl.drawArrays
    const result = { frames: 0, visible: 0, edge: 0, maxAlpha: 0, error: 0, feather: [], fluid: 0, width: canvas.width, height: canvas.height }
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), queries = []
    const started = performance.now()
    return new Promise(resolve => {
      gl.drawArrays = function (...args) {
        const query = ext && result.frames % 15 === 0 && queries.length < 10 ? gl.createQuery() : null
        if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT,query)
        draw.apply(this,args)
        if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push(query) }
        result.frames++
        if ([20,40,60].includes(result.frames)) {
          const program = gl.getParameter(gl.CURRENT_PROGRAM), location = gl.getUniformLocation(program,'u_edges')
          if (location) result.feather = [...gl.getUniform(program,location)]
          const fluid = gl.getUniformLocation(program,'u_fluid'); if (fluid) result.fluid = gl.getUniform(program,fluid)
          const pixels = new Uint8Array(canvas.width*canvas.height*4)
          gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
          let visible = 0
          for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
            const alpha = pixels[(y*canvas.width+x)*4+3]
            if (alpha > 8) visible++
            result.maxAlpha = Math.max(result.maxAlpha,alpha)
            if (x === 0 || x === canvas.width-1 || y === 0 || y === canvas.height-1) result.edge = Math.max(result.edge,alpha)
          }
          result.visible = Math.max(result.visible,visible)
        }
      }
      setTimeout(() => {
        gl.drawArrays = draw; result.error = gl.getError()
        const times = ext && !gl.getParameter(ext.GPU_DISJOINT_EXT) ? queries.filter(q => gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)).map(q => gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6).sort((a,b) => a-b) : []
        queries.forEach(q => gl.deleteQuery(q))
        resolve({ ...result, seconds: (performance.now()-started)/1000, gpuMedianMs: times.length ? times[Math.floor(times.length/2)] : null })
      },3000)
    })
  })))
  report.audio = { ...await page.evaluate(() => window.__desktopAudio), status: await invoke('get_status') }
  await page.evaluate(() => window.__stopDesktopAudio())
  assert.ok(report.audio.nonzero > 30)
  for (const canvas of report.canvases) {
    assert.ok(canvas.frames >= 20); assert.ok(canvas.visible > 20)
    assert.equal(canvas.error,0); assert.equal(canvas.feather.length,2)
    assert.ok(canvas.feather[0] > .03 && canvas.feather[1] > .05)
    assert.ok(canvas.edge <= canvas.maxAlpha * .15 + 2)
    if (canvas.fluid > .5) assert.ok(canvas.maxAlpha < 185)
  }
  const settings = await invoke('get_settings')
  assert.deepEqual(settings,JSON.parse(readFileSync(join(process.env.APPDATA,'com.soundspectra.desktop','settings.json'),'utf8')))
  report.latestSavedSettingsMatch = true
  report.effect = settings.effect; report.bounds = settings.bounds; report.card = settings.desktopCard
  report.desktop = await invoke('debug_desktop_state')
  if (settings.enabled && !report.audio.status.editing) {
    assert.equal(report.desktop.attached,true); assert.equal(report.desktop.transparent,true)
    assert.equal(report.desktop.topmost,false); assert.equal(report.desktop.noActivate,true)
  }
  await expect(page.getByRole('alert')).toHaveCount(0)
  assert.deepEqual(report.errors,[])
  await page.screenshot({ path: 'artifacts/native-desktop-effects.png' })
} catch (error) {
  report.error = String(error); process.exitCode = 1
} finally {
  writeFileSync('artifacts/native-desktop-effects.json',JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
  await browser.close()
}
