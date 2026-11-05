// Reproducible scene capture with explicitly simulated audio, separate from user settings.
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
const label = process.argv[2] ?? 'after'
const effect = process.argv.find(arg => arg.startsWith('--effect='))?.slice(9) ?? 'star_flight'
if (!['star_flight', 'aurora_flow'].includes(effect)) throw Error('Unsupported capture effect')
const prefix = effect === 'aurora_flow' ? 'aurora' : 'star-flight'
const reference = process.argv.includes('--reference') ? JSON.parse(readFileSync(`artifacts/${prefix}-view-reference.json`, 'utf8')) : null
mkdirSync('artifacts', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:1420')
  await page.evaluate(async ({ reference, effect }) => {
    const { defaults } = await import('/src/features/spectrum/model.ts')
    localStorage.setItem('soundspectra.settings.v1', JSON.stringify({ ...defaults, ...reference, enabled: false, effect, sceneMode: 'immersive', bounds: { x: 0, y: 0, width: 1, height: 1 } }))
  }, { reference, effect })
  await page.reload()
  await page.getByRole('button',{name:'放大预览',exact:true}).click()
  await page.waitForTimeout(1800)
  await page.screenshot({path:`artifacts/${prefix}-${label}-ui.png`})
  const result = await page.evaluate(async ({ reference, effect }) => {
    const { AmbientSceneRenderer } = await import('/src/features/spectrum/three/ambient/ambient-renderer.ts')
    const { SceneMotion } = await import('/src/features/spectrum/three/motion.ts')
    const { defaults } = await import('/src/features/spectrum/model.ts')
    const { demoAnalysis } = await import('/src/features/spectrum/music-analysis.ts')
    const config = { ...defaults, ...reference, effect, sceneMode: 'immersive', bounds: {x:0,y:0,width:1,height:1} }
    const canvas = document.createElement('canvas'); canvas.style.cssText='width:1280px;height:720px'; document.body.append(canvas)
    const renderer = new AmbientSceneRenderer(canvas), motion = new SceneMotion()
    renderer.resize(config,1)
    for(let f=0;f<360;f++)motion.step(demoAnalysis(f/60),1/60,config.music,false)
    renderer.renderer.info.autoReset=false; renderer.renderer.info.reset()
    renderer.draw(motion,config,false)
    const screenshot=canvas.toDataURL('image/png')
    const gl=renderer.renderer.getContext(),data=new Uint8Array(canvas.width*canvas.height*4)
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data)
    let colored=0,bright=0,white=0
    for(let i=0;i<data.length;i+=4){const max=Math.max(data[i],data[i+1],data[i+2]),min=Math.min(data[i],data[i+1],data[i+2]);if(max>60&&max-min>35)colored++;if(max>140)bright++;if(min>230)white++}
    const stats={colored:colored/(data.length/4),bright:bright/(data.length/4),white:white/(data.length/4),glError:gl.getError(),drawCalls:renderer.renderer.info.render.calls}
    renderer.dispose();canvas.remove()
    return {screenshot,stats}
  }, { reference, effect })
  writeFileSync(`artifacts/${prefix}-${label}.png`,Buffer.from(result.screenshot.split(',')[1],'base64'))
  writeFileSync(`artifacts/${prefix}-${label}.json`,JSON.stringify({input:'simulated audio, deterministic 6 seconds',...result.stats,errors},null,2))
  console.log(JSON.stringify({...result.stats,errors}))
  if(process.argv.includes('--record')) {
    const film = await browser.newPage({ viewport:{width:2560,height:1440} })
    await film.route('**/star-flight-capture.html',route=>route.fulfill({contentType:'text/html',body:'<html><body style="margin:0;background:#050712"></body></html>'}))
    await film.goto('http://127.0.0.1:1420/star-flight-capture.html')
    const capture = await film.evaluate(async effect => {
      const { AmbientSceneRenderer }=await import('/src/features/spectrum/three/ambient/ambient-renderer.ts')
      const { SceneMotion }=await import('/src/features/spectrum/three/motion.ts')
      const { defaults }=await import('/src/features/spectrum/model.ts')
      const { demoAnalysis }=await import('/src/features/spectrum/music-analysis.ts')
      const config={...defaults,effect,sceneMode:'immersive',bounds:{x:0,y:0,width:1,height:1}}
      const canvas=document.createElement('canvas');canvas.style.cssText='width:2560px;height:1440px';document.body.append(canvas)
      const renderer=new AmbientSceneRenderer(canvas),motion=new SceneMotion();renderer.resize(config,1)
      const gl=renderer.renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info')
      const hardware=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)
      const intervals=[];let previous=0,start=0,elapsed=0
      await new Promise(resolve=>{
        const draw=now=>{if(!start)start=now;const dt=previous?(now-previous)/1000:1/60;previous=now;elapsed+=dt
          motion.step(demoAnalysis(elapsed),dt,config.music,false);renderer.draw(motion,config,false)
          if(now-start>1000)intervals.push(dt*1000)
          if(now-start<7000)requestAnimationFrame(draw);else resolve()};requestAnimationFrame(draw)
      })
      intervals.sort((a,b)=>a-b)
      const performance={width:canvas.width,height:canvas.height,frames:intervals.length,medianMs:intervals[Math.floor(intervals.length*.5)],p95Ms:intervals[Math.floor(intervals.length*.95)],hardware}
      canvas.style.cssText='width:1280px;height:720px';renderer.resize(config,1)
      const output=document.createElement('canvas');output.width=1280;output.height=720;const context=output.getContext('2d')
      const stream=output.captureStream(60),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:6500000}),chunks=[]
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
      const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();previous=0;start=0
      await new Promise(resolve=>{
        const draw=now=>{if(!start)start=now;const dt=previous?(now-previous)/1000:1/60;previous=now;elapsed+=dt
          motion.step(demoAnalysis(elapsed),dt,config.music,false);renderer.draw(motion,config,false)
          context.drawImage(canvas,0,0);context.fillStyle='#c3cbdb';context.font='16px sans-serif';context.fillText(effect === 'aurora_flow' ? '极光流域 · 模拟音频预览' : '星尘航道 · 模拟音频预览',24,690)
          if(now-start<8000)requestAnimationFrame(draw);else resolve()};requestAnimationFrame(draw)
      })
      recorder.stop();await stopped;stream.getTracks().forEach(t=>t.stop());renderer.dispose()
      const video=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}))})
      return {performance,video}
    }, effect)
    writeFileSync(`artifacts/${prefix}-motion.webm`,Buffer.from(capture.video.split(',')[1],'base64'))
    writeFileSync(`artifacts/${prefix}-performance.json`,JSON.stringify(capture.performance,null,2))
    console.log(JSON.stringify(capture.performance));await film.close()
  }
} finally {await browser.close()}
