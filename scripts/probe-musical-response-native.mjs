import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
const label=process.argv[2]??'before'
if(!/^[\w-]+$/.test(label))throw Error('Invalid label')
const folder=`artifacts/motion-quality/music-response-${label}`;await mkdir(folder,{recursive:true})
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223')
try{
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:1420/')&&!p.url().includes('window='))
 if(!page)throw Error('Development page required')
 await page.evaluate(async()=>{
  const fiberUrl=performance.getEntriesByType('resource').map(e=>e.name).find(url=>url.includes('/@react-three_fiber.js?v='))
  const [{_roots},{listen}]=await Promise.all([import(fiberUrl),import('/node_modules/@tauri-apps/api/event.js')])
  const records={packets:[],frames:[],uniforms:[]},restores=[],timelines=new Set()
  for(const canvas of document.querySelectorAll('.three-scene-surface canvas')){
   let fiber=canvas[Object.keys(canvas).find(k=>k.startsWith('__reactFiber'))]
   while(fiber){const t=fiber.memoizedProps?.analysis?.current?.timeline;if(t)timelines.add(t);fiber=fiber.return}
   const store=_roots.get(canvas)?.store;if(!store)continue
   const advance=store.getState().advance
   store.setState({advance:(...args)=>{const value=advance(...args);let uniforms=null;store.getState().scene.traverse(o=>{const u=o.material?.uniforms;if(!uniforms&&u?.uPhase)uniforms=Object.fromEntries(['uPhase','uVolume','uBass','uMiddle','uTreble','uSlowBass','uSlowMid','uFastHigh','uBeatGlow','uOnsetStrength','uOnsetAge'].filter(k=>u[k]).map(k=>[k,u[k].value]))});records.uniforms.push({wall:performance.now(),uniforms});return value}})
   restores.push(()=>store.setState({advance}))
  }
  for(const timeline of timelines){const sample=timeline.sample;timeline.sample=function(now,settings){const f=sample.call(this,now,settings);if(f)records.frames.push({wall:now,...Object.fromEntries(['now','intensity','displayIntensity','levels','transients','bandOnsets','beatIndex','beatStrength','beatAge','pulse','sustain','audible'].map(k=>[k,f[k]]))});return f};restores.push(()=>timeline.sample=sample)}
  const stop=await listen('music-analysis',({payload})=>records.packets.push({wall:performance.now(),audio:payload}))
  window.__musicResponse={records,stop:()=>{stop();restores.forEach(f=>f())}}
 })
 await new Promise(r=>setTimeout(r,12000))
 const result=await page.evaluate(async()=>{const o=window.__musicResponse;o.stop();delete window.__musicResponse;return {settings:await window.__TAURI_INTERNALS__.invoke('get_settings'),...o.records}})
 await writeFile(`${folder}/report.json`,JSON.stringify(result,null,2))
 const stats=xs=>{const a=xs.filter(Number.isFinite).sort((a,b)=>a-b);return {min:a[0],p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)}}
 const latestByBeat=new Map(result.frames.map(f=>[f.beatIndex,f]))
 console.log(JSON.stringify({packets:result.packets.length,frames:result.frames.length,beats:latestByBeat.size,rms:stats(result.packets.map(p=>p.audio.rms)),intensity:stats(result.frames.map(f=>f.displayIntensity)),beatStrength:stats([...latestByBeat.values()].map(f=>f.beatStrength)),transients:[0,1,2].map(i=>stats(result.frames.map(f=>f.transients[i]))),uniforms:Object.fromEntries(['uVolume','uBass','uSlowBass','uSlowMid','uFastHigh','uBeatGlow','uOnsetStrength'].map(k=>[k,stats(result.uniforms.map(f=>f.uniforms?.[k]))]))},null,2))
}finally{for(const p of browser.contexts().flatMap(c=>c.pages()))await p.evaluate(()=>window.__musicResponse?.stop()).catch(()=>{});await browser.close()}
