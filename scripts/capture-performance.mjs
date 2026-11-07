import { chromium } from '@playwright/test'
import { mkdir, writeFile, copyFile } from 'node:fs/promises'
import { createServer } from 'vite'
const folder='artifacts/performance';await mkdir(folder,{recursive:true})
// Isolate capture from other conversations' HMR edits on the shared development server.
const server=await createServer({configFile:'vite.config.ts',cacheDir:'artifacts/performance/vite-cache',server:{host:'127.0.0.1',port:1436,strictPort:true,hmr:false,watch:null}});await server.listen()
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const context=await browser.newContext({viewport:{width:1120,height:840},recordVideo:{dir:`${folder}/raw`,size:{width:1120,height:840}}})
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
await page.goto('http://127.0.0.1:1436/tools/performance-lab.html')
await page.locator('canvas[data-preparing=false]').waitFor()
await page.getByRole('button',{name:'播放预演',exact:true}).click()
const start=Date.now(),observations=[]
for(const seconds of [1,7.5,9.5,12,16,21.5,25.8,28,34,36]){
  const delay=seconds*1000-(Date.now()-start);if(delay>0)await page.waitForTimeout(delay)
  const state=await page.locator('canvas').evaluate(c=>({...c.dataset}));observations.push({time:seconds,...state})
  if([1,9.5,16,25.8,34].includes(seconds))await page.screenshot({path:`${folder}/show-${seconds}.png`})
  console.log(`${seconds}s: ${state.scene} / ${state.transition} / ${state.transitionProgress}`)
}
await page.getByRole('button',{name:'暂停预演',exact:true}).click()
for(const time of [12500,21500,1000]){
  await page.getByLabel('预演播放头').fill(String(time));await page.waitForTimeout(1200)
  observations.push({seekMs:time,...await page.locator('canvas').evaluate(c=>({...c.dataset}))})
}
await page.getByRole('button',{name:'同输入 · 映射对照'}).click();await page.waitForTimeout(8000);await page.screenshot({path:`${folder}/mapping-comparison.png`})
await page.waitForFunction(()=>document.querySelectorAll('canvas[data-preparing="false"]').length===2)
const mappings=await page.locator('canvas').evaluateAll(nodes=>nodes.map(c=>({...c.dataset})))
if(mappings.some(m=>!m.mapping||!Object.values(JSON.parse(m.mapping)).some(v=>v>0)))errors.push('Mapping comparison did not show a nonzero response')
await page.close();await context.close();await copyFile(await page.video().path(),`${folder}/review.webm`);await browser.close();await server.close()
await writeFile(`${folder}/report.json`,JSON.stringify({source:'Explicit synthetic RMS, bands and onsets. No live PCM or native performance claim. Continuous wall-time playback, not accelerated screenshots.',errors,observations,mappings},null,2))
await writeFile(`${folder}/index.html`,`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>SoundSpectra · 演出连续审阅</title><style>body{background:#0c141c;color:#d5e1df;font:15px/1.8 system-ui;max-width:1120px;margin:30px auto;padding:20px}video,img{width:100%;border-radius:12px}a{color:#9ccbc1}</style><h1>回声航线 · 连续审阅</h1><p>36 秒原创编排，随后为同输入的两种音乐映射。独立合成音频特征，无声音；不控制本机播放器。该视频用于观察连续行为，不代表原生帧率或真实音源验收。</p><video controls loop playsinline src="review.webm" poster="show-1.png"></video><p><a href="/tools/performance-lab.html">打开交互预演（可拖动播放头）</a></p><img src="mapping-comparison.png" alt="同输入的两种映射"/></html>`)
if(errors.length)process.exitCode=1
