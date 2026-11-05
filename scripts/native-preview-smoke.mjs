import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('artifacts', { recursive: true })
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const pages = browser.contexts().flatMap(context => context.pages())
const page = pages.find(page => page.url().startsWith('http://tauri.localhost') && !page.url().includes('window=overlay'))
assert.ok(page, 'Packaged SoundSpectra settings window is required')
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
try {
  await page.waitForSelector('.desktop-preview')
  await expect(page.getByText('设置已保存', { exact: true })).toBeVisible()
  const original = await invoke('get_settings')
  const background = await invoke('get_desktop_background', { knownRevision: null })
  assert.equal(background.issue, null)
  assert.ok(background.screen.width > 0 && background.screen.height > 0)
  const repeated = await invoke('get_desktop_background', { knownRevision: background.revision })
  assert.equal(repeated.revision, background.revision)
  assert.equal(repeated.image, null, 'Unchanged background must not transfer image bytes again')
  const rect = await page.locator('.desktop-preview').boundingBox()
  const effect = await page.locator('.preview-spectrum').boundingBox()
  assert.ok(Math.abs(rect.width / rect.height - background.screen.width / background.screen.height) < .005)
  const previewBounds = { x: (effect.x - rect.x) / rect.width, y: (effect.y - rect.y) / rect.height, width: effect.width / rect.width, height: effect.height / rect.height }
  for (const key of Object.keys(previewBounds)) assert.ok(Math.abs(previewBounds[key] - original.bounds[key]) < .002, `Preview ${key} matches saved bounds`)
  if (background.image && await page.getByRole('button', { name: '桌面壁纸', exact: true }).getAttribute('aria-pressed') === 'true') {
    await expect(page.getByTestId('preview-wallpaper')).toHaveCSS('background-image', /data:image\/webp/)
  }
  const desktop = await invoke('debug_desktop_state')
  if (original.enabled) {
    assert.equal(desktop.transparent, true); assert.equal(desktop.topmost, false)
    const { screen } = background, { bounds } = original
    const expected = [screen.x + Math.round(bounds.x * screen.width), screen.y + Math.round(bounds.y * screen.height)]
    expected.push(expected[0] + Math.round(bounds.width * screen.width), expected[1] + Math.round(bounds.height * screen.height))
    assert.deepEqual(desktop.rect, expected)
  }
  await page.screenshot({ path: 'artifacts/native-wallpaper-preview.png' })
  await page.getByRole('button', { name: '放大预览' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '布置', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: '缩放动效' })).toBeVisible()
  await page.screenshot({ path: 'artifacts/native-wallpaper-expanded.png' })
  await page.getByRole('dialog').getByRole('button', { name: '完成布置', exact: true }).click()
  await page.getByRole('button', { name: '关闭放大预览' }).click()
  const overlay = pages.find(page => page.url().includes('window=overlay'))
  const denied = await overlay.evaluate(async () => {
    try { await window.__TAURI_INTERNALS__.invoke('get_desktop_background', { knownRevision: null }); return false } catch { return true }
  })
  assert.equal(denied, true, 'Overlay cannot read wallpaper files')
  const report = { background: { ...background, image: Boolean(background.image) }, previewBounds, desktop, status: await invoke('get_status'), overlayAccessDenied: denied }
  writeFileSync('artifacts/native-preview.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (await page.getByRole('button', { name: '关闭放大预览' }).count()) await page.getByRole('button', { name: '关闭放大预览' }).click().catch(() => {})
  await browser.close()
}
