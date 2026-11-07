import { expect, test } from '@playwright/test'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

test('R3F quality and layer changes reuse one context and release every owned GPU resource',async({page})=>{
  await page.route('**/r3f-runtime-probe',route=>route.fulfill({contentType:'text/html',body:visualProbeHtml('<body style="margin:0"></body>')}))
  await page.goto('/r3f-runtime-probe')
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  const result=await page.evaluate(async()=>{
    const [{FiberSceneRenderer},{SceneMotion},{defaults},{demoAnalysis}]=await Promise.all([
      import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),import('/src/features/spectrum/three/motion.ts'),
      import('/src/features/spectrum/model.ts'),import('/src/features/spectrum/music-analysis.ts'),
    ])
    const canvas=document.createElement('canvas');canvas.style.cssText='width:240px;height:135px';document.body.append(canvas)
    const world=new FiberSceneRenderer(canvas),motion=new SceneMotion(),gl=world.renderer.getContext(),memory=[],frames=[]
    const config={...structuredClone(defaults),effect:'aurora_flow' as const,sceneMode:'immersive' as const,bounds:{x:0,y:0,width:1,height:1}}
    for(let i=0;i<8;i++){
      const settings={...config,quality:i%2?'balanced' as const:'eco' as const,music:{...config.music,ambientDensity:i%2?1.4:.5}}
      await world.resize(settings,i%2?4:1)
      const framesBefore=Number(canvas.dataset.frames??0)
      for(let frame=0;frame<3;frame++){motion.step(demoAnalysis(2+frame/60),1/60,settings.music,false);world.draw(motion,settings,false)}
      frames.push(Number(canvas.dataset.frames)-framesBefore)
      memory.push({...world.renderer.info.memory,bloom:Number(canvas.dataset.bloomLevels),sameContext:gl===world.renderer.getContext(),error:gl.getError()})
    }
    const restored={...config,effect:'rhythm_rain' as const,view:{...config.view,x:17,y:-9}}
    await world.resize(restored,1)
    world.draw(motion,restored,false)
    const firstView=world.camera.matrixWorld.elements.slice()
    world.draw(motion,restored,false)
    const viewError=Math.max(...world.camera.matrixWorld.elements.map((value,i)=>Math.abs(value-firstView[i])))
    const manualFrames=Number(canvas.dataset.frames)
    await new Promise(resolve=>setTimeout(resolve,100))
    const idleFrames=Number(canvas.dataset.frames)-manualFrames
    world.dispose()
    const after={...world.renderer.info.memory}
    await new Promise(resolve=>setTimeout(resolve,0))
    const lost=gl.isContextLost();canvas.remove()
    return {memory,frames,after,lost,viewError,manualFrames,idleFrames,framework:canvas.dataset.framework}
  })
  expect(result.framework).toBe('r3f')
  for(const frame of result.memory){expect(frame.sameContext).toBe(true);expect(frame.error).toBe(0)}
  expect(result.memory.map(frame=>frame.bloom)).toEqual([1,2,1,2,1,2,1,2])
  expect(result.memory.at(-1)!.geometries).toBe(result.memory[1].geometries)
  expect(result.memory.at(-1)!.textures).toBe(result.memory[1].textures)
  expect(result.after).toEqual({geometries:0,textures:0})
  expect(result.lost).toBe(true);expect(errors).toEqual([])
  expect(result.viewError).toBe(0)
  // The compositor counter restarts on an effect change. Check each batch of
  // requested frames as well as the two frames in the final mounted scene.
  expect(result.frames).toEqual(Array(8).fill(3))
  expect(result.manualFrames).toBe(2)
  expect(result.idleFrames).toBe(0)
})

test('a live source resumes at current audio after its R3F region sleeps',async({page})=>{
  await page.goto('/')
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await page.evaluate(async()=>{
    const {mountSoundFieldProbe}=await import('/tests/fixtures/sound-field-probe.tsx')
    const probe=mountSoundFieldProbe({effect:'aurora_flow',quality:'eco'})
    const state={probe,sequence:0,timer:0};(window as any).__r3fProbe=state
    state.timer=window.setInterval(()=>{
      const sequence=state.sequence++
      probe.push({sourceRevision:1,streamId:1,sequence,samplePosition:sequence*1024,sampleRate:48000,rms:.15,bands:Array(6).fill(.4),spectrum:Array(48).fill(.5),skin:[]})
    },22)
  })
  const canvas=page.locator('#sound-field-probe canvas')
  await expect(canvas).toHaveAttribute('data-framework','r3f')
  await expect.poll(()=>canvas.getAttribute('data-frames').then(Number)).toBeGreaterThan(3)
  await page.evaluate(()=>(window as any).__r3fProbe.probe.active(false))
  await page.waitForTimeout(300)
  const stopped=Number(await canvas.getAttribute('data-frames'))
  await page.waitForTimeout(300)
  expect(Number(await canvas.getAttribute('data-frames'))).toBe(stopped)
  await page.evaluate(()=>(window as any).__r3fProbe.probe.active(true))
  await expect.poll(()=>canvas.getAttribute('data-frames').then(Number)).toBeGreaterThan(stopped+2)
  await expect(canvas).toHaveAttribute('data-rms','0.1500')
  await page.evaluate(()=>{const state=(window as any).__r3fProbe;clearInterval(state.timer);state.probe.dispose()})
  expect(errors).toEqual([])
})
