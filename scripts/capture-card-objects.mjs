import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const output = 'artifacts/card-objects'
const origin = process.argv.find(arg => arg.startsWith('--origin='))?.slice(9) || 'http://127.0.0.1:1431'
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' })
  // Synthetic native capabilities expose the same enabled controls; no real player is contacted.
  await page.addInitScript(() => Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: { invoke: () => Promise.resolve(null) } }))
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/tests/fixtures/music-card.html`)
  await page.waitForFunction(() => window.cardProbe)
  await page.evaluate(() => document.fonts.ready)
  const capture = async path => {
    const box = await page.locator('#card-frame').boundingBox()
    await page.screenshot({ path, clip: { x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height + 24 } })
  }
  for (const variant of ['record', 'compact', 'afternoon', 'floating']) {
    for (const [name, width, height] of [['normal', 480, 152], ['small', 240, 80], ['large', 720, 220]]) {
      await page.evaluate(({ variant, width, height }) => {
        window.cardProbe.layout({ variant, width, height, sound: false })
        window.cardProbe.set({ position: 72, playing: false, sessionId: 'original-study', controls: { previous: true, next: true, play: true, pause: true } })
      }, { variant, width, height })
      await page.locator('#card-frame img').first().waitFor()
      await capture(`${output}/${variant}-${name}.png`)
    }
    await page.evaluate(() => window.cardProbe.layout({ width: 480, height: 152, background: '#d4ded8' }))
    await capture(`${output}/${variant}-light.png`)
    await page.getByRole('button', { name: '蔷薇色卡片' }).click()
    await capture(`${output}/${variant}-fixed.png`)
    await page.getByRole('button', { name: '继承场景', exact: true }).click()
    await page.evaluate(() => window.cardProbe.layout({ background: '#182125' }))
  }
  if (process.argv.includes('--scene')) {
    await page.goto(`${origin}/tools/music-cards.html?card=record`)
    await page.locator('.floating-sample img').first().waitFor()
    await page.getByRole('button', { name: '暂停示例', exact: true }).click()
    await page.waitForTimeout(1500)
    for (const [variant, name] of [['record', '唱片'], ['compact', '简约'], ['afternoon', '午后 · 藏书票'], ['floating', '浮签']]) {
      await page.getByRole('button', { name, exact: true }).click()
      await page.locator('.floating-stage').screenshot({ path: `${output}/${variant}-scene.png` })
      await page.getByLabel('浅色壁纸', { exact: true }).check()
      await page.locator('.floating-stage').screenshot({ path: `${output}/${variant}-scene-light.png` })
      await page.getByLabel('浅色壁纸', { exact: true }).uncheck()
    }
    errors.push(...await page.locator('[role=alert]').allTextContents())
  }
  writeFileSync(`${output}/report.json`, JSON.stringify({ errors, input: 'Production components; original artwork, synthetic metadata and capabilities; no real player interaction.' }, null, 2))
  if (errors.length) throw Error(errors.join('\n'))
} finally { await browser.close() }
