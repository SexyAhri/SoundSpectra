import { chromium } from '@playwright/test'
import { copyFileSync, mkdirSync } from 'node:fs'

const output = 'artifacts/lyric-scene'
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: process.argv.includes('--video') ? { dir: output, size: { width: 1280, height: 720 } } : undefined })
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`${process.env.SOUNDSPECTRA_QA_URL ?? 'http://127.0.0.1:1420'}/tests/fixtures/music-scene.html`)
  await page.waitForFunction(() => document.querySelector('.lyric-layer canvas')?.dataset.time === '3250')
  await page.waitForFunction(() => document.querySelector('canvas[data-renderer="three"]'))
  for (const motion of ['depth', 'stage', 'folded']) {
    await page.evaluate(motion => {
      const s = window.musicScene.settings()
      window.musicScene.set({ time: 3250, playing: false, settings: { ...s, lyrics: { ...s.lyrics, motion } } })
    }, motion)
    await page.waitForFunction(motion => document.querySelector('.lyric-layer canvas')?.dataset.composition === motion, motion)
    await page.screenshot({ path: `${output}/${motion}.png` })
    if (process.argv.includes('--video')) {
      await page.evaluate(() => window.musicScene.set({ time: 900, playing: true }))
      // Refresh only fixture transport metadata, just as a player poll would.
      for (let n = 1; n <= 5; n++) { await page.waitForTimeout(1400); await page.evaluate(time => window.musicScene.set({ time }), 900 + n * 1400) }
      await page.evaluate(() => window.musicScene.set({ playing: false, time: 3250 }))
    }
  }
  await page.evaluate(() => {
    const s = window.musicScene.settings()
    window.musicScene.set({ settings: { ...s, music: { ...s.music, fieldPalette: 'ember' }, lyrics: { ...s.lyrics, motion: 'stage' } } })
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${output}/warm.png` })
  await page.evaluate(() => {
    const s = window.musicScene.settings()
    window.musicScene.set({ settings: { ...s, lyrics: { ...s.lyrics, fontSize: 18, bounds: { x: .1013, y: .8586, width: .8567, height: .1 } } } })
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${output}/compact.png` })
  const video = page.video()
  await page.close(); await context.close()
  if (video) copyFileSync(await video.path(), `${output}/music-scene.webm`)
  if (errors.length) throw new Error(errors.join('\n'))
} finally { await browser.close() }
