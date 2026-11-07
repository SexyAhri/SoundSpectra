import { chromium } from '@playwright/test'
import { copyFileSync, mkdirSync } from 'node:fs'

// Exercise the shipped renderer in spacious and user-sized compact lyric regions.
const output = 'artifacts/folded-curtain/quality'
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: process.argv.includes('--video') ? { dir: output, size: { width: 1280, height: 720 } } : undefined })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const lines = [
    { text: '风把晚霞 折成一页信', start: 1200, end: 5600, words: [
      { text: '风把', start: 1200, end: 1900 }, { text: '晚霞 ', start: 1900, end: 3000 },
      { text: '折成', start: 3000, end: 3800 }, { text: '一页信', start: 3800, end: 5600 },
    ] },
    { text: '你听见 光落下的声音', start: 5600, end: 9600, words: [] },
    { text: 'Stay with the light 等回声慢慢落下', start: 9600, end: 14200, words: [] },
    { text: '那些没有说完的温柔 还停在下一页天亮之前', start: 14200, end: 19600, words: [] },
  ]
  await page.goto('http://127.0.0.1:1420/tests/fixtures/folded-lyrics.html')
  await page.waitForFunction(() => document.querySelector('canvas')?.dataset.time === '2600')
  for (const [name, time] of [['entry', 750], ['reading', 3250], ['handoff', 5400], ['mixed', 11200], ['long', 16500]]) {
    await page.evaluate(({ lines, time }) => window.foldedProbe.set({ lines, time, fontSize: 64 }), { lines, time })
    await page.waitForFunction(time => document.querySelector('canvas')?.dataset.time === String(time), time)
    await page.screenshot({ path: `${output}/${name}.png` })
  }
  if (process.argv.includes('--video')) {
    await page.evaluate(({ lines }) => window.foldedProbe.set({ lines, time: 0, playing: true }), { lines })
    await page.waitForTimeout(20000)
    await page.evaluate(() => window.foldedProbe.set({ playing: false, time: 3250 }))
  }
  // Keep the user's compact position, font size and height.
  await page.evaluate(() => { document.body.querySelector('div').style.cssText = 'position:absolute;left:10.13%;top:85.86%;width:85.67%;height:10%' })
  await page.evaluate(({ lines }) => window.foldedProbe.set({ lines, time: 3250, fontSize: 18, regionWidth: .8567 }), { lines })
  await page.waitForFunction(() => document.querySelector('canvas')?.dataset.time === '3250')
  await page.waitForFunction(() => document.querySelector('canvas')?.dataset.size === '1097x72')
  await page.screenshot({ path: `${output}/compact-folded.png` })
  for (const time of [5100, 5350, 5500, 5600, 5700]) {
    await page.evaluate(time => window.foldedProbe.set({ time }), time)
    await page.waitForFunction(time => document.querySelector('canvas')?.dataset.time === String(time), time)
    await page.screenshot({ path: `${output}/compact-handoff-${time}.png` })
  }
  if (process.argv.includes('--video')) {
    await page.evaluate(() => window.foldedProbe.set({ time: 4700, playing: true }))
    await page.waitForTimeout(8000)
    await page.evaluate(() => window.foldedProbe.set({ time: 11200, playing: false }))
  }
  const video = page.video()
  await page.close(); await context.close()
  if (video) copyFileSync(await video.path(), `${output}/production-motion.webm`)
  if (errors.length) throw new Error(errors.join('\n'))
} finally { await browser.close() }
