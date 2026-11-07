import { test, expect } from '@playwright/test'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

test('Windows native scenes switch and restore when KHR completion never reports ready', async ({ page }) => {
  await page.route('**/native-preparation-probe', route => route.fulfill({ contentType: 'text/html', body: visualProbeHtml('<body></body>') }))
  await page.goto('/native-preparation-probe')
  const result = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Windows native preparation regression' })
    Object.assign(window, { isTauri: true })
    const { FiberSceneRenderer } = await import('/src/features/spectrum/three/r3f/fiber-renderer.tsx')
    const { SceneMotion } = await import('/src/features/spectrum/three/motion.ts')
    const { defaults } = await import('/src/features/spectrum/model.ts')
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'width:256px;height:144px'
    document.body.append(canvas)
    const errors: string[] = [], world = new FiberSceneRenderer(canvas, error => errors.push(String(error)))
    const gl = world.renderer.getContext(), parameter = gl.getProgramParameter.bind(gl)
    gl.getProgramParameter = (program, name) => name === 0x91B1 ? false : parameter(program, name)
    const motion = new SceneMotion(), scenes: string[] = []
    try {
      const base = { ...defaults, effect: 'tidal_knot' as const, quality: 'eco' as const }
      await world.resize(base, 1)
      world.draw(motion, base, false)
      for (const effect of ['echo_corridor', 'layered_tides', 'tidal_knot'] as const) {
        const target = { ...base, effect }, until = performance.now() + 2500
        do {
          world.draw(motion, target, false, 1 / 60, undefined, false, { animate: false, transition: { kind: 'dissolve', durationMs: 200 }, mapping: { preset: 'original', source: 'bass', target: 'bend', amount: 0, curve: 'linear' } })
          if (canvas.dataset.scene === effect && canvas.dataset.preparing === 'false') break
          await new Promise(resolve => setTimeout(resolve, 10))
        } while (performance.now() < until)
        scenes.push(canvas.dataset.scene ?? '')
      }
      return { scenes, errors, glError: gl.getError() }
    } finally {
      world.dispose()
      world.renderer.forceContextLoss()
      canvas.remove()
    }
  })
  expect(result).toEqual({ scenes: ['echo_corridor', 'layered_tides', 'tidal_knot'], errors: [], glError: 0 })
})
