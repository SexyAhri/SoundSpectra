// Opt-in check of the shared packaged build. Leaves the requested card enabled;
// updates use the visible controls and never restore an old whole configuration.
import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
// Independent expected geometry, so this Node-only check does not need Vite's
// TypeScript extension resolution or reuse the production union calculation.
function expectedHost(settings) {
  const boxes = settings.regions.filter(r => r.visible).map(r => r.bounds)
  if (settings.regionVisible) boxes.push(settings.bounds)
  if (settings.desktopCard.enabled) boxes.push(settings.desktopCard.bounds)
  if (!boxes.length) return settings.bounds
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y))
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y }
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const report = { errors: [] }
try {
  await expect.poll(() => browser.contexts().flatMap(c => c.pages()).filter(p => p.url().startsWith('http://tauri.localhost')).length).toBeGreaterThanOrEqual(2)
  const pages = browser.contexts().flatMap(c => c.pages())
  const page = pages.find(p => p.url().startsWith('http://tauri.localhost') && !p.url().includes('window=overlay'))
  const overlay = pages.find(p => p.url().includes('window=overlay'))
  assert.ok(page && overlay)
  for (const target of [page, overlay]) target.on('pageerror', error => report.errors.push(error.message))
  const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
  const before = await invoke('get_settings')
  await page.getByRole('button', { name: '音乐卡片', exact: true }).click()
  const toggle = page.getByRole('switch', { name: '显示桌面音乐卡片' })
  if (!before.desktopCard.enabled) await toggle.click()
  await expect.poll(async () => (await invoke('get_settings')).desktopCard.enabled).toBe(true)
  const card = overlay.getByTestId('music-card-layer')
  await expect(card).toBeVisible()
  await expect.poll(async () => (await invoke('get_now_playing')).source, { timeout: 10000 }).not.toBe('')
  await expect.poll(async () => (await invoke('get_now_playing')).updated, { timeout: 15000 }).toBeGreaterThan(0)
  const media = await invoke('get_now_playing')
  report.media = { title: media.title, artist: media.artist, source: media.source, position: media.position, duration: media.duration, playing: media.playing, hasCover: Boolean(media.cover), issue: media.issue }
  if (media.title) await expect(card.getByText(media.title, { exact: true })).toBeVisible()
  else await expect(card.getByText('播放器未提供歌曲信息')).toBeVisible()
  if (media.cover) {
    await expect.poll(() => card.locator('.music-card-cover').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    report.coverDecoded = true
  }
  report.desktop = await invoke('debug_desktop_state')
  assert.equal(report.desktop.attached, true); assert.equal(report.desktop.transparent, true)
  assert.equal(report.desktop.topmost, false); assert.equal(report.desktop.noActivate, true)
  const settings = await invoke('get_settings')
  const background = await invoke('get_desktop_background', { knownRevision: null })
  const cardBox = await card.boundingBox()
  const viewport = await overlay.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const rect = report.desktop.rect
  const ratio = { x: (rect[2] - rect[0]) / viewport.width, y: (rect[3] - rect[1]) / viewport.height }
  const actual = { x: rect[0] + cardBox.x * ratio.x, y: rect[1] + cardBox.y * ratio.y, width: cardBox.width * ratio.x, height: cardBox.height * ratio.y }
  const b = settings.desktopCard.bounds, screen = background.screen
  const expected = { x: screen.x + b.x * screen.width, y: screen.y + b.y * screen.height, width: b.width * screen.width, height: b.height * screen.height }
  for (const key of Object.keys(actual)) assert.ok(Math.abs(actual[key] - expected[key]) < 3, `${key} must match the saved desktop position`)
  report.cardPlacement = { actual, expected, host: expectedHost(settings) }
  report.liveMeterPeak = await card.locator('.live-meter rect').evaluateAll(bars => Math.max(...bars.map(bar => Number(bar.getAttribute('height')))))
  await card.screenshot({ path: 'artifacts/desktop-music-card.png', omitBackground: true })
  // Verify that removing the card also removes its extension of the host window.
  await toggle.click()
  await expect.poll(async () => (await invoke('get_settings')).desktopCard.enabled).toBe(false)
  await expect(card).toHaveCount(0)
  report.withoutCard = await invoke('debug_desktop_state')
  const without = await invoke('get_settings'), host = expectedHost(without)
  assert.ok(Math.abs(report.withoutCard.rect[3] - (screen.y + Math.round((host.y + host.height) * screen.height))) < 3)
  await toggle.click()
  await expect.poll(async () => (await invoke('get_settings')).desktopCard.enabled).toBe(true)
  await expect(card).toBeVisible()
  await page.getByRole('tab', { name: '动效', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: 'artifacts/native-studio.png' })
  const latest = await invoke('get_settings')
  assert.deepEqual(latest, JSON.parse(readFileSync(join(process.env.APPDATA, 'com.soundspectra.desktop', 'settings.json'), 'utf8')))
  const { desktopCard: previousCard, ...previousRest } = before
  const { desktopCard: latestCard, ...latestRest } = latest
  assert.deepEqual(latestRest, previousRest, 'Only the card switch may change during this check')
  assert.deepEqual({ ...latestCard, enabled: previousCard.enabled }, previousCard)
  report.latestSavedSettingsMatch = true
  report.cardEnabled = latestCard.enabled
  assert.deepEqual(report.errors, [])
} catch (error) {
  report.error = String(error); process.exitCode = 1
} finally {
  writeFileSync('artifacts/native-studio.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}
