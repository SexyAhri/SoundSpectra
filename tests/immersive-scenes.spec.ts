import { chooseStyle } from './helpers/module-settings'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'
import { expect, test, type Page } from '@playwright/test'
import { defaults } from '../src/features/spectrum/model'
import { classicMusicEffects, type MusicEffect } from '../src/features/spectrum/music-engine/catalog'

test('full-screen current effect preserves the selected scene and its tuning after reload', async ({ page }) => {
  const original = {
    ...defaults, effect: 'vortex', sceneMode: 'daily', opacity: 35,
    bounds: { x: .2, y: .25, width: .3, height: .35 },
    view: { yaw: 120, pitch: -35, roll: 45, x: 23, y: -18, distance: 3 },
    music: { ...defaults.music, fieldScale: 1.8, fieldBrightness: 72, fieldPalette: 'ember', vortexArms: 5, vortexWidth: 1.6 },
  }
  await page.addInitScript(settings => {
    if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings))
  }, original)
  await page.goto('/#scene')
  await expect(page.getByRole('group', { name: '当前灯效', exact: true })).toContainText('旋涡')
  await page.getByRole('button', { name: '全屏展示当前灯效', exact: true }).click()
  await expect(page.getByText('已保存到此浏览器', { exact: true })).toBeVisible()
  const expected = { effect: 'vortex', sceneMode: 'immersive', opacity: 100,
    bounds: { x: 0, y: 0, width: 1, height: 1 }, view: defaults.view,
    music: { ...original.music, fieldScale: 1.35 } }
  const readSaved = () => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
  expect(await readSaved()).toMatchObject(expected)
  await page.reload()
  expect(await readSaved()).toMatchObject(expected)
  await expect(page.getByRole('group', { name: '当前灯效', exact: true })).toContainText('旋涡')
  await expect(page.locator('.three-scene-surface canvas').first()).toHaveAttribute('data-scene', 'vortex')
})

test('effect picker omits retired scenes and shortcuts while retaining preferred scenes', async ({ page }) => {
  await page.goto('/#scene')
  for (const name of ['全屏熔金', '跃迁光廊', '熔金潮汐', '水波纹', '丹霞声谷', '晶簇声境', '日冕回响']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  for (const [name, effect] of [['晴空浮游', 'volume_rain'], ['雪花飘舞', 'ripple']]) {
    await chooseStyle(page, '灯效', name)
    await expect(page.getByRole('group', { name: '当前灯效', exact: true })).toContainText(name)
    await expect(page.locator('.three-scene-surface canvas').first()).toHaveAttribute('data-scene', effect)
  }
})

async function panoramaCoverage(page: Page, effect: MusicEffect) {
  await page.route('**/immersive-probe',route=>route.fulfill({contentType:'text/html',body: visualProbeHtml('<body style="margin:0"></body>')}))
  await page.goto('/immersive-probe')
  const result=await page.evaluate(async effect=>{
    const {ClassicSceneRenderer}=await import('/src/features/spectrum/three/classic/classic-renderer.ts')
    const {SceneMotion}=await import('/src/features/spectrum/three/motion.ts')
    const {defaults}=await import('/src/features/spectrum/model.ts')
    const {demoAnalysis}=await import('/src/features/spectrum/music-analysis.ts')
    const canvas=document.createElement('canvas');canvas.style.cssText='width:640px;height:360px';document.body.append(canvas)
    const config={...defaults,effect,opacity:100,sceneMode:'immersive' as const,bounds:{x:0,y:0,width:1,height:1}},world=new ClassicSceneRenderer(canvas),motion=new SceneMotion()
    try{
      await world.resize(config,1)
      for(let i=0;i<90;i++){motion.step(demoAnalysis(i/30),1/30,config.music,false);world.draw(motion,config,false)}
      const gl=world.renderer.getContext(),read=()=>{const data=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);return data}
      const image=read();world.scene.visible=false;world.draw(motion,config,false);const backdrop=read()
      let geometry=0;const edges=[0,0,0], tiles=Array<number>(12).fill(0)
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
        const i=(y*canvas.width+x)*4,delta=Math.max(...[0,1,2].map(c=>Math.abs(image[i+c]-backdrop[i+c])))
        if(delta>10){
          geometry++;if(x<canvas.width*.15)edges[0]++;if(x>canvas.width*.85)edges[1]++;if(y<canvas.height*.15)edges[2]++
          tiles[Math.min(2,Math.floor(y/canvas.height*3))*4+Math.min(3,Math.floor(x/canvas.width*4))]++
        }
      }
      return {coverage:geometry/(canvas.width*canvas.height),edges,tiles,error:gl.getError()}
    }finally{world.dispose();world.renderer.forceContextLoss();canvas.remove()}
  },effect)
  return result
}

for (const { value: effect } of classicMusicEffects) test(`${effect}: foreground retains its intended spatial coverage`, async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const result = await panoramaCoverage(page, effect)
  await testInfo.attach('panorama-coverage', { body: JSON.stringify(result), contentType: 'application/json' })
  if (['rhythm_balls','butterfly_flock','ginkgo_leaves','cosmic_web'].includes(effect)) {
    // Geometric desktop effects deliberately leave empty space around their
    // silhouette; they must remain visible without filling the viewport edges.
    expect(result.coverage).toBeGreaterThan(.002)
    expect(result.tiles.filter(count => count > 20).length).toBeGreaterThanOrEqual(2)
  } else {
    // A sparse star field should cover space, not become a solid luminous wall.
    // Other environments must also contain a substantial visible foreground.
    const sparse = effect === 'dream_stars', snow = effect === 'ripple'
    // Snow uses fine isolated flakes; it is intentionally less dense than solid geometry.
    expect(result.coverage, 'scene must contribute more than its dark backdrop').toBeGreaterThan(sparse ? .001 : snow ? .01 : .02)
    // The stellar spiral is framed as a complete silhouette; its arms no
    // longer extend past the side edges. Keep density and grid coverage checks.
    if (effect !== 'vortex') for (const [side, count] of result.edges.slice(0, 2).entries()) {
      expect(count, `${side === 0 ? 'left' : 'right'} 15% must contain foreground geometry`).toBeGreaterThan(sparse ? 8 : 150)
    }
    const occupied = result.tiles.filter(count => count > (sparse ? 3 : 50)).length
    expect(occupied, 'foreground must span at least half the 4 × 3 viewing grid').toBeGreaterThanOrEqual(6)
  }
  expect(result.error).toBe(0)
  expect(errors).toEqual([])
})
