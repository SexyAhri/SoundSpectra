import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
const label=process.argv[2]??'final';if(!/^[\w-]+$/.test(label))throw Error('Invalid label')
const folder=`artifacts/scene-redesign/native-resize-${label}`;await mkdir(folder,{recursive:true})
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223')
try{
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:1420/')&&!p.url().includes('window='))
 if(!page)throw Error('Running development workspace required')
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 const result=await page.evaluate(async()=>{
  const {getCurrentWindow}=await import('/node_modules/@tauri-apps/api/window.js'),win=getCurrentWindow()
  const initial=await win.isMaximized(),rows=[],longTasks=[],writes=[],draws=[],restores=[]
  const fiberUrl=performance.getEntriesByType('resource').map(e=>e.name).find(url=>url.includes('/@react-three_fiber.js?v='))
  const {_roots}=await import(fiberUrl)
  for(const canvas of document.querySelectorAll('.three-scene-surface canvas')){
    const store=_roots.get(canvas)?.store;if(!store)throw Error('Live scene store missing')
    const advance=store.getState().advance
    store.setState({advance:(...args)=>{const start=performance.now();const value=advance(...args);draws.push({start,cost:performance.now()-start});return value}})
    restores.push(()=>store.setState({advance}))
  }
  const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))))
  observer.observe({entryTypes:['longtask']})
  const descriptors=['width','height'].map(key=>[key,Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,key)])
  for(const [key,d] of descriptors)Object.defineProperty(HTMLCanvasElement.prototype,key,{...d,set(value){if(this.closest('.three-scene-surface'))writes.push({time:performance.now(),key,value});d.set.call(this,value)}})
  const inspect=()=>[...document.querySelectorAll('.three-scene-surface canvas')].map(c=>({css:[c.clientWidth,c.clientHeight],parent:[c.parentElement.clientWidth,c.parentElement.clientHeight],buffer:[c.width,c.height],effect:c.dataset.scene,frames:c.dataset.frames,error:c.getContext('webgl2')?.getError()}))
  const settingsBefore=await window.__TAURI_INTERNALS__.invoke('get_settings')
  try{
   await new Promise(r=>setTimeout(r,3000))
   for(const maximized of [!initial,initial,!initial,initial]){
    const intervals=[],start=performance.now(),firstWrite=writes.length;let previous=start,raf=0
    const sample=now=>{intervals.push(now-previous);previous=now;raf=requestAnimationFrame(sample)};raf=requestAnimationFrame(sample)
    try{
     await win.toggleMaximize()
     for(let tries=0;tries<30&&await win.isMaximized()!==maximized;tries++)await new Promise(r=>setTimeout(r,30))
     if(await win.isMaximized()!==maximized)throw Error('Window state did not settle')
     await new Promise(r=>setTimeout(r,950))
    }finally{cancelAnimationFrame(raf)}
    const ordered=intervals.slice().sort((a,b)=>a-b)
    const submit=draws.filter(d=>d.start>=start).map(d=>d.cost).sort((a,b)=>a-b)
    rows.push({maximized,start,end:performance.now(),raf:{samples:ordered.length,p95:ordered[Math.floor(ordered.length*.95)],max:ordered.at(-1),over50:ordered.filter(v=>v>50).length},submit:{samples:submit.length,p95:submit[Math.floor(submit.length*.95)],max:submit.at(-1)},writes:writes.slice(firstWrite),canvases:inspect()})
   }
  }finally{
   if(await win.isMaximized()!==initial)await win.toggleMaximize()
   observer.disconnect();for(const restore of restores)restore();for(const [key,d] of descriptors)Object.defineProperty(HTMLCanvasElement.prototype,key,d)
  }
  const settingsAfter=await window.__TAURI_INTERNALS__.invoke('get_settings')
  return {initial,restored:await win.isMaximized()===initial,settingsUnchanged:JSON.stringify(settingsBefore)===JSON.stringify(settingsAfter),rows,longTasks,
   method:'Native Tauri maximize/restore; current live music/settings. RAF intervals measure scheduling during resize, not physical presentation FPS. Two round trips; no playback or settings edits.'}
 })
 await writeFile(`${folder}/report.json`,JSON.stringify({...result,errors},null,2));await page.screenshot({path:`${folder}/restored.png`})
 console.log(JSON.stringify({...result,rows:result.rows.map(({writes,...r})=>({...r,bufferWrites:writes.length})),errors},null,2))
 if(!result.restored||errors.length||result.rows.some(r=>r.canvases.some(c=>c.css.join()!==c.parent.join()||c.error)))process.exitCode=1
}finally{await browser.close()}
