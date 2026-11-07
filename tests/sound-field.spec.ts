import { chooseStyle } from './helpers/module-settings'
import { settingsSection } from './helpers/module-settings'
import { expect, test, type Locator } from '@playwright/test'
import { SceneMotion, MAX_RIPPLES } from '../src/features/spectrum/three/motion'
import { defaultMusicSettings, normalizeMusicSettings } from '../src/features/spectrum/music-engine/catalog'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'
import { demoAnalysis, silentAnalysis } from '../src/features/spectrum/music-analysis'
import { importScene, sceneDocument, layout } from '../src/features/preview/scene-library'
import { selectChoice } from './helpers/choices'
import { threeDrawingSize, threePixelBudgets } from '../src/features/spectrum/three/render-budget'

test('sound field shares the music-engine RMS driver, makes distributed drops and never invents sound', () => {
  const motion = new SceneMotion(), music = { ...defaultMusicSettings }
  const positions = new Set<string>()
  for (let i = 0; i < 400; i++) {
    const audio = demoAnalysis(i / 60), frame = motion.step(audio, 1 / 60, music, false)
    expect(frame.intensitySample.current).toBe(audio.rms)
    for (const ripple of motion.ripples) positions.add(`${ripple.x.toFixed(2)},${ripple.z.toFixed(2)}`)
  }
  expect(positions.size).toBeGreaterThan(5)
  expect(motion.ripples.length).toBeLessThanOrEqual(MAX_RIPPLES)
  const count = motion.musicDropCount
  for (let i = 0; i < 500; i++) motion.step({ ...silentAnalysis(), spectrum: Array(48).fill(.9), bands: Array(6).fill(.9) }, 1 / 60, music, false)
  expect(motion.musicDropCount).toBe(count)
  expect(motion.presence).toBe(0)
  expect(motion.ripples).toHaveLength(0)
})

test('spectral shape drives geometry at equal RMS; click waves start at their actual points', () => {
  const a = new SceneMotion(), b = new SceneMotion()
  for (let i = 0; i < 80; i++) {
    const audio = { rms: .12, bands: Array(6).fill(.2), skin: [] }
    a.step({ ...audio, spectrum: Array(48).fill(0) }, 1 / 60, defaultMusicSettings, true)
    b.step({ ...audio, spectrum: Array(48).fill(.7) }, 1 / 60, defaultMusicSettings, true)
  }
  expect(b.sample(2, 5, .3, defaultMusicSettings).height).toBeGreaterThan(a.sample(2, 5, .3, defaultMusicSettings).height)
  expect(a.musicDropCount).toBe(0)
  a.touch(8, -11); a.step(silentAnalysis(), 1 / 60, defaultMusicSettings, false)
  expect(a.ripples[0]).toMatchObject({ x: 8, z: -11, source: 'pointer' })
  expect(a.sample(8, -11, .3, defaultMusicSettings).height).toBeGreaterThan(a.sample(-15, 20, .3, defaultMusicSettings).height)
  const center = new SceneMotion()
  for (let i = 0; i < 180; i++) center.step(demoAnalysis(i / 60), 1 / 60, { ...defaultMusicSettings, fieldRippleMode: 'center' }, false)
  expect(center.ripples.length).toBeGreaterThan(1)
  expect(center.ripples.every(ripple => ripple.x === 0 && ripple.z === -2)).toBe(true)
})

test('3D scene parameters survive normalization and scene export, including older scenes', () => {
  const settings = normalizeSettings({ ...defaults, effect: 'sound_field', music: { fieldBrightness: 31, fieldScale: 1.65, fieldPalette: 'ember', fieldRippleMode: 'rain' } })
  const imported = importScene(sceneDocument({ name: '雨落声场', scene: layout(settings) }))
  expect(imported.scene).toMatchObject({ effect: 'sound_field', music: { fieldBrightness: 31, fieldScale: 1.65, fieldPalette: 'ember', fieldRippleMode: 'rain' } })
  expect(normalizeMusicSettings({ fieldBrightness: Infinity, fieldScale: 100, fieldPalette: 'unknown' } as never)).toMatchObject({ fieldBrightness: 45, fieldScale: 2, fieldPalette: 'iris' })
  const older = JSON.parse(sceneDocument({ name: '旧场景', scene: layout(defaults) }))
  for (const key of Object.keys(older.scene.music)) if (key.startsWith('field')) delete older.scene.music[key]
  expect(importScene(JSON.stringify(older)).scene.music.fieldBrightness).toBe(45)
})

test('spectrum terrain has peaks without ripples and scales with captured volume', () => {
  const quiet = new SceneMotion(), loud = new SceneMotion()
  const music = { ...defaultMusicSettings, sensitivity: 2 }
  const input = { bands: Array(6).fill(.4), spectrum: Array(48).fill(.5), skin: [] }
  for (let i = 0; i < 180; i++) {
    quiet.step({ ...input, rms: .025 }, 1 / 60, music, true)
    loud.step({ ...input, rms: .18 }, 1 / 60, music, true)
  }
  expect(loud.ripples).toHaveLength(0)
  const heights: number[] = [], quietHeights: number[] = []
  for (let z = -24; z <= 24; z += 3) for (let x = -24; x <= 24; x += 3) {
    const seed = ((x + 24) * 13 + (z + 24) * 29) % 101 / 100
    heights.push(loud.sample(x, z, seed, music).height)
    quietHeights.push(quiet.sample(x, z, seed, music).height)
  }
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  expect(Math.max(...heights)).toBeGreaterThan(4)
  expect(Math.max(...heights)).toBeGreaterThan(mean(heights) * 2)
  expect(mean(heights)).toBeGreaterThan(mean(quietHeights) * 1.5)
  expect(loud.sample(-3, -3, .8, music).heat).toBeGreaterThan(loud.sample(24, 24, .8, music).heat)
})

test('terrain travels continuously with sound, stops its phase at silence and respects display resolution budgets', () => {
  const settings = { ...defaultMusicSettings, speed: 4, sensitivity: 2, fieldDrops: 1 }
  const sample = (fps: number) => {
    const motion = new SceneMotion()
    for (let i = 0; i < fps * 4; i++) motion.step({ rms: .15, bands: Array(6).fill(.4), spectrum: Array(48).fill(.5), skin: [] }, 1 / fps, settings, false)
    return motion
  }
  const a = sample(30), b = sample(120)
  expect(a.phase).toBeCloseTo(b.phase, 1)
  const before = b.sample(4, -7, .5, settings).height
  for (let i = 0; i < 120; i++) b.step({ rms: .15, bands: Array(6).fill(.4), spectrum: Array(48).fill(.5), skin: [] }, 1 / 120, settings, false)
  expect(Math.abs(b.sample(4, -7, .5, settings).height - before)).toBeGreaterThan(.05)
  const phase = b.phase
  b.step(silentAnalysis(), 1 / 60, settings, false)
  expect(b.phase).toBe(phase)
  expect(threeDrawingSize(2048, 1152, 1.25, 'balanced')).toEqual({ width: 2560, height: 1440 })
  expect(threeDrawingSize(3840, 2160, 1, 'balanced')).toEqual({ width: 3840, height: 2160 })
  expect(threeDrawingSize(1280, 720, 1, 'balanced')).toEqual({ width: 1600, height: 900 })
  expect(threeDrawingSize(1280, 720, 1, 'smooth')).toEqual({ width: 1920, height: 1080 })
  for (const quality of ['eco', 'balanced', 'smooth', 'unlimited'] as const) {
    const size = threeDrawingSize(3840, 2160, 2, quality, 4)
    expect(size.width * size.height * 4).toBeLessThanOrEqual(threePixelBudgets[quality])
  }
})

test('rock ledges remain continuous as terrain height and sample position change', () => {
  const motion=new SceneMotion()
  const input={rms:.15,bands:Array(6).fill(.4),spectrum:Array(48).fill(.55),skin:[]}
  for(let i=0;i<180;i++)motion.step(input,1/60,defaultMusicSettings,true)
  for(const [x,z] of [[-8,-12],[2,-4],[11,3]]){
    let previous=motion.sample(x,z,.4,{...defaultMusicSettings,fieldHeight:.4}).height
    for(let i=1;i<=1200;i++){
      const settings={...defaultMusicSettings,fieldHeight:.4+i*.001}
      const current=motion.sample(x,z,.4,settings).height
      expect(Math.abs(current-previous)).toBeLessThan(.06)
      expect(Math.abs(current-motion.sample(x+.0001,z+.0001,.4,settings).height)).toBeLessThan(.02)
      previous=current
    }
  }
})

test('GPU height pass matches the real audio CPU reference and does not sample each cell on the CPU', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const [{ SoundFieldRenderer }, { SceneMotion }, { defaults }, T] = await Promise.all([
      import('/src/features/spectrum/three/terrain/terrain-renderer.ts'),
      import('/src/features/spectrum/three/motion.ts'),
      import('/src/features/spectrum/model.ts'), import('/node_modules/.vite/deps/three.js'),
    ])
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:640px;height:360px'; document.body.append(canvas)
    const world = new SoundFieldRenderer(canvas), motion = new SceneMotion()
    const config = { ...defaults, effect: 'sound_field', bounds: { x: 0, y: 0, width: 1, height: 1 } }
    try {
      for (let i = 0; i < 120; i++) motion.step({ rms: .15, bands: [.6,.4,.3,.5,.2,.1], spectrum: Array.from({ length: 48 }, (_, j) => .1 + j / 80), skin: [] }, 1 / 60, config.music, false)
      motion.touch(4, -7)
      await world.resize(config, 1)
      const reference = motion.sample.bind(motion)
      motion.sample = () => { throw new Error('Per-cell CPU height computation must not run during rendering') }
      world.draw(motion, config, false)
      const grid = (world as any).grid, pixels = new Uint16Array(grid * grid * 4)
      world.renderer.readRenderTargetPixels((world as any).heightTarget, 0, 0, grid, grid, pixels)
      let error = 0
      for (let z = 4; z < grid; z += 13) for (let x = 4; x < grid; x += 17) {
        const i = z * grid + x
        const expected = reference((x + .5) / grid * 64 - 32, (z + .5) / grid * 64 - 32, (world as any).seeds[i], config.music)
        error = Math.max(error, Math.abs(T.DataUtils.fromHalfFloat(pixels[i * 4]) - expected.height), Math.abs(T.DataUtils.fromHalfFloat(pixels[i * 4 + 3]) - expected.heat))
      }
      const samples = []
      for (const quality of ['balanced', 'eco', 'balanced']) {
        const next = { ...config, quality }; await world.resize(next, 1); world.draw(motion, next, false)
        world.renderer.setRenderTarget((world as any).image)
        const gl = world.renderer.getContext(); samples.push(gl.getParameter(gl.SAMPLES))
        world.renderer.setRenderTarget(null)
      }
      return { error, samples, glError: world.renderer.getContext().getError(), gpu: canvas.dataset.heightPass }
    } finally { world.dispose(); world.renderer.forceContextLoss(); canvas.remove() }
  })
  expect(result.error).toBeLessThan(.02)
  expect(result.glError).toBe(0)
  expect(result.gpu).toBe('gpu')
  expect(result.samples[0]).toBeGreaterThan(0)
  expect(result.samples[1]).toBe(0)
  expect(result.samples[2]).toBe(result.samples[0])
})

async function pixels(canvas: Locator) {
  return canvas.evaluate((node: HTMLCanvasElement) => new Promise<{ visible: number; bright: number; right: number; left: number; hash: number }>(resolve => {
    const gl = node.getContext('webgl2')!, original = gl.drawElementsInstanced
    const read = () => {
      gl.drawElementsInstanced = original; clearTimeout(timer)
      const data = new Uint8Array(node.width * node.height * 4)
      gl.readPixels(0, 0, node.width, node.height, gl.RGBA, gl.UNSIGNED_BYTE, data)
      let visible = 0, bright = 0, left = 0, right = 0, hash = 2166136261
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 8) { visible++; const x = i / 4 % node.width; if (x < node.width / 2 - 1) left++; else if (x > node.width / 2 + 1) right++ }
        if (Math.max(data[i], data[i + 1], data[i + 2]) > 220) bright++
        hash = Math.imul(hash ^ data[i] ^ data[i + 1] ^ data[i + 2] ^ data[i + 3], 16777619)
      }
      resolve({ visible, bright, left, right, hash })
    }
    const timer = setTimeout(read, 2500)
    let queued = false
    gl.drawElementsInstanced = function (...args) { original.apply(this, args); if (!queued) { queued = true; queueMicrotask(read) } }
  }))
}

test('3D scene fills preview, stays soft, responds to interaction and persists controls', async ({ page }) => {
  test.setTimeout(60000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    // The browser asks for a favicon even though this desktop app has no favicon link.
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text())
  })
  await page.goto('/')
  await chooseStyle(page, '灯效', '频谱回响')
  await page.getByRole('button', { name: '全屏展示当前灯效', exact: true }).click()
  const canvas = page.locator('.sound-field-surface canvas')
  await expect(canvas).toHaveAttribute('data-renderer', 'three')
  await expect.poll(async () => (await pixels(canvas)).visible).toBeGreaterThan(1000)
  const first = await pixels(canvas)
  expect(first.bright / Math.max(first.visible, 1)).toBeLessThan(.02)
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))
  expect(settings.bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  await expect.poll(async () => Number(await canvas.getAttribute('data-drops'))).toBeGreaterThan(1)
  await page.screenshot({ path: 'artifacts/sound-field-workspace.png', fullPage: true })
  await settingsSection(page, '外观')
  await selectChoice(page, '场景氛围', 'immersive')
  await selectChoice(page, '声场配色', 'ember')
  await settingsSection(page, '动效')
  await page.getByText('造型细节', { exact: true }).click()
  await selectChoice(page, '涟漪落点', 'center')
  await page.getByRole('slider', { name: '层叠光感', exact: true }).focus(); await page.keyboard.press('Home')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.reload()
  await settingsSection(page, '动效')
  await expect(page.getByRole('group', { name: '当前灯效', exact: true })).toContainText('频谱回响')
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))).toMatchObject({ sceneMode: 'immersive', music: { fieldBrightness: 20, fieldPalette: 'ember', fieldRippleMode: 'center' } })
  await page.getByRole('switch', { name: '模拟预览', exact: true }).click()
  await expect.poll(async () => (await pixels(canvas)).visible, { timeout: 10000 }).toBe(0)
  const bounds = (await canvas.boundingBox())!
  await canvas.click({ position: { x: bounds.width * .66, y: bounds.height * .64 } })
  await expect.poll(async () => (await pixels(canvas)).visible).toBeGreaterThan(500)
  await page.getByRole('button', { name: '放大预览', exact: true }).click()
  await expect(page.getByRole('dialog').locator('.sound-field-surface canvas')).toHaveAttribute('data-renderer', 'three')
  await page.getByRole('button', { name: '关闭放大预览', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'artifacts/sound-field-mobile.png', fullPage: true })
  await expect(page.getByRole('alert')).toHaveCount(0); expect(errors).toEqual([])
})

test('3D desktop masks clip in scene coordinates; switching releases the Three context', async ({ page }) => {
  test.setTimeout(45000)
  await page.addInitScript(settings => localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings)), {
    ...defaults, effect: 'sound_field', bounds: { x: 0, y: 0, width: 1, height: 1 },
    masks: [{ id: 'left', bounds: { x: 0, y: 0, width: .5, height: 1 }, feather: 0 }],
  })
  await page.goto('/')
  const canvas = page.locator('.sound-field-surface canvas')
  await expect(canvas).toHaveAttribute('data-renderer', 'three')
  const image = await pixels(canvas)
  expect(image.left).toBe(0); expect(image.right).toBeGreaterThan(500)
  await canvas.evaluate(node => { (window as unknown as { __oldField: WebGL2RenderingContext }).__oldField = (node as HTMLCanvasElement).getContext('webgl2')! })
  await chooseStyle(page, '灯效', '浮光水母')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __oldField: WebGL2RenderingContext }).__oldField.isContextLost())).toBe(true)
  await expect(page.locator('.sound-field-surface')).toHaveCount(0)
})

test('live analysis expires, disabled scenes clear, and reduced motion creates no automatic drops', async ({ page }) => {
  test.setTimeout(45000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountSoundFieldProbe } = await import('/tests/fixtures/sound-field-probe.tsx')
    const probe = mountSoundFieldProbe()
    const state = { probe, timer: 0, live: true }
    ;(window as unknown as { __fieldProbe: typeof state }).__fieldProbe = state
    state.timer = window.setInterval(() => {
      if (state.live) probe.push({ rms: .15, bands: Array(6).fill(.45), spectrum: Array(48).fill(.6), skin: [] })
    }, 30)
  })
  const canvas = page.locator('#sound-field-probe canvas')
  await expect(canvas).toHaveAttribute('data-renderer', 'three')
  await expect.poll(async () => (await pixels(canvas)).visible).toBeGreaterThan(500)
  await expect(canvas).toHaveAttribute('data-drops', '0')
  await page.evaluate(() => (window as unknown as { __fieldProbe: { live: boolean } }).__fieldProbe.live = false)
  await expect.poll(async () => (await pixels(canvas)).visible, { timeout: 12000 }).toBe(0)
  await expect(canvas).toHaveAttribute('data-rms', '0.0000')
  await page.evaluate(() => (window as unknown as { __fieldProbe: { live: boolean } }).__fieldProbe.live = true)
  await expect.poll(async () => (await pixels(canvas)).visible).toBeGreaterThan(500)
  await page.evaluate(() => (window as unknown as { __fieldProbe: { probe: { active: (value: boolean) => void } } }).__fieldProbe.probe.active(false))
  // clear() is not an instanced draw, so sample the framebuffer directly after disabling.
  await expect.poll(() => canvas.evaluate((node: HTMLCanvasElement) => {
    const gl = node.getContext('webgl2')!, data = new Uint8Array(node.width * node.height * 4)
    gl.readPixels(0, 0, node.width, node.height, gl.RGBA, gl.UNSIGNED_BYTE, data)
    return data.some((value, i) => i % 4 === 3 && value > 8)
  })).toBe(false)
  await page.evaluate(() => {
    const state = (window as unknown as { __fieldProbe: { timer: number; probe: { dispose: () => void } } }).__fieldProbe
    clearInterval(state.timer); state.probe.dispose()
  })
})
