import { expect, test } from '@playwright/test'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

test.beforeEach(async ({page})=>{
  await page.route('**/scene-preparation-probe',route=>route.fulfill({contentType:'text/html',body:visualProbeHtml('<body style="margin:0"></body>')}))
  await page.goto('/scene-preparation-probe')
})

test('preparation compiles the actual main, bloom and terrain variants; resizing retains them',async({page})=>{
  test.setTimeout(90_000)
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  const rows=await page.evaluate(async()=>{
    const [{FiberSceneRenderer},{SceneMotion},{studySettings},{musicEffects}]=await Promise.all([
      import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),
      import('/src/features/spectrum/three/motion.ts'),import('/src/features/spectrum/visual-study.ts'),
      import('/src/features/spectrum/music-engine/catalog.ts'),
    ])
    const canvas=document.createElement('canvas');canvas.style.cssText='width:320px;height:180px';document.body.append(canvas)
    const world=new FiberSceneRenderer(canvas),motion=new SceneMotion(),rows=[]
    let compilations=0
    const gl=world.renderer.getContext();let shaderCompilations=0
    const compileShader=gl.compileShader.bind(gl)
    gl.compileShader=shader=>{shaderCompilations++;compileShader(shader)}
    const compile=world.renderer.compileAsync.bind(world.renderer)
    world.renderer.compileAsync=(...args)=>{compilations++;return compile(...args)}
    try{
      for(const {value:effect} of musicEffects){
        canvas.style.cssText='width:320px;height:180px'
        const config={...studySettings(effect,'immersive'),quality:'eco' as const}
        await world.resize(config,1)
        const prepared=world.renderer.info.programs!.length,preparedCalls=compilations
        const drew=world.draw(motion,config,false)
        const first=world.renderer.info.programs!.length
        const preparedShaders=shaderCompilations
        const materials:string[]=[];world.scene.traverse((o:any)=>{if(o.material)materials.push(o.material.uuid)})
        canvas.style.cssText='width:640px;height:360px'
        await world.resize(config,1,{preview:true});world.draw(motion,config,false)
        const resized:string[]=[];world.scene.traverse((o:any)=>{if(o.material)resized.push(o.material.uuid)})
        rows.push({effect,prepared,first,afterResize:world.renderer.info.programs!.length,drew,preparedCalls,afterCalls:compilations,preparedShaders,afterShaders:shaderCompilations,materials,resized,error:gl.getError()})
      }
    }finally{world.dispose();world.renderer.forceContextLoss();canvas.remove()}
    return rows
  })
  for(const row of rows){
    expect(row.prepared,row.effect).toBeGreaterThan(0)
    expect(row.drew,row.effect).toBe(true)
    expect(row.first,row.effect).toBe(row.prepared)
    expect(row.afterResize,row.effect).toBe(row.prepared)
    expect(row.afterCalls,row.effect).toBe(row.preparedCalls)
    expect(row.afterShaders,row.effect).toBe(row.preparedShaders)
    expect(row.resized,row.effect).toEqual(row.materials)
    expect(row.error,row.effect).toBe(0)
  }
  expect(errors).toEqual([])
})

test('pending compilation leaves the event loop available and only the latest resize commits',async({page})=>{
  const result=await page.evaluate(async()=>{
    const [{FiberSceneRenderer},{SceneMotion},{studySettings}]=await Promise.all([
      import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),
      import('/src/features/spectrum/three/motion.ts'),import('/src/features/spectrum/visual-study.ts'),
    ])
    const canvas=document.createElement('canvas');canvas.style.cssText='width:320px;height:180px';document.body.append(canvas)
    const world=new FiberSceneRenderer(canvas),motion=new SceneMotion(),config={...studySettings('dream_stars','immersive'),quality:'eco' as const}
    let release!:()=>void,started!:()=>void
    const gate=new Promise<void>(r=>release=r),begin=new Promise<void>(r=>started=r)
    const compile=world.renderer.compileAsync.bind(world.renderer)
    world.renderer.compileAsync=(...args)=>{
      const prepared=compile(...args);started()
      return gate.then(()=>prepared)
    }
    try{
      const first=world.resize(config,1);await begin
      const waiting=world.draw(motion,config,false),beforeFrames=Number(canvas.dataset.frames??0)
      canvas.style.cssText='width:480px;height:270px';const middle=world.resize(config,1)
      canvas.style.cssText='width:800px;height:450px';const latest=world.resize(config,1)
      await new Promise(requestAnimationFrame)
      const pending=canvas.dataset.preparing
      release();await Promise.all([first,middle,latest])
      const rendered=world.draw(motion,config,false)
      return {waiting,beforeFrames,pending,rendered,ready:canvas.dataset.preparing,size:[canvas.width,canvas.height],frames:Number(canvas.dataset.frames),error:world.renderer.getContext().getError()}
    }finally{release();world.dispose();world.renderer.forceContextLoss();canvas.remove()}
  })
  expect(result.waiting).toBe(false);expect(result.beforeFrames).toBe(0)
  expect(result.pending).toBe('true');expect(result.ready).toBe('false')
  expect(result.rendered).toBe(true);expect(result.size).toEqual([800,450]);expect(result.frames).toBe(1);expect(result.error).toBe(0)
})

test('editor preview budgets share pixels across regions while desktop quality retains 4K',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {previewDrawingSize,threeDrawingSize}=await import('/src/features/spectrum/three/render-budget.ts')
    const desktop=threeDrawingSize(3840,2160,1,'balanced')
    return {desktop,small:previewDrawingSize({width:480,height:270},1),previews:[1,2,4].map(regions=>({regions,...previewDrawingSize(desktop,regions)}))}
  })
  expect(result.desktop).toEqual({width:3840,height:2160})
  expect(result.small).toEqual({width:480,height:270})
  for(const row of result.previews){expect(row.width*row.height*row.regions).toBeLessThanOrEqual(1920*1080);expect(row.width/row.height).toBeCloseTo(16/9,2)}
})

test('closing during preparation retains polled materials until compilation settles',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  const result=await page.evaluate(async()=>{
    const [{FiberSceneRenderer},{SceneMotion},{studySettings}]=await Promise.all([
      import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),
      import('/src/features/spectrum/three/motion.ts'),import('/src/features/spectrum/visual-study.ts'),
    ])
    const canvas=document.createElement('canvas');canvas.style.cssText='width:320px;height:180px';document.body.append(canvas)
    const world=new FiberSceneRenderer(canvas),config={...studySettings('rhythm_rain','immersive'),quality:'eco' as const}
    let release!:()=>void,started!:()=>void,disposed=0
    const gate=new Promise<void>(r=>release=r),begin=new Promise<void>(r=>started=r)
    const compile=world.renderer.compileAsync.bind(world.renderer)
    world.renderer.compileAsync=async(...args)=>{
      const result=await compile(...args);started();await gate;return result
    }
    try{
      const pending=world.resize(config,1);await begin
      world.scene.traverse((o:any)=>{o.material?.addEventListener('dispose',()=>disposed++)})
      world.dispose();world.dispose()
      const before=disposed,draw=world.draw(new SceneMotion(),config,false)
      release();await pending;await new Promise(r=>setTimeout(r,0))
      return {before,disposed,draw,memory:{...world.renderer.info.memory}}
    }finally{release();world.dispose();canvas.remove()}
  })
  expect(result.before).toBe(0);expect(result.disposed).toBeGreaterThan(0);expect(result.draw).toBe(false)
  expect(result.memory).toEqual({geometries:0,textures:0});expect(errors).toEqual([])
})

test('switching equally sized scenes restores their individual sampling budgets',async({page})=>{
  const samples=await page.evaluate(async()=>{
    const [{FiberSceneRenderer},{SceneMotion},{studySettings}]=await Promise.all([
      import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),
      import('/src/features/spectrum/three/motion.ts'),import('/src/features/spectrum/visual-study.ts'),
    ])
    const canvas=document.createElement('canvas');canvas.style.cssText='width:320px;height:180px';document.body.append(canvas)
    const world=new FiberSceneRenderer(canvas),motion=new SceneMotion(),samples=[]
    try{
      for(const effect of ['rhythm_rain','rhythm_balls','dream_stars','rhythm_balls'] as const){
        const config=studySettings(effect,'immersive')
        await world.resize(config,1);world.draw(motion,config,false)
        samples.push(world.image!.samples)
      }
      return samples
    }finally{world.dispose();world.renderer.forceContextLoss();canvas.remove()}
  })
  expect(samples).toEqual([0,4,0,4])
})
