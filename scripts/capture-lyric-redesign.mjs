import { chromium } from '@playwright/test'
import { copyFileSync, mkdirSync } from 'node:fs'

const output = 'artifacts/lyric-redesign'
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const lines = [
  { text: '风把晚霞 折成一页信', start: 1200, end: 5600, words: [
    { text: '风把', start: 1200, end: 1900 }, { text: '晚霞 ', start: 1900, end: 3000 },
    { text: '折成', start: 3000, end: 3800 }, { text: '一页信', start: 3800, end: 5600 },
  ] },
  { text: '你听见 光落下的声音', start: 5600, end: 9600, words: [] },
  { text: 'Stay with the light 等回声慢慢落下', start: 9600, end: 14200, words: [] },
  { text: '那些没有说完的温柔 还停在下一页天亮之前', start: 14200, end: 19600, words: [] },
]
try {
  for (const mode of ['depth', 'stage']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: process.argv.includes('--video') ? { dir: output, size: { width: 1280, height: 720 } } : undefined })
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto('http://127.0.0.1:1420/tests/fixtures/kinetic-lyrics.html')
    await page.waitForFunction(() => window.lyricProbe)
    const set = patch => page.evaluate(patch => window.lyricProbe.set(patch), patch)
    for (const [name, time] of [['entry', 800], ['reading', 3250], ['handoff', 5700], ['mixed', 11200], ['long', 16500]]) {
      await set({ lines, mode, fontSize: 64, time, live: false, backgroundOpacity: 0 })
      await page.waitForFunction(({ mode, time }) => document.querySelector('canvas')?.dataset.time === String(time) && document.querySelector('canvas')?.dataset.composition === mode, { mode, time })
      await page.screenshot({ path: `${output}/${mode}-${name}.png` })
    }
    if (process.argv.includes('--video')) { await set({ time: 0, live: true, playing: true }); await page.waitForTimeout(20000); await set({ live: false }) }
    await page.evaluate(() => { document.body.querySelector('div').style.cssText = 'position:absolute;left:10.13%;top:85.86%;width:85.67%;height:10%' })
    await set({ time: 3250, fontSize: 18, regionWidth: .8567 })
    await page.waitForFunction(() => document.querySelector('canvas')?.dataset.time === '3250' && document.querySelector('canvas')?.clientHeight === 72)
    await page.screenshot({ path: `${output}/${mode}-compact.png` })
    if (process.argv.includes('--video')) { await set({ time: 4700, live: true, playing: true }); await page.waitForTimeout(8000) }
    const video = page.video(); await page.close(); await context.close()
    if (video) copyFileSync(await video.path(), `${output}/${mode}-motion.webm`)
    if (errors.length) throw new Error(errors.join('\n'))
  }
} finally { await browser.close() }
