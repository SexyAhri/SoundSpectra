import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const option = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3)
const label = option('label') ?? 'review'
if (!/^[\w-]+$/.test(label)) throw Error('Invalid label')
const effects = (option('effects') ?? 'rhythm_rain,rhythm_skin,ripple,volume_rain,dream_stars,vortex,sound_field,petal_bloom,aurora_flow,star_flight').split(',')
const folder = `artifacts/effect-refinement/${label}`
await mkdir(folder, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl'] })
const reports = [], errors = []
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:1420/tools/visual-lab.html', {waitUntil:'domcontentloaded',timeout:60_000})
  await page.waitForFunction(() => !!window.visualStudy)
  for (const effect of effects) for (const mode of ['immersive', 'daily']) {
    const report = await page.evaluate(async ({ effect, mode }) => {
      const lab = window.visualStudy, host = document.createElement('div'); document.body.append(host)
      try { return await lab.renderVisualStudy(host, lab.studySettings(effect, mode), {
        width: 800, height: 450, points: [{ id: 'drums', time: 2.4 }, { id: 'sustain', time: 5.2 }, { id: 'high', time: 7.5 }, { id: 'silence', time: 14 }],
      }) } finally { host.remove() }
    }, { effect, mode })
    for (const frame of report.frames) {
      frame.file = `${effect}-${mode}-${frame.id}.png`
      await writeFile(`${folder}/${frame.file}`, Buffer.from(frame.image.split(',')[1], 'base64')); delete frame.image
    }
    reports.push(report)
    await writeFile(`${folder}/report.json`, JSON.stringify({ input: 'Fixed synthetic analysis, no audio playback/capture.', errors, studies: reports }, null, 2))
    console.log(`${effect} ${mode}: errors=${report.errors.length}, remaining=${JSON.stringify(report.remaining)}`)
  }
} finally { await browser.close() }
const rows = reports.map(r => `<section><h2>${r.settings.effect} · ${r.settings.sceneMode}</h2><div>${r.frames.map(f => `<figure><img src="${f.file}"><figcaption>${f.id} · ${f.time}s</figcaption></figure>`).join('')}</div></section>`).join('')
await writeFile(`${folder}/index.html`, `<!doctype html><meta charset="utf-8"><title>灯效调校</title><style>body{background:#071019;color:#cbd5df;font:15px system-ui;margin:32px}section>div{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}figure{margin:0}img{width:100%;background:#1b2835}h2{font-size:18px;font-weight:500}figcaption{color:#93a9bb}section{margin-bottom:40px}</style><h1>灯效调校 · ${label}</h1><p>实际渲染器；固定合成分析输入，未播放或采集系统音乐。</p>${rows}`)
if (errors.length || reports.some(r => r.errors.length || r.remaining.geometries || r.remaining.textures)) process.exitCode = 1
