import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
const label=process.argv[2]??'review'
if(!/^[\w-]+$/.test(label))throw Error('Invalid label')
const folder=`artifacts/resize-workspace/${label}`;await mkdir(folder,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl']})
const rows=[]
try{
 const page=await browser.newPage({viewport:{width:1440,height:940},deviceScaleFactor:1.5})
 await page.routeWebSocket('**',socket=>{socket.send(JSON.stringify({type:'connected'}));socket.onMessage(()=>{})})
 await page.goto('http://127.0.0.1:1420')
 const effects=await page.evaluate(async()=>{
   const {musicEffects}=await import('/src/features/spectrum/music-engine/catalog.ts');return musicEffects.map(e=>e.value)
 })
 await page.addInitScript(()=>{
   const p=window.resizeProbe={gap:0,compiles:0,contexts:0,events:0,longTask:0,previous:0,recording:false}
   const get=HTMLCanvasElement.prototype.getContext
   HTMLCanvasElement.prototype.getContext=function(...args){
     const gl=get.apply(this,args)
     if(gl&&args[0]==='webgl2'&&!gl.__probed){gl.__probed=true;p.contexts++;const compile=gl.compileShader.bind(gl);gl.compileShader=s=>{p.compiles++;compile(s)}}
     return gl
   }
   const tick=now=>{if(p.recording&&p.previous)p.gap=Math.max(p.gap,now-p.previous);p.previous=now;requestAnimationFrame(tick)};requestAnimationFrame(tick)
   addEventListener('resize',()=>{if(p.recording)p.events++})
   new PerformanceObserver(list=>{if(p.recording)for(const e of list.getEntries())p.longTask=Math.max(p.longTask,e.duration)}).observe({type:'longtask'})
 })
 for(const effect of effects){
   await page.setViewportSize({width:1440,height:940})
   await page.evaluate(async effect=>{
     const {studySettings}=await import('/src/features/spectrum/visual-study.ts');const settings=studySettings(effect,'immersive')
     settings.lyrics.enabled=true;settings.desktopCard.enabled=true
     localStorage.setItem('soundspectra.settings.v1',JSON.stringify(settings))
   },effect)
   await page.reload()
   await page.waitForFunction(effect=>document.querySelector(`canvas[data-scene="${effect}"][data-preparing="false"]`),effect)
   await page.waitForTimeout(1000)
   const initial=await page.evaluate(()=>({compiles:resizeProbe.compiles,contexts:resizeProbe.contexts}))
   for(const [width,height] of [[2560,1392],[1440,940],[2560,1392]]){
     await page.evaluate(()=>Object.assign(resizeProbe,{gap:0,events:0,longTask:0,recording:true,previous:performance.now()}))
     await page.setViewportSize({width,height});await page.waitForTimeout(900)
     const result=await page.evaluate(()=>{
       resizeProbe.recording=false;const c=document.querySelector('canvas[data-renderer="three"]')
       return {...resizeProbe,buffer:[c.width,c.height],preparations:c.dataset.preparations,frameMs:c.dataset.frameMs,resizeMs:c.dataset.resizeMs}
     })
     rows.push({effect,width,height,...result,extraCompiles:result.compiles-initial.compiles,extraContexts:result.contexts-initial.contexts});console.log(effect,width,result.gap.toFixed(1),rows.at(-1).extraCompiles)
   }
 }
 await writeFile(`${folder}/report.json`,JSON.stringify({method:'Whole settings workspace, real GPU Chrome, lyrics and card enabled, DPR 1.5. Browser viewport resize, not native WebView2 presentation.',rows},null,2))
}finally{await browser.close()}
