import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { visualProbeHtml } from './visual-probe-html.mjs'
const label=process.argv[2]??'review'
if(!/^[\w-]+$/.test(label))throw Error('Invalid label')
const folder=`artifacts/resize-cold/${label}`;await mkdir(folder,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl']})
try{
 const page=await browser.newPage({viewport:{width:2000,height:1200},deviceScaleFactor:1.5})
 await page.route('**/cold-resize-probe',r=>r.fulfill({contentType:'text/html',body:visualProbeHtml('<body style="margin:0"></body><style>canvas{width:100%;height:100%}</style>')}))
 await page.goto('http://127.0.0.1:1420/cold-resize-probe')
 const result=await page.evaluate(async()=>{
  const {FiberSceneRenderer}=await import('/src/features/spectrum/three/r3f/fiber-renderer.tsx')
  const {SceneMotion}=await import('/src/features/spectrum/three/motion.ts')
  const {studySettings,studyAnalysis}=await import('/src/features/spectrum/visual-study.ts')
  const {musicEffects}=await import('/src/features/spectrum/music-engine/catalog.ts')
  const rows=[]
  for(const {value:effect} of musicEffects){
   const host=document.createElement('div'),c=document.createElement('canvas');host.append(c);document.body.append(host)
   const world=new FiberSceneRenderer(c),motion=new SceneMotion(),config={...studySettings(effect,'immersive'),quality:'smooth'}
   const gl=world.renderer.getContext()
   let shaderCompiles=0;const compile=gl.compileShader.bind(gl);gl.compileShader=shader=>{shaderCompiles++;compile(shader)}
   for(let i=0;i<90;i++)motion.step(studyAnalysis(60+i),1/60,config.music,false)
   try{
    for(const [index,[width,height]] of [[944,531],[1964,1105],[944,531],[1964,1105]].entries()){
     host.style.cssText=`width:${width}px;height:${height}px`
     const beats=[];let beat=0,previousBeat=performance.now()
     const tick=now=>{beats.push(now-previousBeat);previousBeat=now;beat=requestAnimationFrame(tick)}
     beat=requestAnimationFrame(tick)
     const compilesBefore=shaderCompiles
     const start=performance.now();await world.resize(config,1,{preview:true});const resize=performance.now()-start
     cancelAnimationFrame(beat)
     const programsBefore=world.renderer.info.programs.length
     const submitted=performance.now();world.draw(motion,config,false);const submit=performance.now()-submitted
     gl.finish();const complete=performance.now()-submitted
     rows.push({effect,index,css:[width,height],buffer:[c.width,c.height],resize,submit,complete,shaderCompiles:shaderCompiles-compilesBefore,preparations:Number(c.dataset.preparations),heartbeatFrames:beats.length,maxHeartbeatGap:beats.length?Math.max(...beats):null,programsBefore,programsAfter:world.renderer.info.programs.length,parallelCompilation:!!gl.getExtension('KHR_parallel_shader_compile'),samples:world.image.samples,error:gl.getError()})
     for(let i=0;i<12;i++){world.draw(motion,config,false);await new Promise(requestAnimationFrame)}
    }
   }finally{world.dispose();world.renderer.forceContextLoss();host.remove()}
  }
  return {method:'Cold production renderer resize with GPU finish; editor preview policy, 1.5 DPR. Not native window presentation FPS.',rows}
 })
 await writeFile(`${folder}/report.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{await browser.close()}
