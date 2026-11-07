import {test,expect} from '@playwright/test'
import {visualProbeHtml} from '../scripts/visual-probe-html.mjs'
import { compositionAudio } from '../src/features/spectrum/three/compositions/audio'
import { SceneMotion } from '../src/features/spectrum/three/motion'
import { compositionTime } from '../src/features/spectrum/three/compositions/clock'
import { compositionDrawingSize } from '../src/features/spectrum/three/compositions/render-budget'

test('composition transport never reverses under uneven frames, silence, speed and focus changes',()=>{
  const motion=new SceneMotion();motion.transporting=true
  let previous=0
  for(let i=0;i<240;i++){
    motion.stepIndex++;motion.stepSeconds=[1/120,1/60,.05,.1][i%4]
    motion.energy=(i%17)/17;motion.musicalBands[0]=(i%11)/11
    const reduced=i>=80&&i<100
    motion.transporting=!(i>=120&&i<145)
    const phase=compositionTime(motion,reduced,i%19<9,.5+(i%7)/2)
    expect(phase).toBeGreaterThanOrEqual(previous)
    if(reduced||!motion.transporting)expect(phase).toBe(previous)
    expect(compositionTime(motion,reduced)).toBe(phase)
    previous=phase
  }
  expect(compositionDrawingSize(2560,1440,1,'smooth',1)).toEqual({width:2560,height:1440})
  expect(compositionDrawingSize(3840,2160,1.5,'smooth',1)).toEqual({width:2560,height:1440})
})

test('onset fronts require audio events, advance once per step and clear for silence or reduced motion',()=>{
  const motion=new SceneMotion()
  motion.transporting=true;motion.stepSeconds=.1
  for(let i=0;i<40;i++){motion.stepIndex++;compositionAudio(motion,false)}
  expect(Array.from(compositionAudio(motion,false).waves).filter((_,i)=>i%2===1)).toEqual([0,0,0,0])
  motion.frame={onset:true} as any;motion.onsetStrength=.8;motion.stepIndex++
  const first=Array.from(compositionAudio(motion,false).waves)
  expect(first[1]).toBeCloseTo(.8)
  expect(Array.from(compositionAudio(motion,false).waves)).toEqual(first)
  motion.frame.onset=false;motion.stepIndex++
  expect(compositionAudio(motion,false).waves[0]).toBeCloseTo(.1)
  motion.stepIndex++;compositionAudio(motion,true)
  expect(Array.from(compositionAudio(motion,true).waves)).toEqual(Array(8).fill(0))
  motion.frame.onset=true;motion.stepIndex++;compositionAudio(motion,false)
  motion.transporting=false;motion.stepIndex++
  expect(Array.from(compositionAudio(motion,false).waves)).toEqual(Array(8).fill(0))
})

test('sustained deformation attacks quickly and returns without overshoot or a one-frame snap',()=>{
  const motion=new SceneMotion();motion.transporting=true;motion.stepSeconds=1/60
  motion.musicalBands.fill(.8)
  for(let i=0;i<6;i++){motion.stepIndex++;compositionAudio(motion,false)}
  let previous=compositionAudio(motion,false).bands[0]
  expect(previous).toBeGreaterThan(.7)
  motion.musicalBands.fill(0);motion.stepIndex++
  const firstRelease=compositionAudio(motion,false).bands[0]
  expect(firstRelease).toBeGreaterThan(previous*.9)
  for(let i=0;i<60;i++){
    motion.stepIndex++;const value=compositionAudio(motion,false).bands[0]
    expect(value).toBeLessThanOrEqual(previous);expect(value).toBeGreaterThanOrEqual(0);previous=value
  }
  expect(previous).toBeLessThan(.02)
})

test('production effect IDs match the lab and audio changes visible pixels at a fixed camera and phase',async({page})=>{
  await page.route('**/composition-audio',r=>r.fulfill({contentType:'text/html',body:visualProbeHtml('<body></body>')}))
  await page.goto('/composition-audio')
  const results=await page.evaluate(async()=>{
    const {CompositionStudy}=await import('/src/features/spectrum/three/compositions/study-session.ts')
    const results=[]
    for(const id of ['sculpture','expanse','passage'] as const){
      const canvas=document.createElement('canvas');canvas.style.cssText='width:320px;height:180px';document.body.append(canvas)
      const s=new CompositionStudy(canvas,id);await s.resize()
      for(let i=0;i<15;i++)s.step(.1)
      const shot=()=>{const gl=s.world.renderer.getContext(),p=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,p);return p}
      const lab=shot();s.world.setComposition();s.world.draw(s.motion,s.settings,false,0);const production=shot()
      // Hold transport at the same pose while giving the deformation envelope
      // time to settle. This isolates visible audio response from camera/motion.
      s.motion.transporting=false
      const settle=()=>{for(let i=0;i<12;i++){s.motion.stepIndex++;s.motion.stepSeconds=.05;s.world.draw(s.motion,s.settings,false,0)}}
      s.motion.frame!.onset=false;s.motion.musicalBands.fill(0);s.motion.accents.fill(0);settle();const quiet=shot()
      const root=s.world.scene.getObjectByName(`composition-${id}`)!,material=(root.children[0] as any).material
      const phase=material.uniforms.uTime.value,camera=s.world.camera.matrixWorld.elements.slice()
      s.motion.musicalBands.set([.8,.6,.5]);s.motion.accents.set([.65,.4,.5]);settle();const strong=shot()
      let changed=0,visible=0
      for(let i=0;i<quiet.length;i+=4){if(quiet[i]+quiet[i+1]+quiet[i+2]+strong[i]+strong[i+1]+strong[i+2]>12){visible++;if(Math.abs(quiet[i]-strong[i])+Math.abs(quiet[i+1]-strong[i+1])+Math.abs(quiet[i+2]-strong[i+2])>24)changed++}}
      results.push({id,parity:lab.every((v,i)=>v===production[i]),changed:changed/Math.max(1,visible),phaseStable:phase===material.uniforms.uTime.value,cameraStable:camera.every((v,i)=>v===s.world.camera.matrixWorld.elements[i]),errors:s.errors})
      s.dispose();s.world.renderer.forceContextLoss();canvas.remove()
    }
    return results
  })
  for(const result of results){expect(result,result.id).toMatchObject({parity:true,phaseStable:true,cameraStable:true,errors:[]});expect(result.changed,result.id).toBeGreaterThan(.18)}
})

test('main picker saves all three compositions with thumbnails and remembers each camera',async({page})=>{
  await page.goto('/')
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  const demo=page.getByRole('switch',{name:'模拟预览',exact:true})
  if(await demo.getAttribute('aria-checked')!=='true')await demo.click()
  let phase=0
  for(const [name,id] of [['潮汐之结','tidal_knot'],['层海','layered_tides'],['回声廊道','echo_corridor']]){
    await page.getByRole('button',{name:'更换灯效',exact:true}).click()
    const card=page.getByRole('dialog').getByRole('button',{name,exact:true})
    await expect.poll(()=>card.locator('img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true)
    await card.click()
    await expect.poll(saved).toMatchObject({effect:id,view:{yaw:0,pitch:0,distance:1}})
    const canvas=page.locator('.three-scene-surface canvas').first()
    await expect(canvas).toHaveAttribute('data-scene',id)
    if(phase===0)await canvas.evaluate(c=>{(window as any).__compositionCanvas=c})
    else expect(await canvas.evaluate(c=>c===(window as any).__compositionCanvas)).toBe(true)
    await expect.poll(()=>canvas.getAttribute('data-composition-time').then(Number)).toBeGreaterThan(phase)
    phase=Number(await canvas.getAttribute('data-composition-time'))
  }
  await expect(page.getByRole('button',{name:'恢复推荐构图'})).toHaveCount(0)
  await page.reload();await expect.poll(saved).toMatchObject({effect:'echo_corridor'})
  const history=await page.evaluate(async()=>{
    const {selectEffect}=await import('/src/features/settings/effect-memory.ts')
    const current=JSON.parse(localStorage.getItem('soundspectra.settings.v1')!)
    current.view={...current.view,yaw:31,distance:1.2}
    const next={...current,...selectEffect(current,'tidal_knot','camera-test')}
    return selectEffect(next,'echo_corridor','camera-test').view
  })
  expect(history).toMatchObject({yaw:31,distance:1.2})
})

test('compositions preserve paths through switching, freeze reduced motion, and release GPU resources',async({page})=>{
  await page.route('**/composition-probe',r=>r.fulfill({contentType:'text/html',body:visualProbeHtml('<body></body>')}))
  await page.goto('/composition-probe')
  const result=await page.evaluate(async()=>{
    const {CompositionStudy}=await import('/src/features/spectrum/three/compositions/study-session.ts')
    const c=document.createElement('canvas');c.style.cssText='width:480px;height:270px';document.body.append(c)
    const s=new CompositionStudy(c,'sculpture');await s.resize()
    const sample=()=>{
      const root=s.world.scene.getObjectByName(`composition-${s.id}`)!,material=(root.children[0] as any).material
      return {phase:material.uniforms.uTime.value,camera:s.world.camera.matrixWorld.elements.slice(),count:root.children.length,samples:s.world.image!.samples,calls:s.world.renderer.info.render.calls}
    }
    for(let i=0;i<90;i++)s.step(1/30)
    const first=sample();s.world.draw(s.motion,s.settings,false,1/30);const duplicate=sample()
    const switched=[]
    for(const id of ['expanse','passage','sculpture'] as const){await s.select(id);s.step(1/30);switched.push(sample())}
    const before=sample()
    s.world.draw(s.motion,s.settings,false,0,{bounds:{x:.1,y:.4,width:.4,height:.2},lineKey:'lyric',revision:1})
    const focused=sample();s.world.draw(s.motion,s.settings,false,0);const unfocused=sample()
    s.reduced=true;for(let i=0;i<30;i++)s.step(1/30);const reduced=sample()
    s.reduced=false;s.level='strong';for(let i=0;i<30;i++)s.step(1/30);const resumed=sample()
    const context=s.world.renderer.getContext(),gl=context.getError(),remaining=s.dispose()
    c.remove();return {first,duplicate,switched,before,focused,unfocused,reduced,resumed,remaining,gl,errors:s.errors}
  })
  expect(result.duplicate).toEqual(result.first)
  expect(result.switched.map(s=>s.count)).toEqual([2,6,2])
  expect(result.switched.map(s=>s.samples)).toEqual([0,2,0])
  // Every composition now includes the linear blend and final presentation passes.
  expect(result.switched.map(s=>s.calls)).toEqual([5,15,5])
  expect(result.focused.camera).toEqual(result.before.camera)
  expect(result.unfocused.camera).toEqual(result.before.camera)
  expect(result.switched.every(s=>s.phase>result.first.phase)).toBe(true)
  expect(result.reduced.phase).toBe(result.before.phase)
  expect(result.reduced.camera).toEqual(result.before.camera)
  expect(result.resumed.phase).toBeGreaterThan(result.reduced.phase)
  expect(result.remaining).toEqual({geometries:0,textures:0})
  expect(result.gl).toBe(0);expect(result.errors).toEqual([])
})

test('MSAA silhouettes stay finite in HDR and desktop keeps empty regions transparent',async({page})=>{
  await page.route('**/composition-hdr',r=>r.fulfill({contentType:'text/html',body:visualProbeHtml('<body></body>')}))
  await page.goto('/composition-hdr')
  const result=await page.evaluate(async()=>{
    const {CompositionStudy}=await import('/src/features/spectrum/three/compositions/study-session.ts')
    const T=await import('/node_modules/.vite/deps/three.js')
    const c=document.createElement('canvas');c.style.cssText='width:320px;height:180px';document.body.append(c)
    const s=new CompositionStudy(c,'passage');await s.resize();const peaks=[]
    for(let i=0;i<180;i++){
      s.step(.1)
      if(i%30===29){
        const image=s.world.image!,pixels=new Uint16Array(image.width*image.height*4)
        s.world.renderer.readRenderTargetPixels(image,0,0,image.width,image.height,pixels)
        let max=0,bad=0
        for(let j=0;j<pixels.length;j++){const v=T.DataUtils.fromHalfFloat(pixels[j]);if(!Number.isFinite(v))bad++;else max=Math.max(max,v)}
        peaks.push({max,bad})
      }
    }
    await s.select('sculpture');s.settings.sceneMode='daily';s.step(1/30)
    const gl=s.world.renderer.getContext(),pixels=new Uint8Array(c.width*c.height*4)
    gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
    let clear=0,visible=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i]===0)clear++;if(pixels[i]>8)visible++}
    const errors=s.errors;const remaining=s.dispose();c.remove()
    return {peaks,clear:clear/(pixels.length/4),visible:visible/(pixels.length/4),errors,remaining}
  })
  for(const p of result.peaks){expect(p.bad).toBe(0);expect(p.max).toBeLessThan(2)}
  expect(result.clear).toBeGreaterThan(.45);expect(result.visible).toBeGreaterThan(.03)
  expect(result.errors).toEqual([]);expect(result.remaining).toEqual({geometries:0,textures:0})
})

test('review page switches the three compositions and offers restrained reading controls',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/tools/composition-lab.html?scene=sculpture')
  await expect(page.locator('canvas')).toHaveAttribute('data-framework','r3f')
  for(const name of ['层海','回声廊道','潮汐之结']){
    await page.getByRole('button',{name:new RegExp(name)}).click()
    await expect(page.locator('#scene-title')).toContainText(name)
  }
  await page.locator('#mode').selectOption('daily')
  await page.getByLabel('阅读避让',{exact:true}).check()
  await page.getByLabel('减少动态',{exact:true}).check()
  await expect(page.locator('.reading')).toBeVisible()
  await expect(page.locator('canvas')).toHaveAttribute('data-focus',/width/)
  await page.getByRole('button',{name:'暂停画面'}).click()
  await expect(page.getByRole('button',{name:'继续画面'})).toBeVisible()
  for(const [name,effect] of [['层海','layered_tides'],['回声廊道','echo_corridor']]){
    await page.getByRole('button',{name:new RegExp(name)}).click()
    await expect(page.locator('canvas')).toHaveAttribute('data-scene',effect)
    await expect(page.locator('canvas')).toHaveAttribute('data-preparing','false')
  }
  expect(errors).toEqual([])
})
