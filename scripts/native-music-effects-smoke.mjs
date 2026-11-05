// Verification against an already running debug-enabled desktop build and real music.
import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const report = { errors: [], effects: [], audio: {} }
try {
  const pages = browser.contexts().flatMap(context => context.pages())
  const page = pages.find(page => /^(?:http:\/\/tauri\.localhost|http:\/\/127\.0\.0\.1:1420)(?:\/|$)/.test(page.url()) && !page.url().includes('window=overlay'))
  assert.ok(page, 'Requires the current packaged or development app with WebView debugging enabled')
  page.on('pageerror', error => report.errors.push(error.message))
  const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
  assert.equal(await invoke('plugin:window|is_minimized',{label:'settings'}),false,'Restore the settings window before checking its pixels; minimized previews intentionally stop rendering')
  await expect.poll(async () => (await invoke('get_status')).state, { timeout: 15000 }).toBe('listening')
  report.status = await invoke('get_status')
  await expect(page.getByRole('switch', { name: '模拟预览' })).toHaveAttribute('aria-checked', 'false')
  report.audio = await page.evaluate(() => new Promise(async resolve => {
    const internal = window.__TAURI_INTERNALS__
    const result = { frames: 0, rmsMin: Infinity, rmsMax: 0, rmsChanges: 0, bandsPeak: 0, spectrumPeak: 0, skinPeak: 0, lengthsValid: true }
    let previous = 0
    const handler = internal.transformCallback(({ payload }) => {
      result.frames++
      result.lengthsValid &&= payload.bands.length === 6 && payload.spectrum.length === 48 && payload.skin.length === 256
      result.rmsMin = Math.min(result.rmsMin, payload.rms); result.rmsMax = Math.max(result.rmsMax, payload.rms)
      if (Math.abs(payload.rms - previous) > .00001) result.rmsChanges++
      previous = payload.rms
      result.bandsPeak = Math.max(result.bandsPeak, ...payload.bands)
      result.spectrumPeak = Math.max(result.spectrumPeak, ...payload.spectrum)
      result.skinPeak = Math.max(result.skinPeak, ...payload.skin)
    })
    const eventId = await internal.invoke('plugin:event|listen', { event: 'music-analysis', target: { kind: 'Any' }, handler })
    setTimeout(async () => {
      await internal.invoke('plugin:event|unlisten', { event: 'music-analysis', eventId })
      internal.unregisterCallback(handler); resolve(result)
    }, 4000)
  }))
  assert.ok(report.audio.frames > 60, 'Requires actual PCM analysis events')
  assert.ok(report.audio.rmsMax > .006 && report.audio.rmsChanges > 20, 'Requires audible, changing real RMS')
  assert.ok(report.audio.bandsPeak > 0 && report.audio.spectrumPeak > 0 && report.audio.skinPeak > 0)
  assert.equal(report.audio.lengthsValid, true)
  const initial = await invoke('get_settings')
  try {
    await invoke('update_settings', { settings: { ...initial, sceneMode:'immersive',
      view:{yaw:0,pitch:0,roll:0,x:0,y:0,distance:1},bounds:{x:0,y:0,width:1,height:1},
      regions:[],masks:[],music:{...initial.music,fieldScale:1.35,fieldBrightness:60} } })
    await page.reload()
    const effects = [
      ['rhythm_balls', '弹球'], ['rhythm_rain', '落雨'], ['rhythm_fluid', '熔金潮汐'], ['rhythm_skin', '风织绸境'],
      ['spectrum_bars', '频谱柱'], ['ripple', '雪花飘舞'], ['pulse_ring', '脉冲光环'], ['volume_rain', '晴空浮游'],
      ['dream_stars', '梦幻星空'], ['vortex', '旋涡'], ['water_ripple', '水波纹'], ['rhythm_bars', '丹霞声谷'],
    ]
    for (const [id, label] of effects.filter(([id])=>!process.argv.includes('--immersive') || id==='rhythm_fluid' || id==='pulse_ring')) {
      await page.getByRole('tab', { name: '动效', exact: true }).click()
      await page.getByRole('button', { name: label, exact: true }).click()
      await expect.poll(async () => (await invoke('get_settings')).effect).toBe(id)
      const canvas = page.locator('.three-scene-surface canvas').first()
      await expect(canvas).toHaveAttribute('data-renderer', 'three')
      await expect(canvas).toHaveAttribute('data-scene', id)
      await expect(canvas).toHaveAttribute('data-geometry', 'spatial')
      await page.waitForTimeout(400)
      let pixels
      await expect.poll(async () => {
        pixels = await canvas.evaluate(canvas => new Promise(resolve => {
        const gl = canvas.getContext('webgl2')
        const arrays = gl.drawArrays, elements = gl.drawElements
        const arraysInstanced = gl.drawArraysInstanced, elementsInstanced = gl.drawElementsInstanced
        let finished = false, queued = false
        const read = () => {
          if (finished) return
          finished = true
          gl.drawArrays = arrays; gl.drawElements = elements
          gl.drawArraysInstanced = arraysInstanced; gl.drawElementsInstanced = elementsInstanced
          clearTimeout(timer)
          const data = new Uint8Array(canvas.width * canvas.height * 4)
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data)
          let visible = 0, lit = 0
          for (let i = 0; i < data.length; i += 4) {
            if (data[i+3] > 8) visible++
            if (Math.max(data[i],data[i+1],data[i+2]) > 45) lit++
          }
          resolve({ visible,lit,rms:Number(canvas.dataset.rms),error:gl.getError() })
        }
        const timer = setTimeout(read, 1500)
        // Read after the entire scene + composite stack, never its intermediate target.
        const after = () => { if (!queued) { queued = true; queueMicrotask(read) } }
        gl.drawArrays = function (...args) { arrays.apply(this, args); after() }
        gl.drawElements = function (...args) { elements.apply(this, args); after() }
        gl.drawArraysInstanced = function (...args) { arraysInstanced.apply(this, args); after() }
        gl.drawElementsInstanced = function (...args) { elementsInstanced.apply(this, args); after() }
        }))
        return pixels.visible>20 && pixels.lit>20
      },{timeout:15000,message:`${id} needs real-audio geometry (waiting through track gaps)`}).toBe(true)
      report.effects.push({ id, ...pixels })
      assert.equal(pixels.error, 0, id)
      assert.ok(pixels.visible > 20, `${id} requires visible real-audio pixels`)
    }
    await expect(page.getByRole('alert')).toHaveCount(0)
    assert.deepEqual(report.errors, [])
    await page.screenshot({ path: 'artifacts/native-music-engine.png' })
  } finally {
    await invoke('update_settings', { settings: initial })
  }
  report.desktop = await invoke('debug_desktop_state')
  assert.equal(report.desktop.topmost, false)
  assert.equal(report.desktop.noActivate, true)
} finally {
  writeFileSync('artifacts/native-music-engine.json', JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))
