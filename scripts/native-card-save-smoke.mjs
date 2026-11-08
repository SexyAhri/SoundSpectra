// Opt-in Windows regression against an isolated, debug-enabled native build.
// Build with identifier com.soundspectra.card-save-regression and custom-protocol;
// pass that executable as argv[2]. Never connects to the user's running app.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'

assert.equal(process.platform, 'win32')
assert.ok(process.argv[2], 'Pass an isolated native test executable')
const executable = resolve(process.argv[2])
const identifier = 'com.soundspectra.card-save-regression'
const output = resolve('artifacts/card-save-regression')
const config = join(process.env.APPDATA, identifier)
const port = Number(process.env.CARD_SAVE_TEST_PORT ?? 9247)
mkdirSync(output, { recursive: true })
const report = { checks: [], errors: [] }
let child, browser, page
const deadline = (task, message, ms = 15000) => {
  let timer
  return Promise.race([task, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })]).finally(() => clearTimeout(timer))
}
const invoke = (command, args) => deadline(page.evaluate(({ command, args }) =>
  window.__TAURI_INTERNALS__.invoke(command, args), { command, args }), `${command} stalled`)
async function start() {
  let portBusy = false
  try { portBusy = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch {}
  assert.equal(portBusy, false, 'Test port is already in use')
  child = spawn(executable, [], {
    windowsHide: true,
    env: { ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: join(output, 'webview'),
    },
    stdio: 'ignore',
  })
  child.on('error', error => report.errors.push(String(error)))
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok }
    catch { return false }
  }, { timeout: 20000 }).toBe(true)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  await expect.poll(() => browser.contexts().flatMap(context => context.pages())
    .filter(p => p.url().startsWith('http://tauri.localhost') && !new URL(p.url()).searchParams.has('window')).length,
  { timeout: 20000 }).toBe(1)
  page = browser.contexts().flatMap(context => context.pages())
    .find(p => p.url().startsWith('http://tauri.localhost') && !new URL(p.url()).searchParams.has('window'))
  page.on('pageerror', error => report.errors.push(error.message))
  await expect(page.locator('.app-shell')).toBeAttached()
  const info = await invoke('application_info')
  assert.equal(info.development, true, 'Requires debug commands')
  // Check the native configuration path before changing any setting.
  const backup = await invoke('backup_configuration')
  assert.ok(resolve(backup).startsWith(`${resolve(config)}\\`), 'Refusing to mutate a non-isolated app')
}
async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve))
    // Let Tauri dispose WebView2 before restarting, so its CDP listener is gone.
    if (page && browser) void page.evaluate(() => window.__TAURI_INTERNALS__.invoke('quit_application')).catch(() => {})
    try { await deadline(exited, 'Isolated app did not stop', 10000) }
    catch (error) { child.kill(); throw error }
  }
  if (browser) { await browser.close(); browser = undefined }
  page = undefined
  await expect.poll(async () => {
    try { return !(await fetch(`http://127.0.0.1:${port}/json/version`)).ok }
    catch { return true }
  }, { timeout: 15000 }).toBe(true)
}
function assertSaved(settings) {
  assert.deepEqual(JSON.parse(readFileSync(join(config, 'settings.json'), 'utf8')), settings)
}
async function assertDesktop() {
  const desktop = await invoke('debug_desktop_state')
  assert.equal(desktop.attached, true)
  assert.equal(desktop.visible, true)
  assert.equal(desktop.topmost, false)
  await expect.poll(async () => {
    try { return (await invoke('debug_card_hit_test', { points: [] })).visible } catch { return false }
  }, { timeout: 15000 }).toBe(true)
  const controls = await invoke('debug_card_hit_test', { points: [] })
  assert.equal(controls.visible, true)
  assert.equal(controls.noActivate, true)
  assert.equal(controls.topmost, false)
  await expect.poll(() => browser.contexts().flatMap(context => context.pages())
    .filter(p => p.url().includes('window=overlay')).length).toBe(1)
  const overlay = browser.contexts().flatMap(context => context.pages())
    .find(p => p.url().includes('window=overlay'))
  await expect(overlay.getByTestId('music-card-layer')).toBeVisible()
  await overlay.getByTestId('music-card-layer').screenshot({ path: join(output, 'desktop-card.png'), omitBackground: true })
  return { desktop, controls }
}
try {
  await start()
  let settings = await invoke('get_settings')
  if (settings.enabled && settings.desktopCard.enabled) {
    await invoke('update_settings', { settings: { ...settings, enabled: false,
      desktopCard: { ...settings.desktopCard, enabled: false },
    } })
    await stop()
    await start()
    settings = await invoke('get_settings')
  }
  await assert.rejects(invoke('debug_card_hit_test', { points: [] }), /未启用音乐控制/)
  settings = await invoke('update_settings', { settings: { ...settings,
    enabled: true, regionVisible: false, regions: [], quality: 'eco',
    desktopCard: { ...settings.desktopCard, enabled: false },
    lyrics: { ...settings.lyrics, enabled: false },
    wallpaperDepth: { ...settings.wallpaperDepth, enabled: false },
  } })
  await page.reload()
  await page.getByRole('button', { name: '音乐卡片', exact: true }).click()
  await page.getByRole('switch', { name: '显示桌面音乐卡片', exact: true }).click()
  await expect(page.locator('.save-status')).toHaveText('设置已保存', { timeout: 15000 })
  settings = await invoke('get_settings')
  assert.equal(settings.desktopCard.enabled, true)
  assertSaved(settings)
  const first = await assertDesktop()
  report.checks.push('First card activation returns, persists, and displays on the native desktop')
  const prefs = await invoke('get_preferences')
  const source = await invoke('get_audio_sources')
  const concurrent = await Promise.all([
    invoke('update_settings', { settings: { ...settings, desktopCard: { ...settings.desktopCard, variant: 'compact' } } }),
    invoke('save_preferences', { preferences: prefs }),
    invoke('backup_configuration'),
    invoke('get_status'),
    invoke('set_audio_source', { selection: source.selection }),
  ])
  settings = concurrent[0]
  assertSaved(settings)
  assert.equal((await assertDesktop()).controls.handle, first.controls.handle)
  report.checks.push('Concurrent save, preferences, source selection, backup, and status do not block the event loop')
  const { enabled, fontSize, backgroundOpacity, motion, bounds, readability, fontStyle } = settings.lyrics
  settings = await invoke('apply_scene', { scene: { desktop: { version: 1,
    card: { ...settings.desktopCard, variant: 'floating' }, followCover: settings.followCover,
    lyrics: { enabled, fontSize, backgroundOpacity, motion, bounds, readability, fontStyle },
  } } })
  assertSaved(settings)
  report.checks.push('Scene application persists the card without recreating its native window')
  await stop()
  await start()
  assertSaved(await invoke('get_settings'))
  await expect.poll(async () => (await invoke('get_status')).desktopAttached, { timeout: 15000 }).toBe(true)
  await assertDesktop()
  report.checks.push('Starting with the card enabled restores the native card and remains responsive')
  const before = await invoke('get_settings')
  const disabled = await invoke('update_settings', { settings: { ...before, enabled: false } })
  assertSaved(disabled)
  assert.equal((await invoke('get_status')).desktopAttached, false)
  await invoke('update_settings', { settings: before })
  await assertDesktop()
  report.checks.push('Desktop hide and re-enable persist and restore the card')
  assert.deepEqual(report.errors, [])
} catch (error) {
  report.failure = String(error)
  process.exitCode = 1
} finally {
  try { await stop() } catch (error) { report.cleanupError = String(error); process.exitCode = 1 }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
