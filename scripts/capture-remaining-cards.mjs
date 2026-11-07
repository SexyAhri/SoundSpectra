import { chromium } from '@playwright/test'
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'

const output = 'artifacts/remaining-cards'
mkdirSync(output, { recursive: true })
const origin = process.argv.find(arg => arg.startsWith('--origin='))?.slice(9) || 'http://127.0.0.1:1420'
const before = process.argv.includes('--before')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1110 }, recordVideo: !before && process.argv.includes('--video') ? { dir: output, size: { width: 1440, height: 1110 } } : undefined })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/tests/fixtures/music-card.html`)
  await page.waitForFunction(() => window.cardProbe)
  for (const variant of ['record', 'compact']) {
    await page.evaluate(variant => { window.cardProbe.layout({ variant, sound: false, background: '#18252b' }); window.cardProbe.set({ playing: false, position: 72 }) }, variant)
    for (const [name, width, height] of [['large', 720, 220], ['normal', 480, 152], ['small', 240, 80]]) {
      await page.evaluate(({ width, height }) => window.cardProbe.layout({ width, height }), { width, height })
      await page.locator('#card-frame img').first().waitFor()
      await page.locator('#card-frame').screenshot({ path: `${output}/${before ? 'before' : 'after'}-${variant}-${name}.png` })
    }
  }
  if (!before) {
    for (const variant of ['record', 'compact', 'afternoon', 'floating']) {
      await page.evaluate(variant => {
        const probe = window.cardProbe, settings = probe.settings()
        probe.layout({ variant, width: 480, height: 152, sound: false })
        probe.configure({ followCover: false, color: '#d4c3ff', music: { ...settings.music, fieldPalette: 'iris' }, desktopCard: { ...settings.desktopCard, variant, accentColor: undefined } })
      }, variant)
      await page.locator('#card-frame').screenshot({ path: `${output}/color-${variant}-scene.png` })
      await page.getByRole('button', { name: '蔷薇色卡片' }).click()
      await page.locator('#card-frame').screenshot({ path: `${output}/color-${variant}-fixed.png` })
    }
    for (const variant of ['record', 'compact']) {
      await page.goto(`${origin}/tools/music-cards.html?card=${variant}`)
      await page.locator('.floating-sample img').first().waitFor()
      await page.waitForTimeout(1800)
      await page.locator('.floating-stage').screenshot({ path: `${output}/${variant}-desktop.png` })
      await page.getByRole('button', { name: '切换示例曲目' }).click()
      await page.waitForTimeout(900)
      await page.getByRole('button', { name: '暂停示例' }).click()
      await page.waitForTimeout(500)
      await page.getByLabel('浅色壁纸', { exact: true }).check()
      await page.getByLabel('小尺寸', { exact: true }).check()
      await page.locator('.floating-stage').screenshot({ path: `${output}/${variant}-small-light.png` })
      errors.push(...await page.locator('[role=alert]').allTextContents())
    }
  }
  const video = page.video()
  await context.close()
  if (video) copyFileSync(await video.path(), `${output}/music-cards.webm`)
  writeFileSync(`${output}/${before ? 'before-' : ''}report.json`, JSON.stringify({ errors, input: 'Original artwork, synthetic metadata and silent musical features; production card component.' }, null, 2))
  if (errors.length) throw Error(errors.join('\n'))
} finally { await browser.close() }
