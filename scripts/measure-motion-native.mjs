import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

// Observe existing development WebViews. Never starts an installed app or changes settings.
const label=process.argv.find(v=>v.startsWith('--label='))?.slice(8)??'before'
if(!/^[\w-]+$/.test(label))throw Error('Invalid label')
const folder=`artifacts/motion-quality/native-${label}`
await mkdir(folder,{recursive:true})
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223')
const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url().startsWith('http://127.0.0.1:1420/')&&!p.url().includes('window=rail'))
const main=pages.find(p=>!p.url().includes('window='))
if(!main)throw Error('Running 1420 Tauri development page required')
const state=await main.evaluate(async()=>{
 const invoke=c=>window.__TAURI_INTERNALS__.invoke(c)
 return {application:await invoke('application_info'),settings:await invoke('get_settings'),status:await invoke('get_status'),media:await invoke('get_now_playing'),desktop:await invoke('debug_desktop_state')}
})
if(!state.application.development)throw Error('Development mode required')
const data=[]
try{
 for(const page of pages){
  await page.evaluate(async()=>{
   const fiberUrl=performance.getEntriesByType('resource').map(e=>e.name).find(url=>url.includes('/@react-three_fiber.js?v='))
   if(!fiberUrl)throw Error('Loaded R3F module URL not found')
   const [{_roots},{listen}]=await Promise.all([import(fiberUrl),import('/node_modules/@tauri-apps/api/event.js')])
   const records={audio:[],samples:[],draws:[],raf:[],longTasks:[],gpu:[],gpuDisjoint:false}
   const restores=[],timelines=new Set(),queries=[]
   for(const canvas of document.querySelectorAll('.three-scene-surface canvas')){
    let fiber=canvas[Object.keys(canvas).find(k=>k.startsWith('__reactFiber'))]
    while(fiber){const timeline=fiber.memoizedProps?.analysis?.current?.timeline;if(timeline)timelines.add(timeline);fiber=fiber.return}
    const root=_roots.get(canvas),store=root?.store
    if(!store)throw Error('Live R3F store not found')
    const advance=store.getState().advance,gl=store.getState().gl.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2')
    store.setState({advance:(...args)=>{const start=performance.now(),query=ext&&records.draws.length%3===0?gl.createQuery():null;if(query)gl.beginQuery(ext.TIME_ELAPSED_EXT,query);const value=advance(...args);if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push({query,gl,ext})}const phases=[];store.getState().scene.traverse(o=>{const u=o.material?.uniforms;if(u?.uPhase&&!phases.includes(u.uPhase.value))phases.push(u.uPhase.value)});records.draws.push({wall:start,cost:performance.now()-start,phases,scene:canvas.dataset.scene,width:canvas.width,height:canvas.height});return value}})
    restores.push(()=>store.setState({advance}))
   }
   for(const timeline of timelines){const sample=timeline.sample;timeline.sample=function(now,settings){const frame=sample.call(this,now,settings);if(frame)records.samples.push({wall:now,clock:frame.now,beat:frame.beatIndex,level:frame.levels[2],generation:this.generation});return frame};restores.push(()=>{timeline.sample=sample})}
   const stop=await listen('music-analysis',({payload:p})=>records.audio.push({wall:performance.now(),sequence:p.sequence,sample:p.samplePosition,rate:p.sampleRate,rms:p.rms,stream:p.streamId,revision:p.sourceRevision}))
   let raf=0;const tick=t=>{records.raf.push(t);raf=requestAnimationFrame(tick)};raf=requestAnimationFrame(tick)
   const observers=[]
   for(const type of ['longtask','long-animation-frame'])try{const observer=new PerformanceObserver(list=>records.longTasks.push(...list.getEntries().map(e=>({type:e.entryType,start:e.startTime,duration:e.duration,renderStart:e.renderStart,styleAndLayoutStart:e.styleAndLayoutStart,scripts:e.scripts?.map(s=>({duration:s.duration,source:s.sourceURL,function:s.sourceFunctionName,invoker:s.invoker,forcedLayout:s.forcedStyleAndLayoutDuration}))}))));observer.observe({type,buffered:false});observers.push(observer)}catch{}
   window.__motionObservation={records,stop:()=>{stop();cancelAnimationFrame(raf);observers.forEach(o=>o.disconnect());restores.forEach(f=>f());for(const {query,gl,ext} of queries){if(gl.getParameter(ext.GPU_DISJOINT_EXT))records.gpuDisjoint=true;else if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE))records.gpu.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(query)}}}
  })
 }
 await new Promise(r=>setTimeout(r,10000))
 for(const page of pages){
  const result=await page.evaluate(()=>{const o=window.__motionObservation;o.stop();delete window.__motionObservation;return {records:o.records,url:location.href,dpr:devicePixelRatio,screen:{width:screen.width,height:screen.height},visibility:document.visibilityState,canvases:[...document.querySelectorAll('.three-scene-surface canvas')].map(c=>({...c.dataset,width:c.width,height:c.height})),alerts:[...document.querySelectorAll('.render-error')].map(e=>e.textContent)}})
  const distribution=values=>{const v=values.filter(Number.isFinite).sort((a,b)=>a-b);return {n:v.length,p50:v[Math.floor(v.length*.5)]??null,p95:v[Math.floor(v.length*.95)]??null,p99:v[Math.floor(v.length*.99)]??null,max:v.at(-1)??null,over25:v.filter(x=>x>25).length,over50:v.filter(x=>x>50).length}}
  const intervals=values=>values.slice(1).map((t,i)=>t-values[i])
  const r=result.records
  result.summary={audioIntervals:distribution(intervals(r.audio.map(x=>x.wall))),drawIntervals:distribution(intervals(r.draws.map(x=>x.wall))),rafIntervals:distribution(intervals(r.raf)),submitCost:distribution(r.draws.map(x=>x.cost)),gpuCost:distribution(r.gpu),gpuDisjoint:r.gpuDisjoint,clockReversals:r.samples.slice(1).filter((x,i)=>x.generation===r.samples[i].generation&&x.clock<r.samples[i].clock).length,phaseResets:r.draws.slice(1).filter((x,i)=>x.scene===r.draws[i].scene&&x.phases[0]<r.draws[i].phases[0]).length,longTasks:r.longTasks.length}
  data.push(result)
 }
 const overlay=pages.find(p=>p.url().includes('window=overlay'))
 if(overlay){
  const cdp=await overlay.context().newCDPSession(overlay),frames=[],pending=[]
  cdp.on('Page.screencastFrame',event=>{const file=`frame-${String(frames.length).padStart(4,'0')}.jpg`;frames.push({file,...event.metadata});pending.push(writeFile(`${folder}/${file}`,Buffer.from(event.data,'base64')));void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId})})
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:85,maxWidth:960,maxHeight:540,everyNthFrame:3})
  await new Promise(r=>setTimeout(r,6000));await cdp.send('Page.stopScreencast');await Promise.all(pending)
  await writeFile(`${folder}/frames.json`,JSON.stringify(frames,null,2))
  await writeFile(`${folder}/index.html`,`<!doctype html><meta charset="utf-8"><title>开发版连续帧 ${label}</title><body style="background:#151d26;color:white;font:16px sans-serif"><p>真实开发版 overlay 连续合成帧 · ${label} · 无声音 · 按 CDP 采样时间播放。此录像阶段独立于性能测量。</p><img id="frame" style="width:960px;max-width:100%"><script>const frames=${JSON.stringify(frames)},image=document.querySelector('#frame'),start=performance.now();function tick(now){if(!frames.length)return;let t=(now-start)/1000%(frames.at(-1).timestamp-frames[0].timestamp),f=frames.findLast(f=>f.timestamp-frames[0].timestamp<=t)||frames[0];image.src=f.file;requestAnimationFrame(tick)}requestAnimationFrame(tick)</script>`)
  await cdp.detach()
 }
}finally{
 for(const page of pages)await page.evaluate(()=>window.__motionObservation?.stop()).catch(()=>{})
 await browser.close()
}
await writeFile(`${folder}/report.json`,JSON.stringify({state,pages:data,method:'Live QQ capture; RAF and actual renderer submissions; these are NOT physical display presentation timestamps. No settings or playback changes.'},null,2))
console.log(JSON.stringify({state:{status:state.status,application:state.application,effect:state.settings.effect},pages:data.map(p=>({url:p.url,dpr:p.dpr,summary:p.summary}))},null,2))
