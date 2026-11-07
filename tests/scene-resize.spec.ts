import { expect, test } from '@playwright/test'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

test('parent resize fills every quadrant without pinning the canvas to its initial CSS size', async ({ page }) => {
  await page.route('**/resize-scene-probe', route => route.fulfill({ contentType:'text/html',body:visualProbeHtml('<body style="margin:0"></body><style>canvas{width:100%;height:100%;display:block}</style>') }))
  await page.goto('/resize-scene-probe')
  const results=await page.evaluate(async()=>{
    const [{FiberSceneRenderer},{SceneMotion},{studySettings}]=await Promise.all([import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),import('/src/features/spectrum/three/motion.ts'),import('/src/features/spectrum/visual-study.ts')])
    const host=document.createElement('div'),canvas=document.createElement('canvas');document.body.append(host);host.append(canvas)
    host.style.cssText='width:320px;height:180px'
    const world=new FiberSceneRenderer(canvas),motion=new SceneMotion(),config={...studySettings('aurora_flow','immersive'),quality:'eco' as const},rows=[]
    try{
      for(let i=0;i<90;i++)motion.step({rms:.15,bands:Array(6).fill(.5),spectrum:Array(48).fill(.5),skin:[]},1/60,config.music,false)
      for(const [width,height] of [[320,180],[640,360],[420,236],[640,360]]){
        host.style.width=width+'px';host.style.height=height+'px'
        await world.resize(config,1)
        motion.step({rms:.15,bands:Array(6).fill(.5),spectrum:Array(48).fill(.5),skin:[]},1/30,config.music,false)
        world.draw(motion,config,false)
        const gl=world.renderer.getContext(),pixels=new Uint8Array(canvas.width*canvas.height*4),quarters=[0,0,0,0]
        gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
        for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4+3]>200)quarters[Number(x>=canvas.width/2)+2*Number(y>=canvas.height/2)]++
        rows.push({width,height,css:[canvas.clientWidth,canvas.clientHeight],buffer:[canvas.width,canvas.height],quarters,error:gl.getError()})
      }
      return rows
    }finally{world.dispose();world.renderer.forceContextLoss();host.remove()}
  })
  for(const row of results){
    expect(row.css,JSON.stringify(row)).toEqual([row.width,row.height]);expect(row.buffer).toEqual([row.width,row.height])
    expect(row.quarters.every(n=>n>row.width*row.height*.24),JSON.stringify(row)).toBe(true);expect(row.error).toBe(0)
  }
})

test('automatic resizing coalesces a maximize burst, retains GPU layers and redraws a silent scene', async ({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/automatic-resize-probe',route=>route.fulfill({contentType:'text/html',body:visualProbeHtml('<body style="margin:0"></body><style>.spectrum-surface,canvas{width:100%;height:100%;display:block}</style>')}))
  await page.goto('/automatic-resize-probe')
  await page.evaluate(async()=>{
    const {mountSceneResizeProbe}=await import('/tests/fixtures/scene-resize-probe.tsx')
    ;(window as any).resizeProbe=mountSceneResizeProbe()
  })
  const snapshot=()=>page.evaluate(()=>(window as any).resizeProbe.snapshot())
  await expect.poll(async()=> (await snapshot()).buffer).toEqual([320,180])
  await page.waitForTimeout(350)
  const before=await snapshot()
  for(const sizes of [[[420,236],[510,287],[580,326],[640,360]],[[600,338],[480,270],[320,180]]]){
    await page.evaluate(async sizes=>{
      for(const [width,height] of sizes){(window as any).resizeProbe.resize(width,height);await new Promise(requestAnimationFrame)}
    },sizes)
    await expect.poll(async()=> (await snapshot()).buffer).toEqual(sizes.at(-1))
    await page.waitForTimeout(250)
  }
  const after=await snapshot()
  expect(after.resizes-before.resizes).toBe(2)
  expect(after.bufferWrites-before.bufferWrites).toBe(4)
  expect(after.css).toEqual([320,180]);expect(after.frames).toBeGreaterThan(before.frames)
  expect(after.geometry).toEqual(before.geometry);expect(after.materials).toEqual(before.materials)
  expect(after.target).toBe(before.target);expect(after.memory).toEqual(before.memory);expect(after.error).toBe(0)
  await page.waitForTimeout(350)
  expect((await snapshot()).frames).toBe(after.frames)
  expect(await page.evaluate(()=>(window as any).resizeProbe.dispose())).toEqual({geometries:0,textures:0})
  expect(errors).toEqual([])
})

test('native resize holds GPU presentation while audio motion advances, then resumes the same scene', async ({page})=>{
  await page.route('**/native-settling-probe',route=>route.fulfill({contentType:'text/html',body:visualProbeHtml('<body style="margin:0"></body><style>.spectrum-surface,canvas{width:100%;height:100%;display:block}</style>')}))
  await page.goto('/native-settling-probe')
  await page.evaluate(async()=>{
    const {mountSceneResizeProbe}=await import('/tests/fixtures/scene-resize-probe.tsx')
    ;(window as any).resizeProbe=mountSceneResizeProbe(true)
  })
  const snapshot=()=>page.evaluate(()=>(window as any).resizeProbe.snapshot())
  await expect.poll(async()=> (await snapshot()).frames).toBeGreaterThan(2)
  await page.evaluate(async()=>{
    const {withPreviewResize}=await import('/src/features/preview/resize-settling.ts')
    ;(window as any).nativeResizeDone=withPreviewResize(()=>new Promise<void>(resolve=>{(window as any).releaseNativeResize=resolve}))
  })
  await expect.poll(async()=> (await snapshot()).paused).toBe('true')
  const held=await snapshot()
  await page.waitForTimeout(250)
  const moving=await snapshot()
  expect(moving.frames).toBe(held.frames)
  expect(moving.phase).toBeGreaterThan(held.phase)
  await page.evaluate(async()=>{
    ;(window as any).resizeProbe.resize(640,360)
    dispatchEvent(new Event('resize'))
    ;(window as any).releaseNativeResize()
    await (window as any).nativeResizeDone
  })
  await expect.poll(async()=> (await snapshot()).paused).toBe('false')
  await expect.poll(async()=> (await snapshot()).frames).toBeGreaterThan(held.frames)
  await expect.poll(async()=> (await snapshot()).buffer).toEqual([640,360])
  const resumed=await snapshot()
  expect(resumed.buffer).toEqual([640,360])
  expect(resumed.geometry).toEqual(held.geometry);expect(resumed.materials).toEqual(held.materials)
  expect(resumed.target).toBe(held.target);expect(resumed.phase).toBeGreaterThan(moving.phase)
  expect(resumed.error).toBe(0)
  expect(await page.evaluate(()=>(window as any).resizeProbe.dispose())).toEqual({geometries:0,textures:0})
})
