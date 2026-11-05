import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('artifacts', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto('http://127.0.0.1:1420/tests/fixtures/kinetic-lyrics.html')
  await page.waitForFunction(() => document.querySelector('canvas')?.dataset.time === '2600')
  const base64 = await page.evaluate(async () => {
    await document.fonts.ready
    const source = document.querySelector('canvas'), output = document.createElement('canvas')
    output.width = 1280; output.height = 720
    const context = output.getContext('2d'), stream = output.captureStream(30)
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm'
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 }), chunks = []
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    const done = new Promise(resolve => { recorder.onstop = resolve })
    const modes = [['depth', '文字漫游'], ['stage', '错落排版'], ['stardust', '弧形流转']]
    recorder.start(); const start = performance.now()
    await new Promise(resolve => {
      const tick = now => {
        const elapsed = now - start, part = Math.min(2, Math.floor(elapsed / 7000)), mode = modes[part]
        window.lyricProbe.set({ mode: mode[0], time: elapsed % 7000 })
        context.fillStyle = '#111b24'; context.fillRect(0, 0, 1280, 720)
        context.drawImage(source, 77, 58, 1126, 604)
        context.font = '16px sans-serif'; context.fillStyle = '#b9c3ca'; context.fillText(mode[1], 48, 40)
        context.font = '12px sans-serif'; context.fillStyle = '#71808b'; context.fillText('SoundSpectra · 原创示例歌词', 48, 692)
        if (elapsed >= 21000) { resolve(); return }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    recorder.stop(); await done; stream.getTracks().forEach(track => track.stop())
    const bytes = new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer())
    let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
    return btoa(binary)
  })
  writeFileSync('artifacts/lyric-compositions.webm', Buffer.from(base64, 'base64'))
  console.log('Saved artifacts/lyric-compositions.webm')
} finally { await browser.close() }
