import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {visualProbeHtml} from './visual-probe-html.mjs'
const label=process.argv[2]??'review',thumbnails=process.argv.includes('--thumbnails')
if(!/^[\w-]+$/.test(label))throw Error('Invalid label')
const folder=`artifacts/scene-redesign/${label}`;await mkdir(folder,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl']})
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/redesign-probe',r=>r.fulfill({contentType:'text/html',body:visualProbeHtml('<body style="margin:0"></body>')}))
 await page.goto('http://127.0.0.1:1420/redesign-probe')
 const results=[]
 for(const effect of ['volume_rain','petal_bloom'])for(const mode of ['immersive','daily'])for(const version of ['before','after']){
  const r=await page.evaluate(async({effect,mode,version,thumbnails})=>{
   const root=version==='before'?'/artifacts/scene-redesign/baseline/src/features/spectrum':'/src/features/spectrum'
   const [{FiberSceneRenderer},{SceneMotion},{studySettings},{studyAnalysis}]=await Promise.all([import(root+'/three/r3f/fiber-renderer.tsx'),import(root+'/three/motion.ts'),import('/src/features/spectrum/visual-study.ts'),import('/src/features/spectrum/visual-study.ts')])
   const canvas=document.createElement('canvas');canvas.style.cssText='width:960px;height:540px';document.body.append(canvas)
   const settings=studySettings(effect,mode),world=new FiberSceneRenderer(canvas),motion=new SceneMotion();let disposed=false
   try{
    await world.resize(settings,1)
    for(let i=0;i<156;i++){motion.step(studyAnalysis(Math.round(i/30*48000/1024)),1/30,settings.music,false);world.draw(motion,settings,false)}
    const image=canvas.toDataURL('image/png'),gl=world.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info')
    const result={effect,mode,version,settings,image,error:gl.getError(),gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)}
    if(thumbnails&&version==='after'&&mode==='immersive'){
      const thumb=document.createElement('canvas');thumb.width=480;thumb.height=270;thumb.getContext('2d').drawImage(canvas,0,0,480,270)
      result.thumbnail=thumb.toDataURL('image/webp',.92)
    }
    world.dispose();disposed=true;result.remaining={...world.renderer.info.memory};return result
   }finally{if(!disposed)world.dispose();world.renderer.forceContextLoss();canvas.remove()}
  },{effect,mode,version,thumbnails})
  if(r.thumbnail){await writeFile(`src/assets/scenes/${effect}.webp`,Buffer.from(r.thumbnail.split(',')[1],'base64'));delete r.thumbnail}
  r.file=`${effect}-${mode}-${version}.png`;await writeFile(`${folder}/${r.file}`,Buffer.from(r.image.split(',')[1],'base64'));delete r.image;results.push(r)
  console.log(JSON.stringify({effect,mode,version,error:r.error,remaining:r.remaining}))
 }
 await writeFile(`${folder}/report.json`,JSON.stringify({errors,method:'Actual scene renderers, same settings and synthetic features, 30 Hz, 5.2s; no PCM or user settings changes.',results},null,2))
 await writeFile(`${folder}/index.html`,`<!doctype html><meta charset="utf-8"><style>body{background:#17202a;color:#dae4e9;font:16px sans-serif}section{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%;background:#525e65}h2{grid-column:1/-1}</style><p>左：修改前；右：重新设计。相同合成特征、参数、镜头。</p><section>${['volume_rain','petal_bloom'].flatMap(e=>['immersive','daily'].map(m=>`<h2>${e} · ${m}</h2><img src="${e}-${m}-before.png"><img src="${e}-${m}-after.png">`)).join('')}</section>`)
 const preview=`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:20px;background:#171c22;color:#e7e7e2;font:16px 'Microsoft YaHei',sans-serif}main{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;border:1px solid #394149;border-radius:10px;overflow:hidden;background:#07090b}img{display:block;width:100%;aspect-ratio:16/9}figcaption{padding:12px 16px}small{display:block;color:#a2aaa8;font-size:12px;margin-top:5px}</style><main>${[['volume_rain','晴空浮游','羽絮、细纤维与景深'],['petal_bloom','星瓣花境','层叠花瓣、花蕊与游离花瓣']].map(([e,name,detail])=>`<figure><img src="/artifacts/scene-redesign/${label}/${e}-immersive-after.png"><figcaption>${name}<small>${detail} · 实际渲染</small></figcaption></figure>`).join('')}</main>`
 await page.setViewportSize({width:1200,height:440});await page.setContent(preview);await page.locator('img').evaluateAll(images=>Promise.all(images.map(i=>i.decode())))
 await page.screenshot({path:`${folder}/preview.png`,fullPage:true})
 if(errors.length||results.some(r=>r.error||r.remaining.geometries||r.remaining.textures))process.exitCode=1
}finally{await browser.close()}
