import { settingsSection } from './helpers/module-settings'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'
import { expect, test } from '@playwright/test'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'
import { musicEffects } from '../src/features/spectrum/music-engine/catalog'
import { importScene, layout } from '../src/features/preview/scene-library'

const replacements = {
  ember_flow: 'caustic_light',
  prism_cluster: 'caustic_light', kinetic_mobile: 'ginkgo_leaves', solar_corona: 'cosmic_web',
  ink_marbling: 'caustic_light', harmonic_strings: 'ginkgo_leaves',
  koi_dance: 'ginkgo_leaves', ferrofluid: 'caustic_light',
  spectrum_bars: 'sound_field', rhythm_bars: 'sound_field', pulse_ring: 'vortex',
  rhythm_fluid: 'rhythm_skin', water_ripple: 'ripple',
} as const

test('retired effects migrate in settings, additional regions and saved scenes without losing personal layout', () => {
  expect(new Set(musicEffects.map(e=>e.value)).size).toBe(musicEffects.length)
  for (const [effect, replacement] of Object.entries(replacements)) {
    const old = JSON.parse(JSON.stringify({ ...defaults, effect,
      music: { ...defaults.music, clusterCount: 30, rayCount: 1200, fluidWidth: 1.7 },
      regions: [{ ...layout(defaults), id: 'other', name: '保留的位置', visible: true, effect }] }))
    const migrated = normalizeSettings(old)
    expect(migrated.effect).toBe(replacement)
    expect(migrated.regions[0]).toMatchObject({ effect: replacement, id: 'other', name: '保留的位置', bounds: defaults.bounds })
    expect(migrated.music).not.toHaveProperty('clusterCount')
    expect(migrated.music).not.toHaveProperty('rayCount')
    expect(migrated.music).not.toHaveProperty('fluidWidth')
    const saved = importScene(JSON.stringify({ format: 'SoundSpectra.scene', version: 1, name: '旧收藏', scene: old }))
    expect(saved.scene.effect).toBe(replacement)
    expect(saved.scene.regions[0].effect).toBe(replacement)
  }
  const legacy = JSON.parse(JSON.stringify(layout(defaults)))
  for (const key of ['jellyCount', 'jellySize', 'tentacleLength', 'driftSpeed', 'starDensity', 'nebulaScale', 'dustOpacity', 'spinSpeed']) delete legacy.music[key]
  legacy.music.ballCount = 7
  const imported = importScene(JSON.stringify({ format: 'SoundSpectra.scene', version: 1, name: '旧参数', scene: legacy }))
  expect(imported.scene.music.jellyCount).toBe(7)
})

test('a saved retired selection reloads as a supported effect and exposes no retired controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(settings => localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings)), {
    ...defaults, quality: 'eco', effect: 'spectrum_bars', music: { ...defaults.music, clusterCount: 32 },
  })
  await page.goto('/#scene')
  await expect(page.getByRole('group', { name: '当前灯效', exact: true })).toContainText('频谱回响')
  for (const name of ['晶簇声境', '日冕回响', '熔金潮汐', '水波纹', '丹霞声谷']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  await settingsSection(page, '动效')
  await expect(page.getByRole('slider', { name: '晶簇数量', exact: true })).toHaveCount(0)
  await page.reload()
  await settingsSection(page, '动效')
  await expect(page.getByRole('group', { name: '当前灯效', exact: true })).toContainText('频谱回响')
  await expect(page.locator('.three-scene-surface canvas').first()).toHaveAttribute('aria-label', '频谱回响 · 真实音乐声场')
})

test('MSAA boundaries keep HDR scene and bloom pixels finite through different camera views', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('**/finite-shader-probe', route => route.fulfill({ contentType: 'text/html', body: visualProbeHtml('<body></body>') }))
  await page.goto('/finite-shader-probe')
  const results = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js')
    const { defaults } = await import('/src/features/spectrum/model.ts')
    const { recommendedMusic } = await import('/src/features/spectrum/effect-presets.ts')
    const { ClassicSceneRenderer } = await import('/src/features/spectrum/three/classic/classic-renderer.ts')
    const { SceneMotion } = await import('/src/features/spectrum/three/motion.ts')
    const { demoAnalysis } = await import('/src/features/spectrum/music-analysis.ts')
    const results = []
    for (const effect of ['rhythm_rain', 'rhythm_skin', 'vortex', 'rhythm_balls', 'dream_stars'] as const) {
      const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:360px;height:203px'; document.body.append(canvas)
      const world = new ClassicSceneRenderer(canvas), motion = new SceneMotion()
      const config = { ...structuredClone(defaults), effect, music: recommendedMusic(effect), quality: 'balanced' as const,
        opacity: 100, bounds: { x: 0, y: 0, width: 1, height: 1 } }
      try {
        await world.resize(config, 1)
        for (let i = 0; i < 30; i++) { motion.step(demoAnalysis(i / 10), .1, config.music, false); world.draw(motion, config, false) }
        for (const yaw of [0, 37, -65]) {
          world.draw(motion, { ...config, view: { ...config.view, yaw } }, false)
          let invalid = 0, negative = 0
          // Check the HDR source as well as every active bloom target. NaNs can
          // turn a single bad edge sample into a large black rectangle after blur.
          const targets = [(world as any).image, ...(world as any).bloom.levels.slice(0, 2).flat()]
          for (const target of targets) {
            if (target.texture.type !== T.HalfFloatType) throw Error('HDR render target unavailable')
            const data = new Uint16Array(target.width * target.height * 4)
            world.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, data)
            for (const encoded of data) { const v = T.DataUtils.fromHalfFloat(encoded); invalid += Number(!Number.isFinite(v)); negative += Number(v < -.001) }
          }
          results.push({ effect, yaw, invalid, negative, error: world.renderer.getContext().getError() })
        }
      } finally { world.dispose(); world.renderer.forceContextLoss(); canvas.remove() }
    }
    return results
  })
  for (const result of results) expect(result, JSON.stringify(result)).toMatchObject({ invalid: 0, negative: 0, error: 0 })
})

test('empty areas stay transparent on the desktop across all three renderer families', async ({ page }) => {
  await page.route('**/empty-scene-probe', route => route.fulfill({ contentType: 'text/html', body: visualProbeHtml('<body></body>') }))
  await page.goto('/empty-scene-probe')
  const results = await page.evaluate(async () => {
    const { defaults } = await import('/src/features/spectrum/model.ts')
    const { recommendedMusic } = await import('/src/features/spectrum/effect-presets.ts')
    const { createThreeSceneRenderer } = await import('/src/features/spectrum/three/scene-renderer.ts')
    const { SceneMotion } = await import('/src/features/spectrum/three/motion.ts')
    const { demoAnalysis } = await import('/src/features/spectrum/music-analysis.ts')
    const results = []
    for (const effect of ['vortex', 'sound_field', 'petal_bloom'] as const) {
      const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:240px;height:135px'; document.body.append(canvas)
      const world = createThreeSceneRenderer(canvas, effect), motion = new SceneMotion()
      const config = { ...structuredClone(defaults), effect, music: recommendedMusic(effect), opacity: 100,
        bounds: { x: 0, y: 0, width: 1, height: 1 } }
      try {
        await world.resize(config, 1)
        for (let i = 0; i < 30; i++) { motion.step(demoAnalysis(i / 10), .1, config.music, false); world.draw(motion, config, false) }
        // Isolate the compositor from geometry so an empty part of the scene
        // cannot acquire a dark backdrop in desktop mode.
        for (const child of (world as any).scene.children) child.visible = false
        for (const sceneMode of ['daily', 'immersive'] as const) {
          world.draw(motion, { ...config, sceneMode }, false)
          const gl = world.renderer.getContext(), data = new Uint8Array(4)
          gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data)
          results.push({ effect, sceneMode, alpha: data[3], error: gl.getError() })
        }
      } finally { world.dispose(); world.renderer.forceContextLoss(); canvas.remove() }
    }
    return results
  })
  for (const result of results) {
    expect(result.error).toBe(0)
    if (result.sceneMode === 'daily') expect(result.alpha, result.effect).toBe(0)
    else expect(result.alpha, result.effect).toBeGreaterThan(240)
  }
})
