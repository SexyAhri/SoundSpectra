import {expect,test} from '@playwright/test'
import {visualProbeHtml} from '../scripts/visual-probe-html.mjs'

test('authored material surfaces remain finite in HDR through edge-on views and strong music',async({page})=>{
  test.setTimeout(120_000)
  await page.route('**/material-surface-probe',r=>r.fulfill({contentType:'text/html',body:visualProbeHtml('<body></body>')}))
  await page.goto('/material-surface-probe')
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  const results=await page.evaluate(async()=>{
    const [T,{FiberSceneRenderer},{SceneMotion},{studySettings},{demoAnalysis}]=await Promise.all([
      import('/node_modules/.vite/deps/three.js'),import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),
      import('/src/features/spectrum/three/motion.ts'),import('/src/features/spectrum/visual-study.ts'),import('/src/features/spectrum/music-analysis.ts'),
    ])
    const results=[]
    for(const effect of ['rhythm_skin','petal_bloom','butterfly_flock','caustic_light','ginkgo_leaves','cosmic_web'] as const){
      const canvas=document.createElement('canvas');canvas.style.cssText='width:320px;height:180px';document.body.append(canvas)
      const world=new FiberSceneRenderer(canvas),motion=new SceneMotion(),config={...studySettings(effect,'immersive'),quality:'eco' as const}
      const source=new T.WebGLRenderTarget(320,180,{type:T.HalfFloatType})
      let invalid=0,negative=0,lit=0
      try{
        await world.resize(config,1)
        for(let i=0;i<120;i++){motion.step(demoAnalysis(i/30),1/30,config.music,false);world.draw(motion,config,false)}
        for(const [yaw,pitch] of [[0,0],[65,25],[-65,-25],[130,70]]){
          const view={...config,view:{...config.view,yaw,pitch}}
          world.draw(motion,view,false)
          world.renderer.setRenderTarget(source);world.renderer.clear();world.renderer.render(world.scene,world.camera)
          const pixels=new Uint16Array(320*180*4)
          world.renderer.readRenderTargetPixels(source,0,0,320,180,pixels)
          for(let i=0;i<pixels.length;i++){
            const value=T.DataUtils.fromHalfFloat(pixels[i])
            invalid+=Number(!Number.isFinite(value));negative+=Number(value<-.001)
            if(i%4!==3)lit+=Number(value>.02)
          }
          world.renderer.setRenderTarget(null)
        }
        const error=world.renderer.getContext().getError()
        source.dispose();world.dispose()
        results.push({effect,invalid,negative,lit,error,remaining:{...world.renderer.info.memory}})
      }finally{source.dispose();world.dispose();world.renderer.forceContextLoss();canvas.remove()}
    }
    return results
  })
  for(const row of results){expect(row,row.effect).toMatchObject({invalid:0,negative:0,error:0,remaining:{geometries:0,textures:0}});expect(row.lit,row.effect).toBeGreaterThan(100)}
  expect(errors).toEqual([])
})
