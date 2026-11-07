import { chooseStyle } from './helpers/module-settings'
import { settingsSection } from './helpers/module-settings'
import { expect, test } from '@playwright/test'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

const additions=[['butterfly_flock','风栖蝶群'],['caustic_light','水光焦散'],['ginkgo_leaves','秋光银杏'],['cosmic_web','星脉旷野']] as const

test('new effects can be selected, tuned independently, reloaded and exported with their thumbnails',async({page})=>{
  test.setTimeout(60_000)
  await page.addInitScript(()=>{if(!sessionStorage.getItem('new-effects-initialized')){localStorage.clear();sessionStorage.setItem('new-effects-initialized','1')}})
  await page.goto('/')
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
  page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('WebSocket')&&!m.text().includes('[vite]'))errors.push(m.text())})
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
