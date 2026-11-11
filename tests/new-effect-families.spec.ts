import { chooseStyle } from './helpers/module-settings'
import { settingsSection } from './helpers/module-settings'
import { expect, test } from '@playwright/test'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

const additions=[['butterfly_flock','风栖蝶群'],['caustic_light','水光焦散'],['ginkgo_leaves','秋光银杏'],['window_rain','窗前听雨'],['cosmic_web','星脉旷野']] as const

test('new effects can be selected, tuned independently, reloaded and exported with their thumbnails',async({page})=>{
  test.setTimeout(60_000)
  await page.addInitScript(()=>{if(!sessionStorage.getItem('new-effects-initialized')){localStorage.clear();sessionStorage.setItem('new-effects-initialized','1')}})
  await page.goto('/#scene')
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
  const sensitivities:number[]=[]
  for(const [effect,label] of additions){
    await chooseStyle(page, '灯效', label)
    const current=page.getByRole('group',{name:'当前灯效',exact:true})
    await expect(current).toContainText(label)
    const image=current.locator('img')
    await expect.poll(()=>image.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true)
    await expect(page.locator('.three-scene-surface canvas').first()).toHaveAttribute('data-scene',effect)
    await settingsSection(page, '动效')
    await expect.poll(async()=>(await saved()).effect).toBe(effect)
    const previous=(await saved()).music.sensitivity
    const slider=page.getByRole('slider',{name:'音乐参与度',exact:true})
    await slider.focus();await page.keyboard.press('ArrowRight')
    await expect.poll(async()=>(await saved()).music.sensitivity).toBeGreaterThan(previous)
    sensitivities.push((await saved()).music.sensitivity)
    await settingsSection(page, '动效')
  }
  // Clear only once: the settings and per-effect appearances must survive reload.
  const persisted=await page.evaluate(()=>JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
  expect(persisted.effect).toBe('cosmic_web')
  await page.reload()
  await expect(page.getByRole('group', { name: '当前灯效', exact: true })).toContainText('星脉旷野')
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('soundspectra.settings.v1')!).music)).toEqual(persisted.music)
  for(let i=0;i<additions.length;i++){
    await chooseStyle(page, '灯效', additions[i][1])
    await expect.poll(saved).toMatchObject({effect:additions[i][0],music:{sensitivity:sensitivities[i]}})
  }
  // The settings helpers validate both the main effect and an additional region.
  const roundTrips=await page.evaluate(async additions=>{
    const [{defaults,normalizeSettings},{recommendedMusic},{layout,sceneDocument,importScene}]=await Promise.all([
      import('/src/features/spectrum/model.ts'),import('/src/features/spectrum/effect-presets.ts'),import('/src/features/preview/scene-library.ts'),
    ])
    return additions.map(([effect])=>{
      const config=normalizeSettings({...defaults,effect,music:recommendedMusic(effect),regions:[{...layout(defaults),id:'new',name:'新增',visible:true,effect,music:recommendedMusic(effect)}]})
      const exported=importScene(sceneDocument({name:effect,scene:layout(config)})).scene
      return {effect:exported.effect,region:exported.regions[0].effect,music:exported.music}
    })
  },additions)
  for(let i=0;i<additions.length;i++)expect(roundTrips[i]).toMatchObject({effect:additions[i][0],region:additions[i][0]})
})

test('each new family responds locally to frequency content and keeps bounded geometry and silent transport',async({page})=>{
  test.setTimeout(90_000)
  await page.route('**/new-family-probe',r=>r.fulfill({contentType:'text/html',body:visualProbeHtml('<body></body>')}))
  await page.goto('/new-family-probe')
  const errors:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('WebSocket')&&!m.text().includes('[vite]')&&!m.text().startsWith('Failed to send error to Vite server:'))errors.push(m.text())})
  const rows=await page.evaluate(async additions=>{
    const [{FiberSceneRenderer},{SceneMotion},{studySettings}]=await Promise.all([
      import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),import('/src/features/spectrum/three/motion.ts'),import('/src/features/spectrum/visual-study.ts'),
    ])
    const rows=[]
    for(const [effect] of additions){
      const c=document.createElement('canvas');c.style.cssText='width:320px;height:180px';document.body.append(c)
      const world=new FiberSceneRenderer(c),config={...studySettings(effect,'daily'),quality:'eco' as const}
      try{
        await world.resize(config,1)
        const source=(high:boolean,silent=false)=>({rms:silent?0:.16,bands:silent?Array(6).fill(0):high?[.02,.03,.1,.2,.7,.8]:[.8,.7,.2,.1,.03,.02],
          spectrum:Array(48).fill(silent?0:.3),skin:[]})
        const render=(high:boolean)=>{
          const motion=new SceneMotion()
          for(let i=0;i<90;i++){motion.step(source(high),1/30,config.music,false);world.draw(motion,config,false)}
          return {motion,image:c.toDataURL()}
        }
        const low=render(false),high=render(true)
        world.draw(high.motion,config,false);const repeat=c.toDataURL()
        const draws=world.renderer.info.render.calls,triangles=world.renderer.info.render.triangles
        // Let responses settle; a silent input must not keep advancing transport.
        for(let i=0;i<150;i++){high.motion.step(source(false,true),1/30,config.music,false);world.draw(high.motion,config,false)}
        const phases=()=>{const values:number[]=[];world.scene.traverse((o:any)=>{const phase=o.material?.uniforms?.uPhase?.value;if(typeof phase==='number')values.push(phase)});return values}
        const before=phases()
        for(let i=0;i<30;i++){high.motion.step(source(false,true),1/30,config.music,false);world.draw(high.motion,config,false)}
        const after=phases(),glError=world.renderer.getContext().getError()
        world.dispose()
        rows.push({effect,frequencyChanged:low.image!==high.image,stable:repeat===high.image,draws,triangles,before,after,glError,remaining:{...world.renderer.info.memory}})
      }finally{world.dispose();world.renderer.forceContextLoss();c.remove()}
    }
    return rows
  },additions)
  for(const row of rows){
    expect(row,row.effect).toMatchObject({frequencyChanged:true,stable:true,glError:0,remaining:{geometries:0,textures:0}})
    expect(row.after,row.effect).toEqual(row.before)
    expect(row.before.length,row.effect).toBeGreaterThan(0)
    expect(row.draws,row.effect).toBeLessThan(35)
    expect(row.triangles,row.effect).toBeLessThan(100_000)
  }
  expect(errors).toEqual([])
})

test('refined effects keep finite HDR pixels, transparent desktop space and shader programs across resize',async({page})=>{
  test.setTimeout(90_000)
  await page.route('**/daylight-glass-probe',route=>route.fulfill({contentType:'text/html',body:visualProbeHtml('<body></body>')}))
  await page.goto('/daylight-glass-probe')
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  const results=await page.evaluate(async()=>{
    const [T,{FiberSceneRenderer},{SceneMotion},{studySettings},{demoAnalysis},{musicEffects}]=await Promise.all([
      import('/node_modules/.vite/deps/three.js'),import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),
      import('/src/features/spectrum/three/motion.ts'),import('/src/features/spectrum/visual-study.ts'),import('/src/features/spectrum/music-analysis.ts'),
      import('/src/features/spectrum/music-engine/catalog.ts'),
    ])
    const results=[]
    for(const {value:effect} of musicEffects){
      const canvas=document.createElement('canvas');canvas.style.cssText='width:320px;height:180px';document.body.append(canvas)
      const world=new FiberSceneRenderer(canvas),motion=new SceneMotion(),config={...studySettings(effect,'immersive'),quality:'eco' as const}
      try{
        await world.resize(config,1)
        for(let i=0;i<30;i++){motion.step(demoAnalysis(i/15),1/30,config.music,false);world.draw(motion,config,false)}
        let invalid=0
        for(const sceneMode of ['immersive','daily'] as const){
          world.draw(motion,{...config,sceneMode},false)
          const target=world.diagnostics.image!
          if(target.texture.type===T.HalfFloatType){
            const pixels=new Uint16Array(target.width*target.height*4)
            world.renderer.readRenderTargetPixels(target,0,0,target.width,target.height,pixels)
            for(const encoded of pixels)if(!Number.isFinite(T.DataUtils.fromHalfFloat(encoded)))invalid++
          }
        }
        const gl=world.renderer.getContext(),pixels=new Uint8Array(canvas.width*canvas.height*4)
        gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
        let empty=0,visible=0
        for(let i=3;i<pixels.length;i+=4){empty+=Number(pixels[i]<8);visible+=Number(pixels[i]>8)}
        const programs=world.renderer.info.programs!.length
        canvas.style.cssText='width:640px;height:360px';await world.resize(config,1)
        world.draw(motion,config,false)
        results.push({effect,invalid,empty:empty/(pixels.length/4),visible,programs,reused:world.renderer.info.programs!.length===programs,glError:gl.getError()})
      }finally{world.dispose();world.renderer.forceContextLoss();canvas.remove()}
    }
    return results
  })
  for(const row of results){
    expect(row,row.effect).toMatchObject({invalid:0,reused:true,glError:0})
    expect(row.empty,row.effect).toBeGreaterThan(.15)
    expect(row.visible,row.effect).toBeGreaterThan(20)
  }
  expect(errors).toEqual([])
})

test('rain glass retains water coverage when orbiting and does not rebuild shaders',async({page})=>{
  await page.route('**/glass-orbit-probe',route=>route.fulfill({contentType:'text/html',body:visualProbeHtml('<body></body>')}))
  await page.goto('/glass-orbit-probe')
  const rows=await page.evaluate(async()=>{
    const [{FiberSceneRenderer},{SceneMotion},{studySettings},{demoAnalysis}]=await Promise.all([
      import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),import('/src/features/spectrum/three/motion.ts'),
      import('/src/features/spectrum/visual-study.ts'),import('/src/features/spectrum/music-analysis.ts'),
    ])
    const canvas=document.createElement('canvas');canvas.style.cssText='width:480px;height:270px';document.body.append(canvas)
    const errors:string[]=[],world=new FiberSceneRenderer(canvas,error=>errors.push(String(error)))
    const config=studySettings('window_rain','daily'),motion=new SceneMotion()
    try{
      await world.resize(config,1)
      for(let i=0;i<60;i++){motion.step(demoAnalysis(i/30),1/30,config.music,false);world.draw(motion,config,false)}
      const programs=world.renderer.info.programs!.length,rows=[]
      for(const [yaw,pitch,roll] of [[0,0,0],[90,0,0],[-90,55,25],[180,-40,-30]]){
        const rotated={...config,view:{...config.view,yaw,pitch,roll}}
        world.draw(motion,rotated,false)
        const gl=world.renderer.getContext(),pixels=new Uint8Array(canvas.width*canvas.height*4)
        gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
        let visible=0
        for(let i=3;i<pixels.length;i+=4)visible+=Number(pixels[i]>12)
        const original=canvas.toDataURL();world.draw(motion,rotated,false)
        rows.push({visible,reused:world.renderer.info.programs!.length===programs,stable:original===canvas.toDataURL(),error:gl.getError()})
      }
      return {rows,errors}
    }finally{world.dispose();world.renderer.forceContextLoss();canvas.remove()}
  })
  expect(rows.errors).toEqual([])
  const initial=rows.rows[0].visible
  expect(initial).toBeGreaterThan(200)
  for(const row of rows.rows){
    expect(row).toMatchObject({reused:true,stable:true,error:0})
    expect(row.visible/initial).toBeGreaterThan(.8)
    expect(row.visible/initial).toBeLessThan(1.2)
  }
})
