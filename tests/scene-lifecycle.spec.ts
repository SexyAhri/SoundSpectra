import { expect, test, type Page } from '@playwright/test'
import { SceneMotion } from '../src/features/spectrum/three/motion'
import { defaultMusicSettings } from '../src/features/spectrum/music-engine/catalog'
import { silentAnalysis } from '../src/features/spectrum/music-analysis'
import { touchEnergy } from '../src/features/spectrum/three/classic/kinetic/common'
import { commonUniforms, flowDriver } from '../src/features/spectrum/three/classic/flow/shared'
import { defaults } from '../src/features/spectrum/model'

async function isolatedPage(page: Page) {
  await page.route('**/scene-lifecycle-probe', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><body style="margin:0"></body></html>' }))
  await page.goto('/scene-lifecycle-probe')
}

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
    const settings = normalizeSettings({ ...defaults, effect:'rhythm_balls', quality:'eco',
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

