import { expect, test } from '@playwright/test'
import { butterflyWingGeometry } from '../src/features/spectrum/three/classic/immersive/butterfly-flock'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

test('butterfly wing tessellation keeps hinge triangles local without losing its silhouette',()=>{
  const geometry=butterflyWingGeometry(),p=geometry.getAttribute('position'),parts=geometry.getAttribute('aPart')
  let longest=0
  const areas=[0,0,0,0]
  for(let i=0;i<p.count;i+=3){
    const ax=p.getX(i),ay=p.getY(i),bx=p.getX(i+1),by=p.getY(i+1),cx=p.getX(i+2),cy=p.getY(i+2)
    longest=Math.max(longest,Math.hypot(ax-bx,ay-by),Math.hypot(bx-cx,by-cy),Math.hypot(cx-ax,cy-ay))
    areas[parts.getX(i)]+=Math.abs((bx-ax)*(cy-ay)-(by-ay)*(cx-ax))*.5
  }
  expect(longest).toBeLessThan(.52)
  expect(areas[0]).toBeGreaterThan(9);expect(areas[1]).toBeGreaterThan(4)
  expect(areas[0]).toBeCloseTo(areas[2],6);expect(areas[1]).toBeCloseTo(areas[3],6)
  geometry.dispose()
})

test('butterfly strong flapping remains finite through a complete wing cycle and resize',async({page})=>{
  test.setTimeout(90_000)
  await page.route('**/butterfly-wing-probe',r=>r.fulfill({contentType:'text/html',body:visualProbeHtml('<body></body>')}))
  await page.goto('/butterfly-wing-probe')
  const result=await page.evaluate(async()=>{
    const [T,{FiberSceneRenderer},{SceneMotion},{studySettings},{demoAnalysis}]=await Promise.all([
      import('/node_modules/.vite/deps/three.js'),import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),
      import('/src/features/spectrum/three/motion.ts'),import('/src/features/spectrum/visual-study.ts'),import('/src/features/spectrum/music-analysis.ts'),
    ])
    const canvas=document.createElement('canvas');canvas.style.cssText='width:320px;height:180px';document.body.append(canvas)
    const config=studySettings('butterfly_flock','daily');config.music.fieldHeight=1.6
    const world=new FiberSceneRenderer(canvas),motion=new SceneMotion(),target=new T.WebGLRenderTarget(320,180,{type:T.HalfFloatType})
    let invalid=0,negative=0,lit=0
    try{
      await world.resize(config,1)
      for(let frame=0;frame<120;frame++){
        motion.step(demoAnalysis(frame/30),1/30,config.music,false);world.draw(motion,config,false)
        if(frame%4)continue
        world.renderer.setRenderTarget(target);world.renderer.clear();world.renderer.render(world.scene,world.camera)
        const pixels=new Uint16Array(320*180*4);world.renderer.readRenderTargetPixels(target,0,0,320,180,pixels)
        for(const encoded of pixels){const n=T.DataUtils.fromHalfFloat(encoded);invalid+=Number(!Number.isFinite(n));negative+=Number(n<-.001);lit+=Number(n>.04)}
        world.renderer.setRenderTarget(null)
      }
      const shaders=world.renderer.info.programs!.length
      canvas.style.cssText='width:640px;height:360px';await world.resize(config,1);world.draw(motion,config,false)
      return {invalid,negative,lit,error:world.renderer.getContext().getError(),shaders,after:world.renderer.info.programs!.length}
    }finally{target.dispose();world.dispose();world.renderer.forceContextLoss();canvas.remove()}
  })
  expect(result).toMatchObject({invalid:0,negative:0,error:0});expect(result.lit).toBeGreaterThan(5000)
  expect(result.after).toBe(result.shaders)
})
