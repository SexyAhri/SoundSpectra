// Opt-in check against this application's debug WebView, with QQ Music playing.
// Temporarily changes only audio source; never restores stale scene settings.
import { chromium, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const pages = browser.contexts().flatMap(context => context.pages())
const page = pages.find(page => page.url().startsWith('http://tauri.localhost') && !page.url().includes('window=overlay'))
assert.ok(page, 'Packaged SoundSpectra settings page required')
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const original = (await invoke('get_audio_sources')).selection
const report = { original, checks: {}, errors: [] }
let owned = null
page.on('pageerror', error => report.errors.push(error.message))
const choose = async selection => {
  if (owned && !same((await invoke('get_audio_sources')).selection, owned)) throw new Error('User changed source; stopping test without overwriting it')
  await invoke('set_audio_source', { selection })
  owned = selection
}
const sample = async () => {
  await page.evaluate(() => { window.__audioProbe = { frames: 0, nonzero: 0, peak: 0 } })
  await page.waitForTimeout(2500)
  return { ...await page.evaluate(() => window.__audioProbe), status: await invoke('get_status') }
}
await page.evaluate(async () => {
  const internal = window.__TAURI_INTERNALS__
  window.__audioProbe = { frames: 0, nonzero: 0, peak: 0 }
  const handler = internal.transformCallback(({ payload }) => {
    const peak = Math.max(...payload)
    const probe = window.__audioProbe
    probe.frames++; probe.peak = Math.max(probe.peak, peak)
    if (peak > .015) probe.nonzero++
  })
  const eventId = await internal.invoke('plugin:event|listen', { event: 'spectrum', target: { kind: 'Any' }, handler })
  window.__stopAudioProbe = async () => {
    await internal.invoke('plugin:event|unlisten', { event: 'spectrum', eventId })
    internal.unregisterCallback(handler)
  }
})
try {
  await choose({ mode: 'auto' })
  await expect.poll(async () => (await invoke('get_status')).state, { timeout: 15000 }).toBe('listening')
  report.discovery = await invoke('get_audio_sources')
  assert.ok(report.discovery.discovery.targets.some(target => target.playerId === 'qqmusic'))
  report.checks.auto = await sample()
  assert.equal(report.checks.auto.status.sourceName, 'QQ 音乐')
  assert.ok(report.checks.auto.nonzero > 20)

  const absent = report.discovery.catalog.find(player => !report.discovery.discovery.targets.some(target => target.playerId === player.id))
  assert.ok(absent, 'Need an absent music preset to test waiting without fallback')
  await choose({ mode: 'player', id: absent.id })
  await expect.poll(async () => (await invoke('get_status')).state).toBe('waiting')
  await page.waitForTimeout(350)
  report.checks.absent = { player: absent.name, ...await sample() }
  assert.equal(report.checks.absent.nonzero, 0)
  assert.equal(report.checks.absent.status.processId, null)
  assert.ok(report.checks.absent.frames > 0)

  await choose({ mode: 'player', id: 'qqmusic' })
  await expect.poll(async () => (await invoke('get_status')).state).toBe('listening')
  report.checks.manual = await sample()
  assert.ok(report.checks.manual.nonzero > 20)
  await expect(page.getByRole('combobox', { name: '音乐来源', exact: true })).toHaveText('QQ 音乐')
  report.desktop = await invoke('debug_desktop_state')
  const settings = await invoke('get_settings')
  const onDisk = JSON.parse(readFileSync(join(process.env.APPDATA, 'com.soundspectra.desktop', 'settings.json'), 'utf8'))
  assert.deepEqual(settings, onDisk)
  report.matchesLatestSceneSettings = true
  if (settings.enabled && (settings.regionVisible || settings.regions.some(region => region.visible))) {
    assert.equal(report.desktop.attached, true)
    assert.equal(report.desktop.transparent, true)
    assert.equal(report.desktop.topmost, false)
  }
  const overlay = pages.find(page => page.url().includes('window=overlay'))
  if (overlay) {
    report.webglErrors = await overlay.locator('canvas').evaluateAll(canvases => canvases.map(canvas => canvas.getContext('webgl2').getError()))
    assert.ok(report.webglErrors.every(error => error === 0))
    await assert.rejects(overlay.evaluate(() => window.__TAURI_INTERNALS__.invoke('set_audio_source', { selection: { mode: 'auto' } })))
    report.overlaySourceWriteDenied = true
  }
  assert.deepEqual(report.errors, [])
} catch (error) {
  report.error = String(error)
  process.exitCode = 1
} finally {
  if (owned && same((await invoke('get_audio_sources')).selection, owned)) await invoke('set_audio_source', { selection: original })
  await page.evaluate(() => window.__stopAudioProbe())
  report.restored = (await invoke('get_audio_sources')).selection
  await page.waitForTimeout(2200)
  await page.screenshot({ path: 'artifacts/native-audio-sources.png' })
  writeFileSync('artifacts/native-audio-sources.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}
