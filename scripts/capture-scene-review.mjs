import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { visualProbeHtml } from './visual-probe-html.mjs'

const option = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3)
const label = option('label')
if (!label || !/^[\w-]+$/.test(label)) throw Error('Pass --label with a unique folder name')
const folder = `artifacts/scene-review/${label}`
await mkdir(folder, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl'] })
const errors = [], reports = [], sheets = []
try {
  const page = await browser.newPage({ viewport: { width: 1488, height: 660 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.routeWebSocket('**', socket => { socket.send(JSON.stringify({ type: 'connected' })); socket.onMessage(() => {}) })
  await page.route('**/scene-review-probe', route => route.fulfill({ contentType: 'text/html', body: visualProbeHtml('<body></body>') }))
  await page.goto('http://127.0.0.1:1420/scene-review-probe')
  const catalog = await page.evaluate(async () => (await import('/src/features/spectrum/music-engine/catalog.ts')).musicEffects)
  const selected = option('effects')?.split(',')
  const effects = catalog.filter(item => !selected || selected.includes(item.value))
  for (const mode of (option('modes') ?? 'immersive,daily').split(',')) {
    const cards = []
    for (const effect of effects) {
      const report = await page.evaluate(async ({ effect, mode, width }) => {
        const { renderVisualStudy, studySettings } = await import('/src/features/spectrum/visual-study.ts')
        return renderVisualStudy(document.body, studySettings(effect, mode), {
          width, height: Math.round(width * 9 / 16),
          points: [{ id: 'drums', time: 2.4 }, { id: 'sustain', time: 5.2 }, { id: 'high', time: 7.5 }, { id: 'quiet', time: 9.8 }, { id: 'silence', time: 15.8 }],
        })
      }, { effect: effect.value, mode, width: Number(option('width') ?? 480) })
      for (const frame of report.frames) {
        frame.file = `${effect.value}-${mode}-${frame.id}.png`
        await writeFile(`${folder}/${frame.file}`, Buffer.from(frame.image.split(',')[1], 'base64'))
      }
      cards.push({ title: effect.label, frames: report.frames.map(f => ({ id: f.id, image: f.image })) })
      if (process.argv.includes('--thumbnails') && mode === 'immersive') {
        const thumbnail = await page.evaluate(async source => {
          const image = new Image(); image.src = source; await image.decode()
          const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 270
          canvas.getContext('2d').drawImage(image, 0, 0, 480, 270)
          return canvas.toDataURL('image/webp', .92)
        }, report.frames.find(f => f.id === 'sustain').image)
        await writeFile(`src/assets/scenes/${effect.value}.webp`, Buffer.from(thumbnail.split(',')[1], 'base64'))
      }
      for (const frame of report.frames) delete frame.image
      reports.push(report)
      console.log(`${mode} ${effect.value}: errors=${report.errors.length}`)
    }
    for (const point of ['sustain', 'drums', 'high', 'quiet']) {
      for (let i = 0; i < cards.length; i += 6) {
        const sheet = await browser.newPage({ viewport: { width: 1488, height: 660 }, deviceScaleFactor: 1 })
        await sheet.setContent(`<style>body{margin:0;background:#121923;color:#e6edf4;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(3,480px);gap:12px;padding:12px}figure{margin:0}img{display:block;width:480px;height:270px;background:${mode === 'daily' ? 'linear-gradient(135deg,#6c7984,#b4ada1)' : '#080d14'}}figcaption{padding:8px}</style><main>${cards.slice(i, i + 6).map(c => `<figure><img src="${c.frames.find(f => f.id === point).image}"><figcaption>${c.title} · ${mode} · ${point}</figcaption></figure>`).join('')}</main>`)
        await sheet.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())))
        const file = `${mode}-${point}-${i / 6 + 1}.jpg`
        await sheet.screenshot({ path: `${folder}/${file}`, quality: 90 })
        sheets.push(file)
        await sheet.close()
      }
    }
  }
} finally { await browser.close() }
await writeFile(`${folder}/report.json`, JSON.stringify({ input: 'Fixed synthetic audio features, not system playback. Screenshots are visual review material, not aesthetic scores.', errors, reports, sheets }, null, 2))
if (errors.length || reports.some(r => r.errors.length || r.remaining.geometries || r.remaining.textures)) process.exitCode = 1
