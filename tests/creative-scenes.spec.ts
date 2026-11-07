import { expect, test } from '@playwright/test'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'
import { effectDefinitions, applyArt } from '../src/features/spectrum/effect-definitions'
import { musicEffects } from '../src/features/spectrum/music-engine/catalog'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

test('all eleven authoring definitions map art controls into compatible existing settings',()=>{
  expect(Object.keys(effectDefinitions)).toHaveLength(11)
  for(const {value:effect} of musicEffects){
    const definition=effectDefinitions[effect]
    expect(definition.rules).toHaveLength(4)
    expect(new Set(definition.art.map(control=>control.id)).size).toBe(4)
    for(const control of definition.art)for(const amount of [0,50,100]){
      const music=applyArt(control,amount,definition.defaults)
      expect(normalizeSettings({...defaults,effect,music}).music).toEqual(music)
      const touched=new Set(control.channels.map(([key])=>key))
      for(const key of Object.keys(music) as (keyof typeof music)[])
        if(!touched.has(key as any))expect(music[key]).toBe(definition.defaults[key])
    }
  }
})

test('art controls persist through the old schema and resetting jellyfish preserves unrelated effect fields',async({page})=>{
  const initial={...structuredClone(defaults),music:{...defaults.music,dragonWidth:1.9,meteorDensity:91}}
  await page.addInitScript(value=>{if(!localStorage.getItem('soundspectra.settings.v1'))localStorage.setItem('soundspectra.settings.v1',JSON.stringify(value))},initial)
  await page.goto('/')
  await page.getByRole('tab',{name:'外观',exact:true}).click()
  await expect(page.getByRole('slider',{name:'漂游速度',exact:true})).toHaveCount(0)
  await page.getByRole('slider',{name:'深水空间',exact:true}).press('Home')
  await page.getByRole('slider',{name:'音乐参与度',exact:true}).press('Home')
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
  await expect.poll(saved).toMatchObject({effect:'rhythm_balls',music:{fieldScale:1.65,ambientSpread:.65,sensitivity:.5,dragonWidth:1.9,meteorDensity:91}})
  await page.screenshot({path:'artifacts/visual-studies/art-controls.png'})
  await page.reload();await page.getByRole('tab',{name:'外观',exact:true}).click()
  await expect(page.getByRole('slider',{name:'深水空间',exact:true})).toHaveAttribute('aria-valuenow','0')
  await page.getByRole('button',{name:'恢复当前灯效参数',exact:true}).click()
  await expect.poll(saved).toMatchObject({effect:'rhythm_balls',music:{sensitivity:1,dragonWidth:1.9,meteorDensity:91}})
})

test('fixed packet replay reproduces geometry and silence; desktop composition changes coverage',async({page})=>{
  test.setTimeout(240000)
  await page.goto('/tools/visual-lab.html')
  const results=await page.evaluate(async()=>{
    const {renderVisualStudy,studySettings}=await import('/src/features/spectrum/visual-study.ts')
    const results=[]
    for(const effect of ['rhythm_balls','rhythm_skin','sound_field'] as const){
      const config={...studySettings(effect,'daily'),quality:'eco' as const}
      const options={width:192,height:108,points:[{id:'sustain',time:5.2},{id:'silence',time:15.8}]}
      const a=await renderVisualStudy(document.body,config,options)
      const b=await renderVisualStudy(document.body,config,options)
      const immersive=await renderVisualStudy(document.body,{...config,sceneMode:'immersive'},options)
      const reduced=await renderVisualStudy(document.body,config,{...options,reduced:true})
      results.push({effect,a,b,immersive,reduced})
    }
    return results.map(({effect,a,b,immersive,reduced})=>({effect,hashes:a.frames.map(f=>f.hash),repeat:b.frames.map(f=>f.hash),
      dailyCenter:a.frames[0].centerCoverage,immersiveCenter:immersive.frames[0].centerCoverage,
      silence:[a,b,immersive,reduced].map(r=>r.frames[1].coverage),remaining:[a,b,immersive,reduced].map(r=>r.remaining),
      errors:[...a.errors,...b.errors,...immersive.errors,...reduced.errors]}))
  })
  for(const result of results){
    expect(result.hashes,result.effect).toEqual(result.repeat)
    expect(result.dailyCenter,result.effect).toBeLessThan(result.immersiveCenter)
    expect(result.silence).toEqual([0,0,0,0])
    expect(result.remaining).toEqual(Array(4).fill({geometries:0,textures:0}))
    expect(result.errors).toEqual([])
  }
})

test('desktop galaxy leaves wallpaper visible beyond the authored gas band',async({page})=>{
  await page.goto('/tools/visual-lab.html')
  const report=await page.evaluate(async()=>{
    const {renderVisualStudy,studySettings}=await import('/src/features/spectrum/visual-study.ts')
    return renderVisualStudy(document.body,{...studySettings('dream_stars','daily'),quality:'eco'},
      {width:320,height:180,points:[{id:'sustain',time:5.2}]})
  })
  expect(report.frames[0].coverage).toBeGreaterThan(.1)
  expect(report.frames[0].coverage).toBeLessThan(.65)
  expect(report.errors).toEqual([]);expect(report.remaining).toEqual({geometries:0,textures:0})
})

test('lyric focus only changes its local pixels, repeats exactly, and suppresses cues for reduced motion or silence',async({page})=>{
  await page.route('**/creative-focus-probe',route=>route.fulfill({contentType:'text/html',body:visualProbeHtml('<body></body>')}))
  await page.goto('/creative-focus-probe')
  const result=await page.evaluate(async()=>{
    const [{FiberSceneRenderer},{SceneMotion},{studySettings},{demoAnalysis}]=await Promise.all([
      import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),import('/src/features/spectrum/three/motion.ts'),
      import('/src/features/spectrum/visual-study.ts'),import('/src/features/spectrum/music-analysis.ts')])
    const canvas=document.createElement('canvas');canvas.style.cssText='width:320px;height:180px';document.body.append(canvas)
    const world=new FiberSceneRenderer(canvas),motion=new SceneMotion()
    const config={...studySettings('rhythm_skin','immersive'),quality:'eco' as const,bounds:{x:.1,y:.1,width:.8,height:.8}}
    const bounds={x:.25,y:.3,width:.3,height:.25}
    await world.resize(config,1)
    for(let i=0;i<90;i++){motion.step(demoAnalysis(i/30),1/30,config.music,false);world.draw(motion,config,false)}
    const gl=world.renderer.getContext(),read=()=>{const p=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,p);return p}
    const original=read()
    const focus={bounds,lineKey:'first',revision:1}
    world.draw(motion,config,false,1/30,focus);const focused=read()
    let inside=0,outside=0
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const i=(y*canvas.width+x)*4,delta=Math.max(...[0,1,2,3].map(c=>Math.abs(original[i+c]-focused[i+c])))
      const px=.1+x/canvas.width*.8,py=.1+(1-y/canvas.height)*.8
      const local=px>=bounds.x-.04&&px<=bounds.x+bounds.width+.04&&py>=bounds.y-.04&&py<=bounds.y+bounds.height+.04
      if(delta>0){if(local)inside++;else outside++}
    }
    world.draw(motion,config,false,1/30,{...focus,lineKey:'second',revision:2});const cue=Number(canvas.dataset.focusCue),cuePixels=read()
    world.draw(motion,config,false,1/30,{...focus,lineKey:'second',revision:2});const repeat=read()
    world.draw(motion,config,true,1/30,{...focus,lineKey:'third',revision:3});const reduced=Number(canvas.dataset.focusCue)
    motion.step({rms:0,bands:Array(6).fill(0),spectrum:Array(48).fill(0),skin:[]},1/60,config.music,false)
    world.draw(motion,config,false,1/60,{...focus,lineKey:'tail',revision:4});const zeroRms=Number(canvas.dataset.focusCue)
    motion.frame={...motion.frame!,audible:false}
    world.draw(motion,config,false,1/30,{...focus,lineKey:'fourth',revision:5});const silent=Number(canvas.dataset.focusCue)
    world.draw(motion,config,false,1/30);const cleared=canvas.dataset.focus
    world.dispose();world.renderer.forceContextLoss();canvas.remove()
    return {inside,outside,cue,stable:cuePixels.every((v,i)=>v===repeat[i]),reduced,zeroRms,silent,cleared,remaining:{...world.renderer.info.memory}}
  })
  expect(result.inside).toBeGreaterThan(50);expect(result.outside).toBe(0)
  expect(result.cue).toBeGreaterThan(0);expect(result.stable).toBe(true)
  expect(result.reduced).toBe(0);expect(result.zeroRms).toBe(0);expect(result.silent).toBe(0);expect(result.cleared).toBe('')
  expect(result.remaining).toEqual({geometries:0,textures:0})
})

test('readable lyrics publish actual placement and clear when simulated playback ends',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'歌词',exact:true}).click()
  await page.getByRole('switch',{name:'显示桌面歌词',exact:true}).click()
  const canvas=page.locator('.preview-spectrum canvas').first(),layer=page.getByTestId('lyric-layer')
  await expect(canvas).toHaveAttribute('data-focus',/^\{/)
  const placement=await layer.evaluate(node=>({x:parseFloat(node.style.left)/100,y:parseFloat(node.style.top)/100,width:parseFloat(node.style.width)/100,height:parseFloat(node.style.height)/100}))
  expect(JSON.parse((await canvas.getAttribute('data-focus'))!)).toEqual(placement)
  await page.locator('.desktop-preview').screenshot({path:'artifacts/visual-studies/lyrics-focus.png'})
  await page.emulateMedia({reducedMotion:'reduce'})
  await expect(canvas).toHaveAttribute('data-focus-cue','0.0000')
  await page.getByRole('switch',{name:'模拟预览',exact:true}).click()
  await expect(canvas).toHaveAttribute('data-focus','')
  await expect(layer.locator('.kinetic-lyrics-canvas')).toHaveCount(0)
})

test('two scene providers keep lyric bounds isolated and unmount removes focus',async({page})=>{
  await page.route('**/focus-context-probe',route=>route.fulfill({contentType:'text/html',body:visualProbeHtml('<body></body>')}))
  await page.goto('/focus-context-probe')
  const result=await page.evaluate(async()=>{
    const {mountSceneFocusProbe}=await import('/tests/fixtures/scene-focus-probe.tsx')
    const probe=mountSceneFocusProbe(),first=probe.read()
    probe.render(true,'two');const changed=probe.read()
    probe.render(false);const hidden=probe.read();probe.dispose()
    return {first,changed,hidden}
  })
  expect(result.first[0].lineKey).toBe('one');expect(result.changed[0].lineKey).toBe('two')
  expect(result.hidden[0].bounds).toBeNull()
  expect(result.hidden[0].revision).toBeGreaterThan(result.first[0].revision)
  for(const state of Object.values(result))expect(state[1]).toEqual({bounds:null,lineKey:null,revision:0})
})
