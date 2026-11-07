import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { visualProbeHtml } from './visual-probe-html.mjs'

const arg=name=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)
const label=arg('label')??'review'
if(!/^[\w-]+$/.test(label))throw Error('Invalid label')
const folder=`artifacts/compositions/${label}`,still=process.argv.includes('--stills')
await mkdir('artifacts/compositions',{recursive:true})
await mkdir(folder)
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl']})
const reports=[],errors=[]
try{
  const page=await browser.newPage({viewport:{width:1000,height:650},deviceScaleFactor:1})
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/composition-capture',route=>route.fulfill({contentType:'text/html',body:visualProbeHtml('<body style="margin:0;background:#080e16"></body>')}))
  await page.goto(`${arg('url')??'http://127.0.0.1:1420'}/composition-capture`)
  for(const id of ['sculpture','expanse','passage']){
    const report=await page.evaluate(async({id,still})=>{
      const {CompositionStudy,studySection}=await import('/src/features/spectrum/three/compositions/study-session.ts')
      const {compositions}=await import('/src/features/spectrum/three/compositions/presets.ts')
      const canvas=document.createElement('canvas');canvas.style.cssText='width:960px;height:540px';document.body.append(canvas)
      const session=new CompositionStudy(canvas,id);await session.resize()
      const output=document.createElement('canvas');output.width=960;output.height=580
      const ctx=output.getContext('2d'),snapshots=[],curves=[],chunks=[]
      const stream=still?null:output.captureStream(0),track=stream?.getVideoTracks()[0]
      const recorder=stream?new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:6500000}):null
      let done
      if(recorder){recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};done=new Promise(resolve=>recorder.onstop=resolve);recorder.start()}
      const start=performance.now()
      for(let i=0;i<720;i++){
        session.step(1/30)
        ctx.fillStyle='#080e16';ctx.fillRect(0,0,960,580);ctx.drawImage(canvas,0,0,960,540)
        ctx.fillStyle='#c1d5ce';ctx.font='14px Segoe UI';ctx.fillText(`${compositions[id].family} / ${compositions[id].title}`,20,565)
        ctx.fillStyle='#91aaa5';ctx.font='12px Segoe UI';ctx.fillText(`${studySection(session.time)} · ${session.time.toFixed(2)}s · 合成特征 / 无声音`,450,565)
        if([149,329,509,719].includes(i))snapshots.push({time:session.time,image:output.toDataURL('image/png')})
        const material=session.world.scene.getObjectByName(`composition-${id}`).children[0].material
        curves.push({time:session.time,phase:material.uniforms.uTime.value,camera:session.world.camera.position.toArray(),bands:Array.from(session.motion.musicalBands),deformation:Array.from(material.uniforms.uAccents.value),onset:session.motion.frame?.onset??false,waves:Array.from(material.uniforms.uWaves.value),drawCalls:session.world.renderer.info.render.calls})
        track?.requestFrame()
        if(!still)await new Promise(r=>setTimeout(r,Math.max(0,start+(i+1)*1000/30-performance.now())))
        else if(i%30===0)await new Promise(r=>setTimeout(r,0))
      }
      if(recorder){recorder.stop();await done;stream.getTracks().forEach(t=>t.stop())}
      session.settings.sceneMode='daily';session.reading=true;session.step(1/30)
      snapshots.push({time:'daily',image:canvas.toDataURL('image/png')})
      const gl=session.world.renderer.getContext(),glError=gl.getError(),gpu=gl.getParameter(gl.RENDERER)
      const remaining=session.dispose();canvas.remove()
      let video=null
      if(!still){const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));video=btoa(binary)}
      return {id,video,snapshots,curves,remaining,errors:session.errors,glError,gpu,elapsed:performance.now()-start}
    },{id,still})
    if(report.video)await writeFile(`${folder}/${id}.webm`,Buffer.from(report.video,'base64'))
    delete report.video
    for(const shot of report.snapshots){shot.file=`${id}-${typeof shot.time==='number'?Math.round(shot.time):shot.time}.png`;await writeFile(`${folder}/${shot.file}`,Buffer.from(shot.image.split(',')[1],'base64'));delete shot.image}
    reports.push(report);console.log(`${id}: ${report.curves.length} frames; GL ${report.glError}; resources ${JSON.stringify(report.remaining)}; errors ${JSON.stringify(report.errors)}`)
  }
}finally{await browser.close()}
await writeFile(`${folder}/report.json`,JSON.stringify({method:'24s synthetic analysis; 48kHz/1024 packets, fixed 30Hz, 960x540, quiet/normal/strong/release. Not PCM, live audio, native desktop, or a measured presentation FPS.',errors,reports},null,2))
await writeFile(`${folder}/index.html`,`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>三种空间构图 · 连续审阅</title><style>body{background:#0c1117;color:#c9dbd5;font:15px/1.8 system-ui;max-width:1120px;margin:40px auto;padding:0 25px}video,img{width:100%;border-radius:10px}h1{font-weight:450}a{color:#a6ccc5}section{margin:40px 0}p{color:#91aaa4}</style><h1>三种空间构图 · 连续审阅</h1><p>同一 24 秒合成特征：0–6 秒静段，6–14 秒普通段，14–20 秒强段，20–24 秒收束。每套 960 × 540，连续 720 帧；无声音，不影响本机音乐。视频用于观察形变、层次和运动，不代表真实音源或原生桌面验收。</p><a href="/tools/composition-lab.html">打开可切换的实时演示</a>${reports.map(r=>`<section><h2>${r.id==='sculpture'?'01 雕塑型 / 潮汐之结':r.id==='expanse'?'02 铺展型 / 层海':'03 穿行型 / 回声廊道'}</h2>${still?`<img src="${r.id}-11.png">`:`<video controls loop playsinline preload="metadata" poster="${r.id}-11.png" src="${r.id}.webm"></video>`}<p><a href="/tools/composition-lab.html?scene=${r.id}">打开此构图</a></p></section>`).join('')}</html>`)
if(errors.length||reports.some(r=>r.errors.length||r.glError||r.remaining.geometries||r.remaining.textures))process.exitCode=1
