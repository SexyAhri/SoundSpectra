import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'

const output = 'artifacts/lyric-typography'
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.clock.setFixedTime(new Date('2026-11-08T00:00:00Z'))
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }))
  const errors = [], frames = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(`${process.env.SOUNDSPECTRA_QA_URL ?? 'http://127.0.0.1:1420'}/tests/fixtures/music-scene.html`)
  const layer = page.getByTestId('lyric-layer')
  for (const motion of ['depth', 'stage', 'folded']) for (const fontStyle of ['modern', 'poetry']) {
    await page.evaluate(({ motion, fontStyle }) => {
      const s = window.musicScene.settings()
      window.musicScene.set({ time: 3250, playing: false, settings: { ...s,
        lyrics: { ...s.lyrics, fontSize: 54, motion, fontStyle } } })
    }, { motion, fontStyle })
    await page.waitForFunction(({ motion, fontStyle }) => {
      const data = document.querySelector('.lyric-layer canvas')?.dataset
      return data?.composition === motion && data?.fontStyle === fontStyle && data?.time === '3250'
    }, { motion, fontStyle })
    const path = `${output}/${motion}-${fontStyle}.png`
    await layer.screenshot({ path })
    frames.push({ motion, fontStyle, base64: readFileSync(path).toString('base64') })
    if (motion === 'folded' && fontStyle === 'poetry') await page.screenshot({ path: `${output}/poetry-scene.png` })
  }
  await page.evaluate(() => {
    const s = window.musicScene.settings()
    window.musicScene.set({ time: 11200, settings: { ...s, lyrics: { ...s.lyrics, motion: 'stage', fontStyle: 'poetry' } } })
  })
  await page.waitForFunction(() => document.querySelector('.lyric-layer canvas')?.dataset.time === '11200')
  await page.screenshot({ path: `${output}/mixed-scene.png` })
  await page.setContent('<body style="margin:0;background:#0c151b"><canvas width="1920" height="1030"></canvas></body>')
  await page.evaluate(async frames => {
    const ctx = document.querySelector('canvas').getContext('2d')
    ctx.fillStyle = '#0c151b'; ctx.fillRect(0, 0, 1920, 1030)
    ctx.fillStyle = '#e9efeb'; ctx.font = '26px "Microsoft YaHei", sans-serif'
    ctx.fillText('现代黑体', 48, 50); ctx.fillText('唱片诗页', 1008, 50)
    for (const [i, frame] of frames.entries()) {
      const x = (i % 2) * 960, y = 80 + Math.floor(i / 2) * 310
      const image = new Image(); image.src = `data:image/png;base64,${frame.base64}`; await image.decode()
      ctx.fillStyle = '#91b8b2'; ctx.font = '18px "Microsoft YaHei", sans-serif'
      ctx.fillText(({ depth: '文字漫游', stage: '错落排版', folded: '折幕字场' })[frame.motion], x + 48, y + 28)
      ctx.drawImage(image, x + 20, y + 45, 920, 246)
    }
  }, frames)
  await page.setViewportSize({ width: 1920, height: 1030 })
  await page.screenshot({ path: `${output}/comparison.png` })
  if (errors.length) throw new Error(errors.join('\n'))
} finally { await browser.close() }
