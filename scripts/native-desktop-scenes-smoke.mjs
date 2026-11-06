import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

// Use the running development WebView. Preview and an empty scene transaction
// exercise the native path without replacing any user appearance or mounts.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
try {
  const page = browser.contexts().flatMap(context => context.pages())
    .find(page => !new URL(page.url()).searchParams.has('window'))
  assert.ok(page, 'Settings WebView must be running')
  await page.waitForFunction(() => window.__TAURI_INTERNALS__ && document.querySelector('.auto-scene-entry'))
  const checks = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke
    const before = await invoke('get_settings')
    const unchanged = await invoke('apply_scene', { scene: {} })
    let rejected = false
    try { await invoke('apply_scene', { scene: { enabled: !before.enabled } }) }
    catch { rejected = true }
    const after = await invoke('get_settings')
    const library = await import('/src/features/preview/scene-library.ts')
    const entries = library.readLibrary().sort((a, b) => (b.usedAt ?? b.updated) - (a.usedAt ?? a.updated))
      .slice(0, 3).map(({ id, name }) => ({ id, name }))
    await invoke('sync_scene_shortcuts', { entries })
    const events = await import('/node_modules/@tauri-apps/api/event.js')
    await events.emitTo('settings', 'scene-shortcut', 'library')
    return { noOpPreserved: JSON.stringify(before) === JSON.stringify(unchanged), rejected,
      invalidPreserved: JSON.stringify(before) === JSON.stringify(after), trayFavorites: entries.length }
  })
  assert.equal(checks.noOpPreserved, true)
  assert.equal(checks.rejected, true)
  assert.equal(checks.invalidPreserved, true)
  await page.getByRole('button', { name: '精选搭配', exact: true }).click()
  for (const name of ['暖砂日常', '暮蓝听歌', '清浅专注']) {
    const choice = page.getByRole('button', { name: new RegExp(name) })
    await choice.click()
    assert.equal(await choice.getAttribute('aria-pressed'), 'true')
    assert.equal(await page.getByRole('button', { name: '应用此场景', exact: true }).isEnabled(), true)
  }
  await page.getByRole('button', { name: /暮蓝听歌/ }).click()
  await page.screenshot({ path: 'artifacts/native-desktop-scenes.png' })
  await page.getByRole('button', { name: '关闭场景收藏' }).click()
  console.log(JSON.stringify({ ...checks, nativeShortcutOpenedLibrary: true, presetPreviews: 3 }))
} finally {
  await browser.close()
}
