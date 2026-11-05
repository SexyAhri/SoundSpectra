import { chromium, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { windowsBuildEnvironment } from './windows-env.mjs'

mkdirSync('.tools', { recursive: true })
mkdirSync('artifacts', { recursive: true })
const { env } = windowsBuildEnvironment()
const compile = spawnSync('rustc', ['scripts/native-layer-probe.rs', '-o', '.tools/native-layer-probe.exe'], { env, windowsHide: true, encoding: 'utf8' })
assert.equal(compile.status, 0, compile.stderr || String(compile.error))
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('http://tauri.localhost') && !p.url().includes('window=overlay'))
assert.ok(page)
const invoke = (command) => page.evaluate(command => window.__TAURI_INTERNALS__.invoke(command), command)
const report = { runs: [] }
try {
  report.settingsBefore = await invoke('get_settings')
  assert.equal(report.settingsBefore.enabled, true)
  assert.equal((await invoke('get_status')).editing, false)
  await expect.poll(async () => (await invoke('debug_desktop_state')).attached).toBe(true)
  report.before = await invoke('debug_desktop_state')
  assert.equal(report.before.parentClass, 'Progman', 'This regression exercises the modern Explorer topology')
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await invoke('debug_desktop_state')
    const moved = spawnSync('.tools/native-layer-probe.exe', [before.handle, before.wallpaper, before.processId].map(String), { windowsHide: true, encoding: 'utf8' })
    assert.equal(moved.status, 0, moved.stderr)
    const displaced = await invoke('debug_desktop_state')
    assert.equal(displaced.parent, before.parent)
    assert.equal(displaced.visible, true)
    assert.equal(displaced.attached, false, 'A visible child underneath wallpaper must be considered unhealthy')
    assert.equal(displaced.betweenDesktopLayers, false)
    const started = Date.now()
    await expect.poll(async () => (await invoke('debug_desktop_state')).attached, { timeout: 6500, intervals: [100, 250, 500] }).toBe(true)
    const restored = await invoke('debug_desktop_state')
    assert.equal(restored.betweenDesktopLayers, true)
    assert.equal(restored.transparent, true)
    assert.equal(restored.noActivate, true)
    assert.equal(restored.topmost, false)
    assert.deepEqual(restored.rect, before.rect)
    report.runs.push({ displaced, restored, recoveryMs: Date.now() - started })
  }
  report.settingsAfter = await invoke('get_settings')
  assert.deepEqual(report.settingsAfter, report.settingsBefore, 'Recovery must not rewrite user preferences')
} catch (error) { report.error = String(error); process.exitCode = 1 }
finally {
  writeFileSync('artifacts/native-layer-recovery.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}
