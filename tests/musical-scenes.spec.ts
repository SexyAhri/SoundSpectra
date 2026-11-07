import { expect, test } from '@playwright/test'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'
import { SceneMotion } from '../src/features/spectrum/three/motion'
import { defaultMusicSettings } from '../src/features/spectrum/music-engine/catalog'

test('musical accents stay causal, regional, bounded and silent without changing captured RMS', () => {
  const motion = new SceneMotion(), settings = { ...defaultMusicSettings, sensitivity: 1 }
  const audio = { rms: .12, bands: [.7,.6,.1,.1,.05,.05], spectrum: Array(48).fill(.2), skin: [] }
  for (let i = 0; i < 120; i++) motion.step(audio, 1/60, settings, false)
  const frame = motion.frame!
  motion.step(audio, 1/60, settings, false, { ...frame, transients: [.8,0,0], beatIndex: frame.beatIndex+1, beatStrength: .8, beatAge: 12 })
  expect(motion.frame!.intensitySample.current).toBe(.12)
  expect(motion.accents[0]).toBeGreaterThan(.3)
  expect(motion.accents[1]).toBeLessThan(.001); expect(motion.accents[2]).toBeLessThan(.001)
  const peak = motion.accents[0]
  for (let i = 0; i < 30; i++) motion.step(audio, 1/60, settings, false, { ...frame, transients: [0,0,0], beatAge: 1000 })
  expect(motion.accents[0]).toBeLessThan(peak*.01)
  motion.step(audio, 1/60, settings, true, { ...frame, transients: [1,1,1] })
  expect([...motion.accents]).toEqual([0,0,0])
  const phase = motion.phase
  for (let i = 0; i < 180; i++) motion.step({ ...audio, rms:0 }, 1/60, settings, false)
  expect(motion.phase).toBe(phase); expect(motion.energy).toBe(0); expect(motion.presence).toBe(0)
})

test('each authored scene consumes captured accents separately from its continuous path', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('**/musical-scene-probe', route => route.fulfill({ contentType:'text/html',body:visualProbeHtml('<body></body>') }))
  await page.goto('/musical-scene-probe')
  const result = await page.evaluate(async () => {
    const [{ FiberSceneRenderer }, { SceneMotion }, { studySettings }, { musicEffects }] = await Promise.all([
      import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'), import('/src/features/spectrum/three/motion.ts'),
      import('/src/features/spectrum/visual-study.ts'), import('/src/features/spectrum/music-engine/catalog.ts')])
    const results = []
    for (const { value:effect } of musicEffects) {
      const config = {...studySettings(effect,'immersive'),quality:'eco' as const}
      const worlds = [false,true].map(accent=>{
        const canvas=document.createElement('canvas');canvas.style.cssText='width:320px;height:180px';document.body.append(canvas)
        return {accent,canvas,world:new FiberSceneRenderer(canvas),motion:new SceneMotion()}
      })
      const audio = { rms:.12,bands:[.5,.5,.4,.4,.3,.3],spectrum:Array(48).fill(.4),skin:[] }
      try {
        const images=[],errors=[]
        for(const {accent,canvas,world,motion} of worlds){
          await world.resize(config,1)
          for(let i=0;i<45;i++){motion.step(audio,1/60,config.music,false);world.draw(motion,config,false)}
          const frame=motion.frame!,phase=motion.phase,auroraPhase=motion.auroraPhase
          const flow=motion.flowPhase.bind(motion),phases=new Map<string,number>()
          // Each branch starts with identical state. Freeze every transport
          // family while letting a real event grow and decay for 100 ms.
          motion.flowPhase=(key,speed,sustain,reduced)=>{
            if(!phases.has(key))phases.set(key,flow(key,speed,sustain,reduced))
            return phases.get(key)!
          }
          for(let i=0;i<6;i++){
            motion.step(audio,1/60,config.music,false,{...frame,transients:accent?[.8,.7,.6]:[0,0,0],pulse:accent?.8:0,beatIndex:frame.beatIndex+(accent?1:0),beatAge:accent?16+i*1000/60:2000,beatStrength:accent?.9:0,bandOnsets:accent?[true,true,true]:[false,false,false]})
            motion.phase=phase;motion.auroraPhase=auroraPhase
            world.draw(motion,config,false)
          }
          const gl=world.renderer.getContext(),pixels=new Uint8Array(canvas.width*canvas.height*4)
          gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
          images.push(pixels);errors.push(gl.getError())
        }
        const [before,attack]=images
        let changed=0,delta=0
        for(let i=0;i<before.length;i+=4){const d=Math.max(Math.abs(before[i]-attack[i]),Math.abs(before[i+1]-attack[i+1]),Math.abs(before[i+2]-attack[i+2]));if(d>1)changed++;delta+=d}
        results.push({effect,changed,delta,errors})
      }finally{for(const {world,canvas} of worlds){world.dispose();world.renderer.forceContextLoss();canvas.remove()}}
    }
    return results
  })
  for(const row of result){expect(row.changed,JSON.stringify(row)).toBeGreaterThan(4);expect(row.errors).toEqual([0,0])}
})

test('galaxy carrier has no uncovered pixels through camera rotation and roll', async ({page})=>{
  await page.route('**/galaxy-shell-probe',route=>route.fulfill({contentType:'text/html',body:visualProbeHtml('<body></body>')}))
  await page.goto('/galaxy-shell-probe')
  const result=await page.evaluate(async()=>{
    const [T,{FiberSceneRenderer},{SceneMotion},{studySettings}]=await Promise.all([import('/node_modules/.vite/deps/three.js'),import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),import('/src/features/spectrum/three/motion.ts'),import('/src/features/spectrum/visual-study.ts')])
    const canvas=document.createElement('canvas');canvas.style.cssText='width:480px;height:270px';document.body.append(canvas)
    const config={...studySettings('dream_stars','immersive'),quality:'eco' as const},world=new FiberSceneRenderer(canvas),motion=new SceneMotion(),views=[]
    const target=new T.WebGLRenderTarget(480,270)
    try{
      await world.resize(config,1)
      for(let i=0;i<90;i++)motion.step({rms:.15,bands:Array(6).fill(.4),spectrum:Array(48).fill(.4),skin:[]},1/60,config.music,false)
      for(const view of [{yaw:0,roll:0},{yaw:37,roll:65},{yaw:-65,roll:90}]){
        world.draw(motion,{...config,view:{...config.view,...view}},false)
        const gas=world.scene.getObjectByName('galaxy-gas') as any
        if(!gas)throw Error('Galaxy gas missing')
        // Replace only emission so a dim nebula cannot hide a carrier edge.
        // This checks rasterized coverage rather than the geometry's class.
        const material=gas.material,diagnostic=material.clone()
        diagnostic.fragmentShader='void main(){gl_FragColor=vec4(1.);}'
        diagnostic.blending=T.NoBlending
        const hidden:any[]=[]
        world.scene.traverse((o:any)=>{if(o!==gas&&o.material&&o.visible){hidden.push(o);o.visible=false}})
        gas.material=diagnostic
        world.renderer.setRenderTarget(target);world.renderer.setClearColor(0,0);world.renderer.clear()
        world.renderer.render(world.scene,world.camera)
        const pixels=new Uint8Array(480*270*4);world.renderer.readRenderTargetPixels(target,0,0,480,270,pixels)
        let holes=0;for(let i=0;i<pixels.length;i+=4)holes+=Number(pixels[i]<250)
        views.push({holes,error:world.renderer.getContext().getError()})
        gas.material=material;diagnostic.dispose();hidden.forEach(o=>o.visible=true);world.renderer.setRenderTarget(null)
      }
      return views
    }finally{target.dispose();world.dispose();world.renderer.forceContextLoss();canvas.remove()}
  })
  for(const row of result)expect(row).toEqual({holes:0,error:0})
})

test('appearance starts with three preferences and keeps music timing automatic',async({page})=>{
  await page.goto('/');await page.getByRole('tab',{name:'外观',exact:true}).click()
  await expect(page.locator('.art-control')).toHaveCount(3)
  await expect(page.getByRole('slider',{name:'音乐参与度',exact:true})).toBeVisible()
  await page.getByText('造型细节',{exact:true}).click()
  for(const name of ['漂游速度','运动速度','音乐响应','音乐灵敏度'])await expect(page.getByRole('slider',{name,exact:true})).toHaveCount(0)
  await expect(page.getByRole('combobox',{name:'运动速度',exact:true})).toHaveCount(0)
  await expect(page.getByRole('combobox',{name:'音乐响应',exact:true})).toHaveCount(0)
})
