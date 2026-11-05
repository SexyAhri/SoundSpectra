import { expect, test, type Page } from '@playwright/test'
import { SceneMotion } from '../src/features/spectrum/three/motion'
import { defaultMusicSettings } from '../src/features/spectrum/music-engine/catalog'
import { silentAnalysis } from '../src/features/spectrum/music-analysis'
import { touchEnergy } from '../src/features/spectrum/three/classic/kinetic/common'
import { commonUniforms, flowDriver } from '../src/features/spectrum/three/classic/flow/shared'
import { defaults } from '../src/features/spectrum/model'
import { createNightLake } from '../src/features/spectrum/three/classic/immersive/night-lake'

async function isolatedPage(page: Page) {
  await page.route('**/scene-lifecycle-probe', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><body style="margin:0"></body></html>' }))
  await page.goto('/scene-lifecycle-probe')
}

test('lake music waves fade while frozen and pointer rings do not restart when reduced motion ends', () => {
  const effect=createNightLake(.5),motion=new SceneMotion()
  const settings={...defaults,effect:'water_ripple' as const}
  const drops=effect.group.children.map(object=>(object as any).material?.uniforms?.uDrops).find(Boolean)!.value
  const audio={rms:.18,bands:Array(6).fill(.5),spectrum:Array(48).fill(.5),skin:[]}
  try {
    for(let frame=0;frame<6;frame++)motion.step(audio,.1,settings.music,false)
    effect.update(motion,settings,false)
    const musicBefore=drops[0].toArray()
    expect(musicBefore[3]).toBeGreaterThan(0)
    for(let frame=0;frame<10;frame++)motion.step(audio,.1,settings.music,true)
    effect.update(motion,settings,true)
    const musicAfter=drops[0].toArray()
    expect(musicAfter.slice(0,3)).toEqual(musicBefore.slice(0,3))
    expect(musicAfter[3]).toBeGreaterThan(0)
    expect(musicAfter[3]).toBeLessThan(musicBefore[3])

    motion.reset();motion.touch(8,4)
    motion.step(silentAnalysis(),.1,settings.music,true);effect.update(motion,settings,true)
    for(let frame=0;frame<10;frame++)motion.step(silentAnalysis(),.1,settings.music,true)
    effect.update(motion,settings,true)
    const frozen=drops[0].toArray()
    // Toggling the preference without advancing audio must preserve the visible wave.
    effect.update(motion,settings,false)
    expect(drops[0].toArray()).toEqual(frozen)
    motion.step(silentAnalysis(),.1,settings.music,false);effect.update(motion,settings,false)
    const resumed=drops[0].toArray()
    expect(resumed[2]).toBeGreaterThan(frozen[2])
    expect(resumed[3]*Math.exp(-resumed[2]*.38)).toBeLessThan(frozen[3]*Math.exp(-frozen[2]*.38))
  } finally {
    const geometries=new Set<any>(),materials=new Set<any>()
    effect.group.traverse((object:any)=>{if(object.geometry)geometries.add(object.geometry);if(object.material)materials.add(object.material)})
    geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose())
  }
})

test('a reduced-motion touch fades and expires without propagating its wave', () => {
  const motion = new SceneMotion(), uniforms = commonUniforms(), drive = flowDriver(uniforms)
  motion.touch(8,-11)
  const ripple = motion.ripples[0]
  const initialHeight = motion.sample(8,-11,.3,defaultMusicSettings).height
  for (let frame=0;frame<60;frame++) motion.step(silentAnalysis(),1/60,defaultMusicSettings,true)
  drive(motion,defaults,true)
  expect(ripple.age).toBe(0)
  expect(ripple.lifetime).toBeCloseTo(1)
  expect(motion.phase).toBe(0)
  expect(motion.presence).toBeGreaterThan(0)
  expect(motion.presence).toBeLessThan(.6)
  expect(motion.sample(8,-11,.3,defaultMusicSettings).height).toBeLessThan(initialHeight)
  expect(touchEnergy(motion)).toBeLessThan(.15)
  expect(uniforms.uTouch.value).toBeLessThan(.3)
  for (let frame=0;frame<360;frame++) motion.step(silentAnalysis(),1/60,defaultMusicSettings,true)
  drive(motion,defaults,true)
  expect(ripple.age).toBe(0)
  expect(motion.ripples).toHaveLength(0)
  expect(motion.presence).toBe(0)
  expect(touchEnergy(motion)).toBe(0)
  expect(uniforms.uTouch.value).toBe(0)
  motion.touch(60,-100)
  expect(motion.ripples).toHaveLength(0)
  motion.touch(60,-100,256)
  expect(motion.ripples[0]).toMatchObject({x:60,z:-100})
})

test('smallest scene scale and largest distance retain actual geometry in wide and tall regions', async ({ page }) => {
  await isolatedPage(page)
  const results = await page.evaluate(async () => {
    const { ClassicSceneRenderer } = await import('/src/features/spectrum/three/classic/classic-renderer.ts')
    const { SceneMotion } = await import('/src/features/spectrum/three/motion.ts')
    const { defaults, normalizeSettings } = await import('/src/features/spectrum/model.ts')
    const settings = normalizeSettings({ ...defaults, effect:'spectrum_bars', quality:'eco',
      music:{ ...defaults.music, fieldScale:.8 }, view:{ ...defaults.view, distance:4 },
      bounds:{ x:0,y:0,width:1,height:1 } })
    const canvas = document.createElement('canvas'); document.body.append(canvas)
    const world = new ClassicSceneRenderer(canvas), motion = new SceneMotion(), results = []
    const audio = { rms:.18,bands:Array(6).fill(.5),spectrum:Array(48).fill(.5),skin:[] }
    try {
      canvas.style.cssText='width:640px;height:360px'; world.resize(settings,1)
      for (let frame=0;frame<45;frame++) { motion.step(audio,1/30,settings.music,false); world.draw(motion,settings,false) }
      for (const [width,height] of [[640,360],[360,640]]) {
        canvas.style.width=width+'px'; canvas.style.height=height+'px'; world.resize(settings,1)
        const gl=world.renderer.getContext()
        const read=()=>{ const data=new Uint8Array(canvas.width*canvas.height*4); gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data); return data }
        world.scene.visible=false; world.draw(motion,settings,false); const backdrop=read()
        world.scene.visible=true; world.draw(motion,settings,false); const image=read()
        let geometry=0
        for(let i=0;i<image.length;i+=4) if(Math.max(Math.abs(image[i]-backdrop[i]),Math.abs(image[i+1]-backdrop[i+1]),Math.abs(image[i+2]-backdrop[i+2]))>5)geometry++
        results.push({ width,height,geometry,error:gl.getError() })
      }
      return results
    } finally { world.dispose(); world.renderer.forceContextLoss(); canvas.remove() }
  })
  for (const result of results) {
    expect(result.geometry, JSON.stringify(result)).toBeGreaterThan(20)
    expect(result.error).toBe(0)
  }
})

test('water pointer hits keep their world location and fade in place under reduced motion', async ({ page }) => {
  await isolatedPage(page)
  const result = await page.evaluate(async () => {
    const { ClassicSceneRenderer } = await import('/src/features/spectrum/three/classic/classic-renderer.ts')
    const { SceneMotion } = await import('/src/features/spectrum/three/motion.ts')
    const { defaults, normalizeSettings } = await import('/src/features/spectrum/model.ts')
    const { silentAnalysis } = await import('/src/features/spectrum/music-analysis.ts')
    const T = await import('/node_modules/.vite/deps/three.js')
    const settings=normalizeSettings({ ...defaults,effect:'water_ripple',quality:'eco',bounds:{ x:0,y:0,width:1,height:1 } })
    const canvas=document.createElement('canvas'); canvas.style.cssText='width:640px;height:360px'; document.body.append(canvas)
    const world=new ClassicSceneRenderer(canvas),motion=new SceneMotion()
    try {
      world.resize(settings,1); motion.step(silentAnalysis(),1/60,settings.music,true); world.draw(motion,settings,true)
      // Project an off-center point on the actual water plane back into pointer space.
      const expected={x:8,z:4}, ndc=new T.Vector3(expected.x,-5,expected.z).project(world.camera), rect=canvas.getBoundingClientRect()
      const hit=world.hit(rect.left+(ndc.x+1)*rect.width/2,rect.top+(1-ndc.y)*rect.height/2)!
      motion.touch(hit.x,hit.z); motion.step(silentAnalysis(),1/60,settings.music,true); world.draw(motion,settings,true)
      let water: any
      world.scene.traverse((object: any)=>{ if(object.material?.uniforms?.uDrops)water=object.material.uniforms })
      const before=water.uDrops.value[0].toArray()
      for(let frame=0;frame<60;frame++)motion.step(silentAnalysis(),1/60,settings.music,true)
      world.draw(motion,settings,true); const after=water.uDrops.value[0].toArray()
      return { expected,hit,before,after,error:world.renderer.getContext().getError() }
    } finally { world.dispose(); world.renderer.forceContextLoss(); canvas.remove() }
  })
  expect(result.hit.x).toBeCloseTo(result.expected.x,5)
  expect(result.hit.z).toBeCloseTo(result.expected.z,5)
  expect(result.before[0]).toBeCloseTo(result.expected.x,5)
  expect(result.before[1]).toBeCloseTo(result.expected.z,5)
  expect(result.after.slice(0,3)).toEqual(result.before.slice(0,3))
  expect(result.after[3]).toBeGreaterThan(0)
  expect(result.after[3]).toBeLessThan(result.before[3])
  expect(result.error).toBe(0)
})
