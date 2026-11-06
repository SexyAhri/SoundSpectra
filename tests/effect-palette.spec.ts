import { expect, test } from '@playwright/test'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'
import { recommendedMusic, effectGroups } from '../src/features/spectrum/effect-presets'
import { resolveEffectPalette } from '../src/features/spectrum/effect-palette'
import { selectChoice } from './helpers/choices'

test('recommended appearances remain compatible and the picker contains eleven distinct choices', () => {
  const effects = effectGroups.flatMap(group => group.effects)
  expect(new Set(effects).size).toBe(11)
  for (const effect of effects) {
    const music = recommendedMusic(effect)
    expect(normalizeSettings({ ...defaults, effect, music }).music).toEqual(music)
  }
  expect(recommendedMusic('dream_stars').speed).toBeLessThan(recommendedMusic('star_flight').speed)
  expect(recommendedMusic('rhythm_skin').sensitivity).toBeLessThan(recommendedMusic('star_flight').sensitivity)
  const base = resolveEffectPalette(defaults), near = resolveEffectPalette({ ...defaults, color: '#d4c3fe' })
  for (const role of ['main', 'accent', 'high', 'low'] as const) for (const i of [1, 3, 5]) {
    expect(Math.abs(parseInt(base[role].slice(i, i + 2), 16) - parseInt(near[role].slice(i, i + 2), 16))).toBeLessThanOrEqual(1)
  }
})

test('every renderer responds to tint and palette changes while a repeated frame stays stable', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('**/palette-probe', route => route.fulfill({ contentType: 'text/html', body: '<body></body>' }))
  await page.goto('/palette-probe')
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const results = await page.evaluate(async () => {
    const { defaults } = await import('/src/features/spectrum/model.ts')
    const { musicEffects } = await import('/src/features/spectrum/music-engine/catalog.ts')
    const { recommendedMusic } = await import('/src/features/spectrum/effect-presets.ts')
    const { createThreeSceneRenderer } = await import('/src/features/spectrum/three/scene-renderer.ts')
    const { SceneMotion } = await import('/src/features/spectrum/three/motion.ts')
    const { demoAnalysis } = await import('/src/features/spectrum/music-analysis.ts')
    const results = []
    for (const { value: effect } of musicEffects) {
      const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:320px;height:180px'; document.body.append(canvas)
      const world = createThreeSceneRenderer(canvas, effect), motion = new SceneMotion()
      const config = { ...structuredClone(defaults), effect, music: recommendedMusic(effect), bounds: { x: 0, y: 0, width: 1, height: 1 } }
      try {
        world.resize(config, 1)
        for (let i = 0; i < 60; i++) motion.step(demoAnalysis(i / 20), .05, config.music, false)
        const draw = (settings: typeof config) => { world.draw(motion, settings, false); return canvas.toDataURL() }
        const original = draw(config), repeat = draw(config)
        const red = draw({ ...config, color: '#ee735e' }), blue = draw({ ...config, color: '#6a9fd4' })
        const alternative = draw({ ...config, music: { ...config.music, fieldPalette: 'ember' } })
        results.push({ effect, stable: original === repeat, tintChanged: red !== blue, paletteChanged: original !== alternative, glError: world.renderer.getContext().getError() })
      } finally { world.dispose(); world.renderer.forceContextLoss(); canvas.remove() }
    }
    return results
  })
  for (const result of results) expect(result, result.effect).toMatchObject({ stable: true, tintChanged: true, paletteChanged: true, glError: 0 })
  expect(errors).toEqual([])
})

test('effect tuning survives switching and reload, and palette selection replaces cover tint explicitly', async ({ page }) => {
  const initial = { ...structuredClone(defaults), followCover: true, color: '#d5a3a0', music: { ...defaults.music, jellyCount: 7, speed: 3 } }
  await page.addInitScript(settings => { if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings)) }, initial)
  await page.goto('/')
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.getByRole('button', { name: '银河', exact: true }).click()
  await expect.poll(saved).toMatchObject({ effect: 'dream_stars', followCover: true, music: { speed: 1 } })
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await selectChoice(page, '声场配色', 'ember')
  await expect.poll(saved).toMatchObject({ followCover: false, color: '#d4c3ff', music: { fieldPalette: 'ember' } })
  await expect(page.getByRole('combobox', { name: '声场配色' })).toContainText('暖夜微星')
  await expect(page.getByRole('combobox', { name: '声场配色' }).locator('.choice-swatches i')).toHaveCount(3)
  await page.getByRole('tab', { name: '动效', exact: true }).click()
  await page.getByRole('button', { name: '浮光水母', exact: true }).click()
  await expect.poll(saved).toMatchObject({ effect: 'rhythm_balls', color: initial.color, music: { jellyCount: 7, speed: 3 } })
  await page.reload()
  await page.getByRole('button', { name: '银河', exact: true }).click()
  await expect.poll(saved).toMatchObject({ effect: 'dream_stars', music: { speed: 1, fieldPalette: 'ember' } })
  expect((await saved()).bounds).toEqual(initial.bounds)
})

test('region appearance history is isolated and corrupt optional history cannot block selection', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { defaults } = await import('/src/features/spectrum/model.ts')
    const { selectEffect } = await import('/src/features/settings/effect-memory.ts')
    const first = { ...defaults, music: { ...defaults.music, jellyCount: 7 } }
    selectEffect(first, 'ripple', 'first')
    const other = selectEffect({ ...defaults, effect: 'ripple' }, 'rhythm_balls', 'second')
    const remembered = selectEffect({ ...defaults, effect: 'ripple' }, 'rhythm_balls', 'first')
    localStorage.setItem('soundspectra.effect-looks.v1', '{broken')
    const recovered = selectEffect(first, 'dream_stars', 'first')
    return { other: other.music?.jellyCount, remembered: remembered.music?.jellyCount, recovered: recovered.effect }
  })
  expect(result).toEqual({ other: 5, remembered: 7, recovered: 'dream_stars' })
})

test('a wide desktop strip spreads three jellyfish without flattening or clipping their silhouettes', async ({ page }) => {
  await page.route('**/orb-strip-probe', route => route.fulfill({ contentType: 'text/html', body: '<body></body>' }))
  await page.goto('/orb-strip-probe')
  const boxes = await page.evaluate(async () => {
    const { defaults } = await import('/src/features/spectrum/model.ts')
    const { ClassicSceneRenderer } = await import('/src/features/spectrum/three/classic/classic-renderer.ts')
    const { SceneMotion } = await import('/src/features/spectrum/three/motion.ts')
    const { demoAnalysis } = await import('/src/features/spectrum/music-analysis.ts')
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:900px;height:150px'; document.body.append(canvas)
    const world = new ClassicSceneRenderer(canvas), motion = new SceneMotion()
    const config = { ...defaults, quality: 'eco', music: { ...defaults.music, jellyCount: 3, tentacleLength: 0, jellySize: 3.6 }, opacity: 100, bounds: { x: 0, y: 0, width: 1, height: 1 } }
    try {
      world.resize(config, 1)
      for(let i=0;i<60;i++)motion.step(demoAnalysis(i/20),.05,config.music,false)
      world.draw(motion,config,false)
      const gl=world.renderer.getContext(), pixels=new Uint8Array(canvas.width*canvas.height*4)
      gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
      // Fine tentacles need not form one connected pixel island. Group the
      // visible columns instead, retaining each animal's complete silhouette.
      world.scene.visible=false;world.draw(motion,config,false)
      const background=new Uint8Array(pixels.length);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,background)
      for(let i=0;i<pixels.length;i+=4)pixels[i+3]=Math.max(...[0,1,2,3].map(c=>Math.abs(pixels[i+c]-background[i+c])))
      const boxes: { x1:number;x2:number;y1:number;y2:number;ratio:number }[]=[]
      let current: {x1:number;x2:number;y1:number;y2:number}|undefined
      for(let x=0;x<canvas.width;x++) {
        let y1=canvas.height,y2=-1
        for(let y=0;y<canvas.height;y++)if(pixels[(y*canvas.width+x)*4+3]>20){y1=Math.min(y1,y);y2=y}
        if(y2<0)continue
        if(current&&x-current.x2>4){boxes.push({...current,ratio:(current.x2-current.x1+1)/(current.y2-current.y1+1)});current=undefined}
        if(!current)current={x1:x,x2:x,y1,y2}
        else{current.x2=x;current.y1=Math.min(current.y1,y1);current.y2=Math.max(current.y2,y2)}
      }
      if(current)boxes.push({...current,ratio:(current.x2-current.x1+1)/(current.y2-current.y1+1)})
      return boxes.filter(box=>box.x2-box.x1>5)
    }finally{world.dispose();world.renderer.forceContextLoss()}
  })
  expect(boxes).toHaveLength(3)
  expect(boxes[2].x2-boxes[0].x1).toBeGreaterThan(500)
  for(const box of boxes){
    expect(box.ratio).toBeGreaterThan(.4);expect(box.ratio).toBeLessThan(1.3)
    expect(box.y1).toBeGreaterThan(0);expect(box.y2).toBeLessThan(149)
  }
})
