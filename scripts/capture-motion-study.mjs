import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {visualProbeHtml} from './visual-probe-html.mjs'
const option=n=>process.argv.find(v=>v.startsWith(`--${n}=`))?.slice(n.length+3)
const label=option('label')??'review',effects=(option('effects')??'rhythm_balls,rhythm_skin,sound_field').split(',')
if(!/^[\w-]+$/.test(label))throw Error('Invalid label')
const redesign=process.argv.includes('--scene-redesign')
const folder=`artifacts/${redesign?'scene-redesign':'motion-quality'}/${label}`;await mkdir(folder,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl']})
const reports=[],errors=[]
try{
 const page=await browser.newPage({viewport:{width:1300,height:800}})
 page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/motion-capture',route=>route.fulfill({contentType:'text/html',body:visualProbeHtml('<body style="margin:0;background:#151d26"></body>')}))
 await page.goto(`${option('url')??'http://127.0.0.1:1420'}/motion-capture`)
 for(const effect of effects){
  const result=await page.evaluate(async({effect,duration,redesign})=>{
   const roots=[`/artifacts/${redesign?'scene-redesign':'motion-quality'}/baseline/src/features/spectrum`,'/src/features/spectrum'],modules=[]
   const {studyAnalysis,studySettings}=await import('/src/features/spectrum/visual-study.ts')
   const config={...studySettings(effect,'immersive'),quality:'balanced'}
   const output=document.createElement('canvas');output.width=1280;output.height=410;document.body.append(output)
   const ctx=output.getContext('2d'),curves=[],snapshots=[]
   for(const root of roots){
    const [{FiberSceneRenderer},{SceneMotion},{AudioFeatureTimeline}]=await Promise.all([import(root+'/three/r3f/fiber-renderer.tsx'),import(root+'/three/motion.ts'),import(root+'/audio-feature-timeline.ts')])
    const canvas=document.createElement('canvas');canvas.style.cssText='width:640px;height:360px;position:absolute;left:-10000px';document.body.append(canvas)
    const world=new FiberSceneRenderer(canvas),motion=new SceneMotion(),timeline=new AudioFeatureTimeline();await world.resize(config,1)
    modules.push({canvas,world,motion,timeline,sequence:0,audio:studyAnalysis(0),remaining:null})
   }
   const stream=output.captureStream(0),track=stream.getVideoTracks()[0],chunks=[]
   const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm'
   const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:5500000})
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
   const done=new Promise(r=>recorder.onstop=r),start=performance.now();recorder.start()
   const input=seq=>{
    const t=seq*1024/48000
    let audio=studyAnalysis(seq)
    if(t>=16&&t<18.5)audio=studyAnalysis(Math.round((3.2+t-16)*48000/1024))
    if(t>=.25&&t<.38)audio=studyAnalysis(Math.round(.8*48000/1024))
    return {...audio,sequence:seq,samplePosition:seq*1024}
   }
   // Reproduce the observed busy-workspace delivery pattern: a 50ms queue
   // delay followed by a batch, preserving capture order and sample positions.
   const arrival=seq=>seq*1024/48+20+Math.max(0,50-(seq%9)*1024/48)
   try{
    for(let frame=0;frame<=duration*30;frame++){
     const time=frame/30,row={time}
     ctx.fillStyle='#151d26';ctx.fillRect(0,0,1280,410)
     for(let i=0;i<2;i++){
      const s=modules[i]
      while(arrival(s.sequence)<=time*1000+1e-6){s.audio=input(s.sequence);s.timeline.push(s.audio,arrival(s.sequence++))}
      const shared=s.timeline.sample(time*1000,config.music)
      s.motion.step(s.audio,1/30,config.music,false,shared);s.world.draw(s.motion,config,false,1/30)
      ctx.drawImage(s.canvas,i*640,40,640,360)
      let phase=null;s.world.scene.traverse(o=>{if(phase===null&&o.material?.uniforms?.uPhase)phase=o.material.uniforms.uPhase.value})
      row[i?'after':'before']={clock:shared?.now??null,phase,transport:s.motion.phase,beat:s.motion.frame?.beatIndex,onset:s.motion.frame?.onset}
     }
     ctx.fillStyle='#d7e5ed';ctx.font='16px sans-serif';ctx.fillText(redesign?'重新设计前':'R3F 整合最终基线',18,27);ctx.fillText(redesign?'重新设计后':'运动修复与轨迹设计',658,27)
     ctx.font='12px sans-serif';ctx.fillStyle='#9fb3bd';ctx.fillText(`${effect} · ${time.toFixed(2)}s · 合成特征（非 PCM / 非真实音乐）· 30Hz 固定重放 · 同配置、种子、镜头、包到达抖动`,18,408)
     track.requestFrame();curves.push(row)
     if([2,5,7.5,10,12.2,15.8,17.5,20].some(t=>Math.abs(time-t)<.001))snapshots.push({time,image:output.toDataURL('image/png')})
     await new Promise(r=>setTimeout(r,Math.max(0,start+(frame+1)*1000/30-performance.now())))
    }
   }finally{
    recorder.stop();await done;stream.getTracks().forEach(t=>t.stop())
    for(const s of modules){s.world.dispose();s.remaining={...s.world.renderer.info.memory};s.world.renderer.forceContextLoss();s.canvas.remove()}
    output.remove()
   }
   const bytes=new Uint8Array(await new Blob(chunks,{type:mime}).arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768))
   return {effect,config,curves,snapshots,video:btoa(binary),elapsed:performance.now()-start,remaining:modules.map(s=>s.remaining)}
  },{effect,duration:Number(option('duration')??20),redesign})
  await writeFile(`${folder}/${effect}.webm`,Buffer.from(result.video,'base64'));delete result.video
  for(const frame of result.snapshots){frame.file=`${effect}-${frame.time}.png`;await writeFile(`${folder}/${frame.file}`,Buffer.from(frame.image.split(',')[1],'base64'));delete frame.image}
  reports.push(result);console.log(`${effect}: video and ${result.curves.length} consecutive simulation frames, remaining ${JSON.stringify(result.remaining)}`)
 }
}finally{await browser.close()}
await writeFile(`${folder}/report.json`,JSON.stringify({method:'Authored synthetic features; 48000/1024 packet clock, deterministic arrival jitter, fixed geometry seeds; 30Hz, two renderers. Includes isolated hit, rhythm, sustain, low/mid/high, quiet, stop, recovery. NOT live FPS or PCM DSP.',reports,errors},null,2))
await writeFile(`${folder}/index.html`,`<!doctype html><meta charset="utf-8"><title>连续运动 A/B · ${label}</title><body style="background:#151d26;color:#d7e5ed;font:16px/1.8 sans-serif;margin:24px"><h1>SoundSpectra 连续运动 A/B</h1><p>左：${redesign?'重新设计前':'R3F 整合最终基线'}；右：${redesign?'重新设计后':'运动改进'}。固定合成特征与到达抖动、同种子/镜头/配置。包含鼓点、长音、高频、弱音、突停和恢复。无声音；数值不作为美观评分。</p>${reports.map(r=>`<h2>${r.effect}</h2><video controls loop preload="metadata" width="1280" style="max-width:100%" src="${r.effect}.webm"></video>`).join('')}`)
if(errors.length||reports.some(r=>r.remaining.some(m=>m.geometries||m.textures)))process.exitCode=1
