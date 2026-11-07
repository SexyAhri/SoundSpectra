// Opt-in integration against the running development WebView and its real player.
// Temporary region/show only; the player is paused briefly and then resumed.
import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'

const folder = 'artifacts/performance-native'
await mkdir(folder, { recursive: true })
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const pages = browser.contexts().flatMap(c => c.pages())
const page = pages.find(p => /^http:\/\/127\.0\.0\.1:1420\/(?!.*window=)/.test(p.url()))
assert.ok(page, 'Requires the current development window, not an installed build')
const overlay = pages.find(p => p.url().includes('127.0.0.1:1420/') && p.url().includes('window=overlay'))
assert.ok(overlay, 'Requires the native desktop WebView')
// Import the same HMR module URL as the mounted app. Importing an unversioned
// duplicate registers a second React context and can invalidate live consumers.
const workspaceSource = await (await fetch('http://127.0.0.1:1420/src/features/settings/settings-workspace.tsx')).text()
const runtimeUrl = workspaceSource.match(/from "([^"\n]*\/performance\/runtime\.tsx[^"\n]*)"/)?.[1]
assert.ok(runtimeUrl, 'Requires the mounted performance runtime URL')
for (const target of [page, overlay]) {
  await target.addInitScript(url => { window.__performanceReviewRuntimeUrl = url }, runtimeUrl)
  await target.evaluate(url => { window.__performanceReviewRuntimeUrl = url }, runtimeUrl)
}
await page.addInitScript(exitOnly => { window.__performanceReviewExitOnly = exitOnly }, process.env.PERFORMANCE_REVIEW_EXIT === '1')
await page.evaluate(exitOnly => { window.__performanceReviewExitOnly = exitOnly }, process.env.PERFORMANCE_REVIEW_EXIT === '1')
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const regionId = `review-${Date.now()}`
const showId = `${regionId}-show`
const report = { mode: process.env.PERFORMANCE_REVIEW_EXIT === '1' ? 'restore-only' : 'full', errors: [], manual: [], sequence: [], sessionEvents: [], restored: false }
page.on('pageerror', e => report.errors.push(e.message))
overlay.on('pageerror', e => report.errors.push(e.message))
let original, originalConfig, initialPlayer, pausedByTest = false, addedRegion = false, armedByTest = false, hiddenConsumers = false
const canvas = p => p.locator(`[data-region-id="${regionId}"] canvas`)
const scene = async effect => {
  const labels = { layered_tides: '层海', echo_corridor: '回声廊道', star_flight: '星尘航道', caustic_light: '水光焦散', tidal_knot: '潮汐之结' }
  await expect(canvas(overlay)).toHaveAttribute('data-transition', 'idle', { timeout: 20000 })
  await canvas(overlay).evaluate(el => {
    window.__reviewTransitionObserver?.disconnect()
    window.__reviewTransitionRoutes = []
    window.__reviewTransitionObserver = new MutationObserver(records => {
      for (const r of records) if (r.attributeName === 'data-transition') window.__reviewTransitionRoutes.push(el.dataset.transition)
    })
    window.__reviewTransitionObserver.observe(el, { attributes: true, attributeFilter: ['data-transition'] })
  })
  await page.getByRole('tab', { name: '动效', exact: true }).click()
  await page.getByRole('button', { name: '更换灯效', exact: true }).click()
  await page.getByRole('dialog', { name: '选择灯效', exact: true }).getByRole('button', { name: labels[effect], exact: true }).click()
  await expect(canvas(page)).toHaveAttribute('data-scene', effect, { timeout: 60000 })
  await expect(canvas(overlay)).toHaveAttribute('data-scene', effect, { timeout: 60000 })
  return overlay.evaluate(() => [...new Set(window.__reviewTransitionRoutes)])
}
try {
  await page.waitForSelector('.app-shell')
  if (await invoke('plugin:window|is_minimized', { label: 'settings' })) await invoke('plugin:window|unminimize', { label: 'settings' })
  original = await invoke('get_settings')
  await invoke('update_settings', { settings: { ...original, desktopCard: { ...original.desktopCard, enabled: false }, lyrics: { ...original.lyrics, enabled: false } } }); hiddenConsumers = true
  await page.waitForTimeout(1600)
  await expect.poll(async () => {
    const value = await invoke('get_now_playing')
    return !!(value.playing && value.timelineAvailable && value.trackId && value.duration - value.position > 70)
  }, { timeout: 120000, message: 'Waiting for an actual playing track with enough remaining time, without changing the player' }).toBe(true)
  initialPlayer = await invoke('get_now_playing')
  report.hiddenConsumers = { card: (await invoke('get_settings')).desktopCard.enabled, lyrics: (await invoke('get_settings')).lyrics.enabled, title: initialPlayer.title, position: initialPlayer.position }
  console.log('Real player:', JSON.stringify({ title: initialPlayer.title, position: initialPlayer.position, duration: initialPlayer.duration }))
  originalConfig = await page.evaluate(() => localStorage.getItem('soundspectra.performance.v1'))
  await writeFile(`${folder}/before.json`, JSON.stringify({ settings: original, config: originalConfig }, null, 2))
  assert.ok(original.enabled, 'Desktop output must already be enabled for this opt-in run')
  assert.ok(original.regions.length < 3, 'Requires space for a temporary review region')
  assert.ok(initialPlayer.playing && initialPlayer.timelineAvailable && initialPlayer.trackId, 'Requires a playing real recording with a timeline')
  assert.ok(initialPlayer.duration - initialPlayer.position > 70, 'Requires enough time before the natural track boundary')
  const liveSession = await overlay.evaluate(() => {
    const el=document.querySelector('canvas'),key=el&&Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let f=key?el[key]:null
    while(f){const v=f.memoizedProps?.value;if(v?.arm&&v?.info)return v.session;f=f.return}return null
  })
  assert.equal(liveSession, null, 'Leave an existing user performance untouched')
  report.source = { source: initialPlayer.source, trackId: initialPlayer.trackId, position: initialPlayer.position, duration: initialPlayer.duration }
  report.audio = await page.evaluate(async () => {
    const { listen } = await import('/node_modules/.vite/deps/@tauri-apps_api_event.js')
    const result = { frames: 0, rmsPeak: 0, physicalBandsPeak: 0 }
    const stop = await listen('music-analysis', ({ payload }) => {
      result.frames++; result.rmsPeak = Math.max(result.rmsPeak, payload.rms)
      result.physicalBandsPeak = Math.max(result.physicalBandsPeak, ...(payload.bandRms ?? [0]))
    })
    await new Promise(r => setTimeout(r, 2000)); stop(); return result
  })
  assert.ok(report.audio.frames > 30 && report.audio.rmsPeak > 0 && report.audio.physicalBandsPeak > 0, 'Requires actual changing PCM and physical band RMS')
  console.log('Real PCM:', JSON.stringify(report.audio))
  const settings = await page.evaluate(async ({ original, regionId }) => {
    const { regionStyle } = await import('/src/features/spectrum/regions.ts')
    return { ...original, desktopCard: { ...original.desktopCard, enabled: false }, lyrics: { ...original.lyrics, enabled: false }, regions: [...original.regions, { ...regionStyle(original), id: regionId, name: '演出联调临时区域', visible: true, effect: 'tidal_knot', sceneMode: 'immersive', bounds: { x: .65, y: .15, width: .3, height: .3 } }] }
  }, { original, regionId })
  await invoke('update_settings', { settings }); addedRegion = true
  // The workspace owns local pending edits; direct native writes intentionally
  // update the desktop, so reload once before continuing through the real UI.
  await page.reload()
  await page.getByRole('combobox', { name: '当前装饰区域', exact: true }).click()
  await page.getByRole('option', { name: '演出联调临时区域', exact: true }).click()
  await expect(canvas(page)).toHaveAttribute('data-scene', 'tidal_knot', { timeout: 20000 })
  await expect(canvas(overlay)).toHaveAttribute('data-scene', 'tidal_knot', { timeout: 20000 })
  await page.evaluate(async regionId => {
    const { readPerformance, savePerformance } = await import(window.__performanceReviewRuntimeUrl)
    const { originalMapping } = await import('/src/features/performance/model.ts')
    const c = readPerformance()
    savePerformance({ ...c, transition: { kind: 'particles', durationMs: 1800 }, mappings: { ...c.mappings, [`${regionId}--tidal_knot`]: { ...originalMapping, preset: 'bend', amount: 1 } } })
  }, regionId)
  await expect.poll(async () => JSON.parse(await canvas(overlay).getAttribute('data-mapping') || '{}').bend ?? 0, { timeout: 12000 }).toBeGreaterThan(0)
  report.mapping = await canvas(overlay).getAttribute('data-mapping')
  console.log('Desktop mapping:', report.mapping)
  if (process.env.PERFORMANCE_REVIEW_TRANSPORT !== '1') {
  report.manual.push({ target: 'layered_tides', routes: await scene('layered_tides') })
  assert.ok(report.manual.at(-1).routes.includes('particles'))
  await scene('echo_corridor')
  await page.evaluate(async () => {
    const { readPerformance, savePerformance } = await import(window.__performanceReviewRuntimeUrl)
    savePerformance({ ...readPerformance(), transition: { kind: 'travel', durationMs: 1800 } })
  })
  report.manual.push({ target: 'star_flight', routes: await scene('star_flight') })
  assert.ok(report.manual.at(-1).routes.includes('travel'))
  await scene('caustic_light'); report.enumRoundtrip = (await invoke('get_settings')).regions.find(r => r.id === regionId).effect
  await scene('tidal_knot')
  }
  const freshPlayer = await invoke('get_now_playing')
  assert.equal(freshPlayer.trackId, initialPlayer.trackId, 'Recording must remain unchanged during setup')
  if (freshPlayer.controls?.pause) {
    await invoke('control_card_media', { action: 'pause', trackId: freshPlayer.trackId, sessionId: freshPlayer.sessionId }); pausedByTest = true
    await expect.poll(async () => (await invoke('get_now_playing')).playing).toBe(false)
    // QQ publishes its final paused timeline after the playback-state event.
    await page.waitForTimeout(1800)
  }
  const at = await invoke('get_now_playing')
  console.log('Manual transitions:', JSON.stringify(report.manual), 'Player paused:', pausedByTest)
  await page.evaluate(async ({ regionId, showId, position }) => {
    const { exampleShow } = await import('/src/features/performance/model.ts')
    const { readPerformance, savePerformance } = await import(window.__performanceReviewRuntimeUrl)
    const show = exampleShow(); show.id = showId; show.name = '真实歌曲联调（临时）'; show.region = regionId
    show.cues = show.cues.filter(c => c.action.type === 'scene').map((c, i) => ({ ...c, timeMs: i ? Math.round(position * 1000) + i * 10000 : 0 }))
    if (window.__performanceReviewExitOnly) { show.cues = [show.cues[0]]; show.cues[0].action.snapshot.effect = 'echo_corridor' }
    const config = readPerformance(); savePerformance({ ...config, shows: [...config.shows, show], selected: show.id })
  }, { regionId, showId, position: at.position })
  // HMR can leave an older mounted module instance. Rehydrate persisted fixture
  // through the workspace rather than publishing through a duplicate import.
  await page.reload()
  await expect.poll(async () => overlay.evaluate(async showId => {
    const { readPerformance } = await import(window.__performanceReviewRuntimeUrl); return readPerformance().shows.some(s => s.id === showId)
  }, showId), { timeout: 10000 }).toBe(true)
  await overlay.evaluate(async () => {
    const { listen } = await import('/node_modules/.vite/deps/@tauri-apps_api_event.js')
    window.__performanceReviewEvents = []
    window.__performanceReviewStop = await listen('performance-session', e => window.__performanceReviewEvents.push(e.payload))
  })
  await page.getByRole('button', { name: '演出编排', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '绑定当前曲目', exact: true }).click()
  report.arming = { regions:(await invoke('get_settings')).regions.map(r=>({id:r.id,visible:r.visible})), ui:await dialog.innerText() }
  await expect(dialog.getByRole('button', { name: '开启演出模式', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '开启演出模式', exact: true }).click()
  armedByTest = true
  await expect(dialog.getByRole('button', { name: '关闭演出', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas(overlay)).toHaveAttribute('data-scene', process.env.PERFORMANCE_REVIEW_EXIT === '1' ? 'echo_corridor' : 'tidal_knot', { timeout: 60000 })
  if (pausedByTest) {
    await page.waitForTimeout(1200)
    const held = await invoke('get_now_playing')
    await page.waitForTimeout(1200)
    const heldAfter = await invoke('get_now_playing')
    report.paused = { from: held.position, to: heldAfter.position, playing: heldAfter.playing, scene: await canvas(overlay).getAttribute('data-scene') }
    assert.equal(heldAfter.playing, false)
    assert.ok(Math.abs(report.paused.to - report.paused.from) < .5, 'Paused real clock must hold')
    const current = await invoke('get_now_playing')
    await invoke('control_card_media', { action: 'play', trackId: current.trackId, sessionId: current.sessionId }); pausedByTest = false
  }
  for (const effect of process.env.PERFORMANCE_REVIEW_INTERACTIVE === '1' || process.env.PERFORMANCE_REVIEW_EXIT === '1' ? [] : ['layered_tides', 'echo_corridor', 'star_flight', 'tidal_knot']) {
    await expect(canvas(overlay)).toHaveAttribute('data-scene', effect, { timeout: 30000 })
    report.sequence.push({ effect, playerPosition: (await invoke('get_now_playing')).position, transition: await canvas(overlay).getAttribute('data-transition') })
    console.log('Followed cue:', JSON.stringify(report.sequence.at(-1)))
  }
  await page.screenshot({ path: `${folder}/live-score.png` })
  if (process.env.PERFORMANCE_REVIEW_HOLD === '1') {
    await writeFile(`${folder}/active.json`, JSON.stringify({ regionId, showId, trackId: initialPlayer.trackId, cueOrigin: at.position, title: initialPlayer.title }))
    console.log('Ready for real seek/loop/song-change review')
    const until = Date.now() + 600000
    while (Date.now() < until) {
      try { if ((await readFile(`${folder}/release.txt`, 'utf8')).trim() === regionId) break } catch {}
      await page.waitForTimeout(1000)
    }
  }
  const restoreStarted = Date.now()
  await dialog.getByRole('button', { name: '关闭演出', exact: true }).click()
  armedByTest = false
  await expect.poll(async () => overlay.evaluate(() => window.__performanceReviewEvents?.at(-1))).toBeNull()
  report.sessionEvents = await overlay.evaluate(() => window.__performanceReviewEvents.map(e => e ? { showId: e.showId, armed: true } : { armed: false }))
  await expect(canvas(overlay)).toHaveAttribute('data-scene', 'tidal_knot', { timeout: 60000 })
  report.disableRestore = { scene: await canvas(overlay).getAttribute('data-scene'), elapsedMs: Date.now() - restoreStarted }
  assert.deepEqual(report.errors, [])
  report.result = 'passed'
} catch (error) {
  report.result = 'failed'; report.failure = String(error)
  report.failureState = await overlay.evaluate(() => {
    const el=document.querySelector('canvas'),key=el&&Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let f=key?el[key]:null
    while(f){const v=f.memoizedProps?.value;if(v?.arm&&v?.info)return {session:v.session,info:{...v.info.current,cover:undefined},config:v.config};f=f.return}return null
  }).catch(()=>null)
  throw new Error(String(error).slice(0,1000))
} finally {
  try {
    // Remove only this run's temporary data; keep unrelated edits made in the meantime.
    const stop = page.getByRole('button', { name: '关闭演出', exact: true })
    if (armedByTest && await stop.count()) await stop.click()
    if (pausedByTest) {
      const now = await invoke('get_now_playing')
      if (now.trackId === initialPlayer?.trackId && !now.playing) await invoke('control_card_media', { action: 'play', trackId: now.trackId, sessionId: now.sessionId })
    }
    if (originalConfig !== undefined) await page.evaluate(async ({ regionId, showId, raw }) => {
      const { readPerformance, savePerformance } = await import(window.__performanceReviewRuntimeUrl)
      const { emptyPerformance } = await import('/src/features/performance/model.ts')
      const before = raw ? JSON.parse(raw) : emptyPerformance, current = readPerformance()
      const shows = current.shows.filter(s => s.id !== showId)
      savePerformance({ ...current, transition: before.transition, shows, selected: current.selected === showId ? before.selected || shows[0]?.id || '' : current.selected, mappings: Object.fromEntries(Object.entries(current.mappings).filter(([key]) => !key.startsWith(`${regionId}--`))) })
    }, { regionId, showId, raw: originalConfig })
    if (addedRegion) {
      const current = await invoke('get_settings')
      await invoke('update_settings', { settings: { ...current, regions: current.regions.filter(r => r.id !== regionId) } })
      await page.reload()
    }
    if (hiddenConsumers) {
      const current = await invoke('get_settings')
      await invoke('update_settings', { settings: { ...current, desktopCard: { ...current.desktopCard, enabled: original.desktopCard.enabled }, lyrics: { ...current.lyrics, enabled: original.lyrics.enabled } } })
      await page.reload()
    }
    await overlay.evaluate(() => window.__reviewTransitionObserver?.disconnect())
    await overlay.evaluate(async () => { await window.__performanceReviewStop?.(); delete window.__performanceReviewEvents; delete window.__performanceReviewStop })
    const final = await invoke('get_settings')
    report.restored = original ? JSON.stringify(final) === JSON.stringify(original) : true
    report.playerAfter = await invoke('get_now_playing'); delete report.playerAfter.cover
  } catch (error) { report.restoreError = String(error) }
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
