import { expect, test } from '@playwright/test'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', socket => {
    socket.send(JSON.stringify({ type: 'connected' })); socket.onMessage(() => {})
  })
  await page.route('**/desktop-visibility-test', route => route.fulfill({ contentType: 'text/html', body: visualProbeHtml('<body></body>') }))
  await page.goto('/desktop-visibility-test')
})

test('fine desktop effects remain visible on light, dark and mixed wallpaper at normal opacity', async ({ page }) => {
  test.setTimeout(120_000)
  const rows = await page.evaluate(async () => {
    const { renderVisualStudy, studySettings } = await import('/src/features/spectrum/visual-study.ts')
    const rows = []
    for (const effect of ['rhythm_balls','rhythm_rain','ripple','volume_rain','star_flight','cosmic_web','aurora_flow','tidal_knot','layered_tides'] as const) {
      const report = await renderVisualStudy(document.body, { ...studySettings(effect,'daily'), opacity:85 },
        { width:480, height:270, points:[{id:'sustain',time:5.2}] })
      const image = new Image(); image.src = report.frames[0].image; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height
      const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0)
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data
      const contrast=[0,0,0];let clear=0,maxAlpha=0
      for(let i=0;i<pixels.length;i+=4){
        const alpha=pixels[i+3]/255,x=(i/4)%canvas.width,y=Math.floor(i/4/canvas.width)
        if(alpha===0)clear++;maxAlpha=Math.max(maxAlpha,pixels[i+3])
        // Fixed high-frequency wallpaper bands cross the actual effect, so
        // visibility is checked on both bright and dark local backgrounds.
        const mix=(Math.sin(x*.055+y*.021)+Math.sin(y*.09))*.25+.5
        const backgrounds=[[230,226,216],[24,36,43],[32+mix*190,42+mix*160,60+mix*120]]
        backgrounds.forEach((bg,k)=>{
          contrast[k]+=Math.max(...bg.map((value,c)=>Math.abs(pixels[i+c]-value)))*alpha
        })
      }
      rows.push({effect,contrast:contrast.map(v=>v/(pixels.length/4)),clear:clear/(pixels.length/4),maxAlpha,
        errors:report.errors,remaining:report.remaining})
    }
    return rows
  })
  for(const row of rows){
    for(const contrast of row.contrast)expect(contrast,JSON.stringify(row)).toBeGreaterThan(.2)
    expect(row.clear,row.effect).toBeGreaterThan(.35)
    expect(row.maxAlpha,row.effect).toBeLessThanOrEqual(218)
    expect(row).toMatchObject({errors:[],remaining:{geometries:0,textures:0}})
  }
})

test('desktop contrast respects masks, opacity and lyric focus, and leaves empty geometry transparent', async ({page}) => {
  const result=await page.evaluate(async()=>{
    const [{FiberSceneRenderer},{SceneMotion},{studySettings},{demoAnalysis}]=await Promise.all([
      import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),import('/src/features/spectrum/three/motion.ts'),
      import('/src/features/spectrum/visual-study.ts'),import('/src/features/spectrum/music-analysis.ts')])
    const canvas=document.createElement('canvas');canvas.style.cssText='width:320px;height:180px';document.body.append(canvas)
    const world=new FiberSceneRenderer(canvas),motion=new SceneMotion(),config={...studySettings('cosmic_web','daily'),quality:'eco' as const}
    await world.resize(config,1)
    for(let i=0;i<90;i++){motion.step(demoAnalysis(i/30),1/30,config.music,false);world.draw(motion,config,false)}
    const gl=world.renderer.getContext(),read=()=>{
      const pixels=new Uint8Array(canvas.width*canvas.height*4)
      gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels
    }
    const original=read(),bounds={x:.2,y:.2,width:.6,height:.6}
    world.draw(motion,config,false,0,{bounds,lineKey:'lyric',revision:1,backgroundOpacity:100})
    const focused=read();let insideChanged=0,outsideChanged=0
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const i=(y*canvas.width+x)*4,delta=Math.max(...[0,1,2,3].map(c=>Math.abs(focused[i+c]-original[i+c])))
      if(delta){if(x/canvas.width>.16&&x/canvas.width<.84&&y/canvas.height>.16&&y/canvas.height<.84)insideChanged++;else outsideChanged++}
    }
    world.draw(motion,{...config,masks:[{id:'test',bounds,feather:0}]},false)
    const masked=read();let maskLeaks=0
    for(let y=Math.ceil(canvas.height*.21);y<canvas.height*.79;y++)for(let x=Math.ceil(canvas.width*.21);x<canvas.width*.79;x++)maskLeaks+=Number(masked[(y*canvas.width+x)*4+3]>0)
    world.draw(motion,{...config,opacity:0},false);const zero=read().some(v=>v!==0)
    world.scene.traverse((object:any)=>{if(object.isMesh||object.isPoints||object.isLine)object.visible=false})
    world.draw(motion,config,false);const empty=read().some(v=>v!==0),error=gl.getError()
    world.dispose();const remaining={...world.renderer.info.memory};world.renderer.forceContextLoss();canvas.remove()
    return {insideChanged,outsideChanged,maskLeaks,zero,empty,error,remaining}
  })
  expect(result.insideChanged).toBeGreaterThan(10)
  expect(result).toMatchObject({outsideChanged:0,maskLeaks:0,zero:false,empty:false,error:0,remaining:{geometries:0,textures:0}})
})
