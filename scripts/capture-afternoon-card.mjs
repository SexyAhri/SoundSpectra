import { chromium } from '@playwright/test'
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'

const output = 'artifacts/afternoon-card'
mkdirSync(output, { recursive: true })
const origin = process.argv.find(arg => arg.startsWith('--origin='))?.slice(9) || 'http://127.0.0.1:1420'
const before = process.argv.includes('--before')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1110 }, deviceScaleFactor: 1, recordVideo: !before && process.argv.includes('--video') ? { dir: output, size: { width: 1440, height: 1110 } } : undefined })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/tests/fixtures/music-card.html`)
  await page.waitForFunction(() => window.cardProbe)
  await page.evaluate(() => {
    window.cardProbe.layout({ variant: 'afternoon', sound: false, width: 720, height: 220, background: '#ced4c4' })
    window.cardProbe.set({ playing: false, position: 72, album: '海风手记' })
  })
  await page.locator('.mc-paper-art img').waitFor()
  await page.waitForTimeout(350)
  for (const [name, width, height] of [['large', 720, 220], ['normal', 480, 152], ['small', 240, 80]]) {
    await page.evaluate(({ width, height }) => window.cardProbe.layout({ width, height }), { width, height })
    await page.locator('#card-frame').screenshot({ path: `${output}/${before ? 'before' : 'after'}-${name}.png` })
  }
  if (!before) {
    await page.goto(`${origin}/tools/afternoon-card.html`)
    await page.locator('.mc-paper-photo img').waitFor()
    await page.waitForTimeout(2200)
    await page.screenshot({ path: `${output}/overview.png` })
    await page.locator('.floating-stage').screenshot({ path: `${output}/desktop.png` })
    await page.getByRole('button', { name: '切换示例曲目' }).click()
    await page.waitForTimeout(1000)
    await page.locator('.floating-stage').screenshot({ path: `${output}/track-change.png` })
    await page.getByRole('button', { name: '暂停示例' }).click()
    await page.waitForTimeout(700)
    await page.getByLabel('浅色壁纸', { exact: true }).uncheck()
    await page.locator('.floating-stage').screenshot({ path: `${output}/dark.png` })
    await page.getByLabel('浅色壁纸', { exact: true }).check()
    await page.locator('.floating-stage').screenshot({ path: `${output}/light.png` })
    await page.getByLabel('小尺寸', { exact: true }).check()
    await page.getByRole('button', { name: '切换示例曲目' }).click()
    await page.waitForTimeout(400)
    await page.locator('.floating-stage').screenshot({ path: `${output}/missing-cover.png` })
    errors.push(...await page.locator('[role=alert]').allTextContents())
  }
  const video = page.video()
  await context.close()
  if (video) copyFileSync(await video.path(), `${output}/afternoon-card.webm`)
  writeFileSync(`${output}/${before ? 'before-' : ''}report.json`, JSON.stringify({ errors, input: 'Original example artwork and silent synthetic features. Production MusicCard component.' }, null, 2))
  if (errors.length) throw Error(errors.join('\n'))
} finally { await browser.close() }
