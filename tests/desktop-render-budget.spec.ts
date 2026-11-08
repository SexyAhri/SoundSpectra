import { expect, test } from '@playwright/test'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

async function probe(page: import('@playwright/test').Page) {
  await page.route('**/desktop-budget-probe', route => route.fulfill({contentType:'text/html',body:visualProbeHtml('<body style="margin:0"></body><style>.spectrum-surface,canvas{width:100%;height:100%;display:block}</style>')}))
  await page.goto('/desktop-budget-probe')
}

test('adaptive resolution ignores warmup, follows the selected frame target and recovers slowly', async ({page}) => {
  await probe(page)
  const result = await page.evaluate(async () => {
    const { AdaptiveResolution } = await import('/src/features/spectrum/three/r3f/adaptive-resolution.ts')
    const p = new AdaptiveResolution(), rows: number[] = []
    let now = 0
    p.sample(30, now, 60)
    for (let i=0;i<120;i++) p.sample(30, now+=10, 60)
    rows.push(p.scale) // Compilation/initial allocation excluded.
    now = 2000
    for (let i=0;i<119;i++) p.sample(30, now+=17, 60)
    rows.push(p.scale)
    p.sample(30, now+=17, 60); rows.push(p.scale)
    for (let i=0;i<120;i++) p.sample(30, now+=17, 60)
    rows.push(p.scale) // Cooldown prevents rapid repeated allocations.
    now+=6000
    for (let i=0;i<120;i++) p.sample(30, now+=17, 60)
    rows.push(p.scale)
    now+=6000
    for (let i=0;i<359;i++) p.sample(5, now+=17, 60)
    rows.push(p.scale)
    p.sample(5, now+=17, 60); rows.push(p.scale)
    const eco = new AdaptiveResolution(), smooth = new AdaptiveResolution()
    eco.sample(20,0,30); smooth.sample(12,0,120)
    for(let i=0;i<120;i++){eco.sample(20,2000+i*34,30);smooth.sample(12,2000+i*9,120)}
    return {rows,eco:eco.scale,smooth:smooth.scale}
  })
  expect(result.rows).toEqual([1,1,.85,.85,.75,.75,.85])
  expect(result.eco).toBe(1); expect(result.smooth).toBe(.85)
})

test('GPU timing stays asynchronous, bounds pending queries and discards disjoint results', async ({page})=>{
  await probe(page)
  const result=await page.evaluate(async()=>{
    const {GpuFrameTimer}=await import('/src/features/spectrum/three/r3f/gpu-frame-timer.ts')
    let available=false,disjoint=false,created=0,deleted=0,reads=0
    const gl={QUERY_RESULT_AVAILABLE:1,QUERY_RESULT:2,CURRENT_QUERY:3,
      getExtension:()=>({TIME_ELAPSED_EXT:10,GPU_DISJOINT_EXT:11}),isContextLost:()=>false,
      getParameter:()=>disjoint,getQuery:()=>null,createQuery:()=>({id:++created}),beginQuery:()=>{},endQuery:()=>{},
      getQueryParameter:(_q:unknown,key:number)=>key===1?available:(reads++,25_000_000),deleteQuery:()=>{deleted++}}
    const timer=new GpuFrameTimer(gl as unknown as WebGL2RenderingContext)
    for(let i=0;i<12;i++){timer.begin();timer.end()}
    const waiting=timer.poll(),prematureReads=reads
    available=true;const sample=timer.poll()
    const revision=timer.revision
    disjoint=true;const invalid=timer.poll()
    const unavailable=new GpuFrameTimer({...gl,getExtension:()=>null} as unknown as WebGL2RenderingContext)
    unavailable.begin();unavailable.end();unavailable.discard()
    return {created,deleted,reads,waiting,prematureReads,sample,invalid,invalidated:timer.revision>revision,unsupported:unavailable.supported}
  })
  expect(result).toEqual({created:4,deleted:4,reads:1,waiting:undefined,prematureReads:0,sample:25,invalid:undefined,invalidated:true,unsupported:false})
})

test('occlusion stops presentation and RAF, then resumes the same scene without catching up', async ({page}) => {
  await probe(page)
  await page.evaluate(async () => {
    const {mountSceneResizeProbe}=await import('/tests/fixtures/scene-resize-probe.tsx')
    ;(window as any).probe=mountSceneResizeProbe(true,true)
  })
  const snapshot=()=>page.evaluate(()=>(window as any).probe.snapshot())
  await expect.poll(async()=>(await snapshot()).frames).toBeGreaterThan(4)
  await page.evaluate(()=>(window as any).probe.suspend(true))
  await expect.poll(()=>page.locator('canvas').getAttribute('data-occluded')).toBe('true')
  const before=await snapshot()
  const rafs=await page.evaluate(async()=>{
    const original=window.requestAnimationFrame; let calls=0
    window.requestAnimationFrame=cb=>{calls++;return original(cb)}
    await new Promise(r=>setTimeout(r,400))
    window.requestAnimationFrame=original
    return calls
  })
  expect(rafs).toBe(0)
  expect((await snapshot()).frames).toBe(before.frames)
  await page.evaluate(()=>(window as any).probe.suspend(false))
  await expect.poll(async()=>(await snapshot()).frames).toBeGreaterThan(before.frames)
  const after=await snapshot()
  expect(after.geometry).toEqual(before.geometry); expect(after.materials).toEqual(before.materials)
  expect(after.target).toBe(before.target)
  expect(after.phase).toBeGreaterThanOrEqual(before.phase)
  expect(after.phase-before.phase).toBeLessThan(.5)
  expect(after.error).toBe(0)
  expect(await page.evaluate(()=>(window as any).probe.dispose())).toEqual({geometries:0,textures:0})
})

test('DRS resizes visual FBOs while preserving the canvas, camera, programs and presentation output', async ({page}) => {
  await probe(page)
  const result=await page.evaluate(async()=>{
    const [{FiberSceneRenderer},{SceneMotion},{studySettings}]=await Promise.all([
      import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),import('/src/features/spectrum/three/motion.ts'),
      import('/src/features/spectrum/visual-study.ts')])
    const canvas=document.createElement('canvas');canvas.style.cssText='width:640px;height:360px';document.body.append(canvas)
    const world=new FiberSceneRenderer(canvas),motion=new SceneMotion(),config={...studySettings('aurora_flow','immersive'),quality:'eco' as const}
    // The policy is covered separately; control its output to exercise actual GPU targets.
    let targetScale=1
    const policy=(world as unknown as {resolution:{readonly scale:number}}).resolution
    Object.defineProperty(policy,'scale',{get:()=>targetScale})
    try {
      await world.resize(config,1,{adaptive:true})
      for(let i=0;i<90;i++)motion.step({rms:.15,bands:Array(6).fill(.5),spectrum:Array(48).fill(.5),skin:[]},1/60,config.music,false)
      const rows=[]
      for(const scale of [1,.85,.75,1]){
        targetScale=scale;world.draw(motion,config,false)
        const gl=world.renderer.getContext(),pixels=new Uint8Array(canvas.width*canvas.height*4)
        gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
        rows.push({canvas:[canvas.width,canvas.height],image:[world.image!.width,world.image!.height],target:world.image!.uuid,
          programs:world.renderer.info.programs?.length,camera:world.camera.uuid,alpha:pixels.filter((_,i)=>i%4===3&&pixels[i]>200).length,error:gl.getError()})
      }
      world.dispose();return {rows,memory:{...world.renderer.info.memory}}
    }finally{world.dispose();world.renderer.forceContextLoss();canvas.remove()}
  })
  expect(result.rows.map(r=>r.image)).toEqual([[640,360],[544,306],[480,270],[640,360]])
  for(const row of result.rows){expect(row.canvas).toEqual([640,360]);expect(row.target).toBe(result.rows[0].target);expect(row.camera).toBe(result.rows[0].camera);expect(row.programs).toBe(result.rows[0].programs);expect(row.alpha).toBeGreaterThan(640*360*.95);expect(row.error).toBe(0)}
  expect(result.memory).toEqual({geometries:0,textures:0})
})
