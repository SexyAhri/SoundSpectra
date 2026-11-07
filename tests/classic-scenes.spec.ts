import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'
import { expect, test, type Page } from '@playwright/test'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'
import { classicMusicEffects, isClassicEffect, isThreeEffect } from '../src/features/spectrum/music-engine/catalog'
import { importScene, layout, sceneDocument } from '../src/features/preview/scene-library'

const parameters = {
  rhythm_balls: ['jellyCount', 7], rhythm_rain: ['rainCount', 16],
  rhythm_skin: ['dragonWidth', 1.7], ripple: ['rippleWidth', 1.6],
  volume_rain: ['meteorDensity', 90], dream_stars: ['starDensity', 4000],
  vortex: ['vortexArms', 5],
} as const

async function probePage(page: Page) {
  // Serve a document without a second application animation competing with the probe.
  await page.route('**/classic-render-probe', route => route.fulfill({ contentType: 'text/html',
    body: visualProbeHtml('<!doctype html><html><body style="margin:0;background:#000"></body></html>') }))
  await page.goto('/classic-render-probe')
}

test('all seven effect IDs and their settings round-trip through the old schema', () => {
  expect(classicMusicEffects).toHaveLength(7)
  for (const { value: effect } of classicMusicEffects) {
    const [key, value] = parameters[effect as keyof typeof parameters]
    const old = JSON.parse(JSON.stringify({ ...defaults, effect, music: { ...defaults.music, [key]: value },
      regions: [{ ...defaults, id: 'other', name: '另一空间', visible: true, effect, music: { ...defaults.music, [key]: value } }] }))
    delete old.view; delete old.music.ambientDensity; delete old.music.ambientSpread; delete old.regions[0].view
    const settings = normalizeSettings(old)
    expect(isClassicEffect(settings.effect)).toBe(true)
    expect(isThreeEffect(settings.effect)).toBe(true)
    expect(settings.music[key]).toBe(value)
    expect(settings.regions[0].music[key]).toBe(value)
    const saved = importScene(sceneDocument({ name: effect, scene: layout(settings) })).scene
    expect(saved.effect).toBe(effect)
    expect(saved.music[key]).toBe(value)
    expect(saved.regions[0].music[key]).toBe(value)
    expect(saved.view).toEqual(defaults.view)
  }
})

for (const { value: effect, label } of classicMusicEffects) test(`${effect}: visible spatial geometry, fixed-frame camera parallax, silence and saved parameters`, async ({ page }) => {
  test.setTimeout(60000)
  const [key, value] = parameters[effect as keyof typeof parameters]
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const old = JSON.parse(JSON.stringify({ ...defaults, effect, music: { ...defaults.music, [key]: value } }))
  delete old.view
  await page.addInitScript(settings => {
    if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings))
  }, old)
  await page.goto('/')
  await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
  const canvas = page.locator('.three-scene-surface canvas').first()
  await expect(canvas).toHaveAttribute('data-renderer', 'three')
  await expect(canvas).toHaveAttribute('data-scene', effect)
  await expect(canvas).toHaveAttribute('data-geometry', 'spatial')
  await page.getByRole('tab', { name: '位置', exact: true }).click()
  await page.getByText('精细视角', { exact: true }).click()
  await page.getByRole('slider', { name: '左右旋转', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('已保存到此浏览器', { exact: true })).toBeVisible()
  await page.reload()
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
  expect(stored.effect).toBe(effect); expect(stored.music[key]).toBe(value); expect(stored.view.yaw).toBe(1)

  await probePage(page)
  const result = await page.evaluate(async ({ effect, key, value }) => {
    const { createThreeSceneRenderer } = await import('/src/features/spectrum/three/scene-renderer.ts')
    const { SceneMotion } = await import('/src/features/spectrum/three/motion.ts')
    const { defaults, normalizeSettings } = await import('/src/features/spectrum/model.ts')
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:640px;height:360px'; document.body.append(canvas)
    const settings = normalizeSettings({ ...defaults, effect, quality: 'eco', bounds: { x: 0, y: 0, width: 1, height: 1 } })
    const world = createThreeSceneRenderer(canvas, effect), motion = new SceneMotion()
    const audio = { rms: .18, bands: [.6,.48,.35,.25,.18,.12],
      spectrum: Array.from({ length: 48 }, (_, i) => .15 + .55 * Math.exp(-(((i - 18) / 13) ** 2))), skin: Array(256).fill(80) }
    const gl = world.renderer.getContext(), size = 640 * 360
    const read = () => { const pixels = new Uint8Array(size * 4); gl.readPixels(0,0,640,360,gl.RGBA,gl.UNSIGNED_BYTE,pixels); return pixels }
    let disposed = false
    try {
      await world.resize(settings,1)
      for (let frame=0;frame<45;frame++) {
        motion.step(audio,1/30,settings.music,false); world.draw(motion,settings,false)
      }
      // Reuse the actual last analysis frame, including its nonzero dt. Camera or
      // appearance redraws must not consume that same audio interval a second time.
      let objects = 0
      world.scene.traverse(object => { if (object.isMesh || object.isPoints || object.isLine) objects++ })
      world.scene.visible = false; world.draw(motion,settings,false); const backdrop = read()
      world.scene.visible = true; world.draw(motion,settings,false); const front = read()
      world.draw(motion,settings,false); const repeat = read()
      world.draw(motion,{ ...settings, view: { ...settings.view, yaw: 47, pitch: 19 } },false); const turned = read()
      world.draw(motion,{ ...settings, music: { ...settings.music, [key]: value } },false); const adjusted = read()
      let geometryPixels = 0, turnedPixels = 0, changedGeometryPixels = 0, adjustedPixels = 0, repeatedDifference = 0
      for (let i=0;i<front.length;i+=4) {
        const foreground = Math.max(Math.abs(front[i]-backdrop[i]),Math.abs(front[i+1]-backdrop[i+1]),Math.abs(front[i+2]-backdrop[i+2])) > 10
        const rotated = Math.max(Math.abs(turned[i]-backdrop[i]),Math.abs(turned[i+1]-backdrop[i+1]),Math.abs(turned[i+2]-backdrop[i+2])) > 10
        geometryPixels += Number(foreground); turnedPixels += Number(rotated)
        const delta = Math.max(Math.abs(front[i]-turned[i]),Math.abs(front[i+1]-turned[i+1]),Math.abs(front[i+2]-turned[i+2]))
        if ((foreground || rotated) && delta > 8) changedGeometryPixels++
        if (Math.max(Math.abs(front[i]-adjusted[i]),Math.abs(front[i+1]-adjusted[i+1]),Math.abs(front[i+2]-adjusted[i+2])) > 8) adjustedPixels++
        repeatedDifference += Math.abs(front[i]-repeat[i])+Math.abs(front[i+1]-repeat[i+1])+Math.abs(front[i+2]-repeat[i+2])
      }
      world.draw(motion,{ ...settings, masks: [{ id: 'full', bounds: { x: 0, y: 0, width: 1, height: 1 }, feather: 0 }] },false)
      const masked = read()
      let maskedPixels = 0; for (let i=3;i<masked.length;i+=4) maskedPixels += Number(masked[i] > 4)
      const silence = { rms:0,bands:Array(6).fill(0),spectrum:Array(48).fill(0),skin:[] }
      for (let frame=0;frame<210;frame++) motion.step(silence,1/30,settings.music,false)
      world.draw(motion,settings,false); const silent = read()
      let silentPixels = 0; for (let i=3;i<silent.length;i+=4) silentPixels += Number(silent[i] > 4)
      const glError = gl.getError()
      world.dispose(); disposed = true
      return { objects, geometryPixels, turnedPixels, changedGeometryPixels, adjustedPixels, repeatedDifference, maskedPixels, silentPixels, glError,
        remainingGeometries: world.renderer.info.memory.geometries, remainingTextures: world.renderer.info.memory.textures }
    } finally { if (!disposed) world.dispose(); world.renderer.forceContextLoss(); canvas.remove() }
  }, { effect, key, value })
  expect(result.objects).toBeGreaterThan(0)
  expect(result.geometryPixels, `${effect} only drew its backdrop`).toBeGreaterThan(30)
  expect(result.turnedPixels).toBeGreaterThan(30)
  expect(result.repeatedDifference, 'fixed audio and geometry must not advance with wall-clock time').toBe(0)
  expect(result.changedGeometryPixels).toBeGreaterThan(Math.max(12,result.geometryPixels*.05))
  expect(result.adjustedPixels, `${effect} ignored its saved geometry parameter`).toBeGreaterThan(12)
  expect(result.maskedPixels).toBe(0); expect(result.silentPixels).toBe(0)
  expect(result.remainingGeometries).toBe(0); expect(result.remainingTextures).toBe(0)
  expect(result.glError).toBe(0); expect(errors).toEqual([])
})

test('aurora travels visibly over four audible seconds with every brightness input held fixed', async ({ page }) => {
  await probePage(page)
  const result = await page.evaluate(async () => {
    const { AmbientSceneRenderer } = await import('/src/features/spectrum/three/ambient/ambient-renderer.ts')
    const { SceneMotion } = await import('/src/features/spectrum/three/motion.ts')
    const { defaults, normalizeSettings } = await import('/src/features/spectrum/model.ts')
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:640px;height:360px'; document.body.append(canvas)
    const config = normalizeSettings({ ...defaults, effect: 'aurora_flow', music: { ...defaults.music, speed:2 },
      quality: 'eco', bounds: { x:0,y:0,width:1,height:1 } })
    const world = new AmbientSceneRenderer(canvas), motion = new SceneMotion()
    const audio = { rms:.08,bands:Array(6).fill(.4),spectrum:Array(48).fill(.5),skin:[] }
    const gl = world.renderer.getContext()
    const read = () => { const pixels = new Uint8Array(640*360*4); gl.readPixels(0,0,640,360,gl.RGBA,gl.UNSIGNED_BYTE,pixels); return pixels }
    try {
      await world.resize(config,1)
      for(let frame=0;frame<120;frame++) motion.step(audio,1/60,config.music,false)
      const stable = { volume:motion.volume,bass:motion.bass,middle:motion.middle,treble:motion.treble,presence:motion.presence,frame:motion.frame }
      const start = motion.auroraPhase
      world.draw(motion,config,false); const before = read()
      for(let frame=0;frame<240;frame++) motion.step(audio,1/60,config.music,false)
      // Retain only the flow advance: constant colors, amplitude, spectrum and presence.
      Object.assign(motion,stable)
      world.draw(motion,config,false); const after = read()
      let changed = 0, lit = 0
      for(let i=0;i<before.length;i+=4) {
        if(Math.max(after[i],after[i+1],after[i+2])>35)lit++
        if(Math.max(Math.abs(before[i]-after[i]),Math.abs(before[i+1]-after[i+1]),Math.abs(before[i+2]-after[i+2]))>8)changed++
      }
      return { phaseAdvance:motion.auroraPhase-start,changedFraction:changed/(640*360),lit,glError:gl.getError() }
    } finally { world.dispose(); world.renderer.forceContextLoss(); canvas.remove() }
  })
  expect(result.phaseAdvance).toBeGreaterThan(1)
  expect(result.lit).toBeGreaterThan(100)
  expect(result.changedFraction).toBeGreaterThan(.04)
  expect(result.glError).toBe(0)
})
