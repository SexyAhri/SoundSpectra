import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'

const option = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3)
const label = option('label') ?? `study-${Date.now()}`, baseline = option('baseline')
const names={rhythm_balls:'浮光水母',rhythm_rain:'落雨',rhythm_skin:'风织绸境',ripple:'雪花飘舞',volume_rain:'晴空浮游',dream_stars:'银河',vortex:'旋涡',sound_field:'频谱回响',petal_bloom:'星瓣花境',aurora_flow:'极光流域',star_flight:'星尘航道'}
const effects=process.argv.includes('--all')?Object.keys(names):(option('effects')??'rhythm_balls,rhythm_skin,sound_field').split(',')
if(effects.some(effect=>!names[effect]))throw new Error('Unknown effect in --effects')
for (const value of [label, baseline].filter(Boolean)) if (!/^[a-zA-Z0-9_-]{1,60}$/.test(value)) throw new Error('Use a short folder label: letters, digits, _ or -.')
const folder = join('artifacts', 'visual-studies', label)
try { await access(join(folder, 'report.json')); throw new Error(`Capture ${label} already exists. Choose a new --label.`) } catch (error) { if (error.code !== 'ENOENT') throw error }
await mkdir(folder, { recursive: true })
const before = baseline ? JSON.parse(await readFile(join('artifacts','visual-studies',baseline,'report.json'),'utf8')) : null
const software = process.argv.includes('--software')
const browser = await chromium.launch({ channel:'chrome', headless:true, args:software ? ['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] : ['--enable-webgl'] })
const reports = [], errors = []
try {
  const page = await browser.newPage({ viewport:{ width:1100,height:900 }, deviceScaleFactor:1 })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${option('url')??'http://127.0.0.1:1420'}/tools/visual-lab.html`)
  await page.waitForFunction(() => !!window.visualStudy)
  for (const effect of effects) for (const mode of ['daily','immersive']) {
    const previous = before?.studies.find(s => s.settings.effect === effect && s.settings.sceneMode === mode)
    const report = await page.evaluate(async ({effect,mode,config}) => {
      const lab=window.visualStudy, host=document.createElement('div'); host.style.cssText='position:fixed;left:-10000px';document.body.append(host)
      try { return await lab.renderVisualStudy(host,config ?? lab.studySettings(effect,mode)) } finally { host.remove() }
    },{effect,mode,config:previous?.settings})
    for (const frame of report.frames) {
      const file=`${effect}-${mode}-${frame.id}.png`
      await writeFile(join(folder,file),Buffer.from(frame.image.split(',')[1],'base64'))
      frame.file=file;delete frame.image
    }
    reports.push(report); console.log(`${effect} / ${mode}: ${report.frames.length} frames; errors=${report.errors.length}`)
  }
} finally { await browser.close() }
const report={label,baseline:baseline??null,method:'Authored synthetic feature sequence, 48000/1024 packet clock, fixed geometry seeds and saved camera; no real audio capture or playback.',studies:reports,errors}
await writeFile(join(folder,'report.json'),JSON.stringify(report,null,2))
const rows=reports.map(study=>`<section><h2>${names[study.settings.effect]} / ${study.settings.sceneMode==='daily'?'融入桌面':'沉浸暗场'}</h2>${study.frames.map(frame=>`<figure><figcaption>${frame.id} · ${frame.time}s</figcaption><div class="pair">${baseline?`<div><small>基线</small><img src="../${baseline}/${frame.file}"></div>`:''}<div><small>${baseline?'改进后':'基线'}</small><img src="${frame.file}"></div></div></figure>`).join('')}</section>`).join('')
await writeFile(join(folder,'index.html'),`<!doctype html><meta charset="utf-8"><title>SoundSpectra 视觉对比</title><style>body{margin:30px auto;max-width:1500px;padding:20px;background:#11191e;color:#dce6e4;font:14px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}h1,h2{font-weight:500}p,small,figcaption{color:#a2b7b2}.pair{display:flex;gap:16px}.pair>div{flex:1;min-width:0}img{width:100%;background:radial-gradient(ellipse at 25% 35%,#b8b8aa,transparent 60%),linear-gradient(135deg,#99adb5,#d4c2a9);border:1px solid #435151;border-radius:8px}figure{margin:24px 0}section{margin-top:48px}</style><h1>SoundSpectra · 固定输入画面对比</h1><p>${report.method}</p><p>相同效果、构图、参数、镜头、质量、种子及采样时刻。桌面背景为原创合成色块；PNG 保留透明通道。输入和完整配置见 report.json。</p>${rows}`)
if(errors.length || reports.some(r=>r.errors.length || r.remaining.geometries || r.remaining.textures)) process.exitCode=1
console.log(`Saved ${folder}/index.html`)
