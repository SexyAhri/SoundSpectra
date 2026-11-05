import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('artifacts/classic-3d',{recursive:true})
const thumbnails=process.argv.includes('--thumbnails')
const selectedEffect=process.argv.find(arg=>arg.startsWith('--effect='))?.split('=')[1]
if(thumbnails)mkdirSync('src/assets/scenes',{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true, args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
try {
  const page=await browser.newPage({viewport:{width:1280,height:800}})
  await page.route('**/classic-capture.html',route=>route.fulfill({contentType:'text/html',body:'<body style="margin:0;background:#080c14"></body>'}))
  await page.goto('http://127.0.0.1:1420/classic-capture.html')
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  const effects=await page.evaluate(async()=>{const {classicMusicEffects}=await import('/src/features/spectrum/music-engine/catalog.ts');return classicMusicEffects})
  const rows=[]
  for(const effect of effects.filter(effect=>!selectedEffect||effect.value===selectedEffect)){
    const result=await page.evaluate(async effect=>{
      const {createThreeSceneRenderer}=await import('/src/features/spectrum/three/scene-renderer.ts')
      const {SceneMotion}=await import('/src/features/spectrum/three/motion.ts')
      const {defaults}=await import('/src/features/spectrum/model.ts')
      const {demoAnalysis}=await import('/src/features/spectrum/music-analysis.ts')
      const config={...defaults,effect:effect.value,sceneMode:'immersive',bounds:{x:0,y:0,width:1,height:1}}
      const canvas=document.createElement('canvas');canvas.style.cssText='width:480px;height:270px';document.body.append(canvas)
      const world=createThreeSceneRenderer(canvas,config.effect),motion=new SceneMotion();world.resize(config,1)
      for(let frame=0;frame<180;frame++){motion.step(demoAnalysis(frame/60),1/60,config.music,false);world.draw(motion,config,false)}
      canvas.style.cssText='width:960px;height:540px';world.resize(config,1)
      if(motion.frame)motion.frame.dt=0
      world.renderer.info.autoReset=false;world.renderer.info.reset();world.draw(motion,config,false)
      const image=canvas.toDataURL('image/png'),gl=world.renderer.getContext(),data=new Uint8Array(canvas.width*canvas.height*4)
      gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data)
      let lit=0,white=0;for(let i=0;i<data.length;i+=4){if(Math.max(data[i],data[i+1],data[i+2])>50)lit++;if(Math.min(data[i],data[i+1],data[i+2])>230)white++}
      const stats={lit:lit/(data.length/4),white:white/(data.length/4),calls:world.renderer.info.render.calls,triangles:world.renderer.info.render.triangles,glError:gl.getError()}
      world.draw(motion,{...config,view:{...config.view,yaw:35,pitch:12}},false)
      const rotated=canvas.toDataURL('image/png')
      canvas.style.cssText='width:320px;height:180px';world.resize(config,1);world.draw(motion,config,false)
      // Capture transparent scenes against the same dark surface as their cards.
      const cover=document.createElement('canvas');cover.width=canvas.width;cover.height=canvas.height
      const context=cover.getContext('2d');context.fillStyle='#101c2b';context.fillRect(0,0,cover.width,cover.height);context.drawImage(canvas,0,0)
      const thumbnail=cover.toDataURL('image/webp',.92)
      world.dispose();world.renderer.forceContextLoss();canvas.remove()
      return {image,rotated,thumbnail,...stats}
    },effect)
    writeFileSync(`artifacts/classic-3d/${effect.value}.png`,Buffer.from(result.image.split(',')[1],'base64'))
    writeFileSync(`artifacts/classic-3d/${effect.value}-rotated.png`,Buffer.from(result.rotated.split(',')[1],'base64'))
    if(thumbnails)writeFileSync(`src/assets/scenes/${effect.value}.webp`,Buffer.from(result.thumbnail.split(',')[1],'base64'))
    rows.push({...effect,...result});console.log(JSON.stringify({effect:effect.value,lit:result.lit,calls:result.calls,glError:result.glError}))
  }
  const gallery=await page.evaluate(async rows=>{
    const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=906;const context=canvas.getContext('2d')
    context.fillStyle='#090d15';context.fillRect(0,0,canvas.width,canvas.height)
    context.fillStyle='#d8e1ed';context.font='22px sans-serif';context.fillText('十二套三维音乐场景 · 固定模拟音频',24,36)
    for(let i=0;i<rows.length;i++){const row=rows[i],img=new Image();img.src=row.image;await img.decode();const x=16+i%4*356,y=60+Math.floor(i/4)*280;context.drawImage(img,x,y,340,191);context.font='18px sans-serif';context.fillStyle='#d8e1ed';context.fillText(row.label,x+10,y+220);context.font='13px sans-serif';context.fillStyle='#8b9ab0';context.fillText(row.value,x+10,y+243)}
    return canvas.toDataURL('image/png')
  },rows)
  writeFileSync('artifacts/classic-3d-gallery.png',Buffer.from(gallery.split(',')[1],'base64'))
  writeFileSync('artifacts/classic-3d-report.json',JSON.stringify({input:'fixed simulated audio',errors,effects:rows.map(({image,rotated,thumbnail,...row})=>row)},null,2))
}finally{await browser.close()}
