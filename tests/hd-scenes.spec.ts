import { expect, test } from '@playwright/test'

test('HD quality resizes the scene and keeps snow at the same apparent size', async ({ page }) => {
  await page.route('**/hd-probe', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"></body>' }))
  await page.goto('/hd-probe')
  const result = await page.evaluate(async () => {
    const { ClassicSceneRenderer } = await import('/src/features/spectrum/three/classic/classic-renderer.ts')
    const { SceneMotion } = await import('/src/features/spectrum/three/motion.ts')
    const { defaults } = await import('/src/features/spectrum/model.ts')
    const { demoAnalysis } = await import('/src/features/spectrum/music-analysis.ts')
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:640px;height:360px'; document.body.append(canvas)
    const world = new ClassicSceneRenderer(canvas), motion = new SceneMotion(), samples = []
    const base = { ...defaults, effect: 'ripple' as const, bounds: { x: 0, y: 0, width: 1, height: 1 } }
    for (let i = 0; i < 30; i++) motion.step(demoAnalysis(i / 60), 1 / 60, base.music, false)
    try {
      for (const quality of ['balanced', 'smooth', 'balanced'] as const) {
        // Hold particle density fixed so this compares resolution, not the
        // additional particles intentionally enabled by the smooth preset.
        const settings = { ...base, quality, music: { ...base.music, ambientDensity: quality === 'smooth' ? 1 / 1.2 : 1 } }
        world.resize(settings, 1); world.draw(motion, settings, false)
        const scales: number[] = []
        world.scene.traverse(object => {
          const material = (object as unknown as { material?: { uniforms?: { uPixelRatio?: { value: number } } } }).material
          if (material?.uniforms?.uPixelRatio) scales.push(material.uniforms.uPixelRatio.value)
        })
        const gl = world.renderer.getContext(), data = new Uint8Array(canvas.width * canvas.height * 4)
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data)
        let coverage = 0
        for (let i = 3; i < data.length; i += 4) coverage += data[i] / 255
        samples.push({ width: canvas.width, height: canvas.height, scales, coverage: coverage / (canvas.width * canvas.height), error: gl.getError() })
      }
      return samples
    } finally { world.dispose(); world.renderer.forceContextLoss(); canvas.remove() }
  })
  expect(result[0]).toMatchObject({ width: 800, height: 450, error: 0 })
  expect(result[1]).toMatchObject({ width: 960, height: 540, error: 0 })
  expect(result[2]).toMatchObject({ width: 800, height: 450, error: 0 })
  for (const sample of result) {
    expect(sample.scales.length).toBeGreaterThan(0)
    expect(sample.scales.every(scale => scale === sample.height / 360)).toBe(true)
    expect(sample.coverage).toBeGreaterThan(.0001)
  }
  expect(result[1].coverage / result[0].coverage).toBeGreaterThan(.8)
  expect(result[1].coverage / result[0].coverage).toBeLessThan(1.2)
})
