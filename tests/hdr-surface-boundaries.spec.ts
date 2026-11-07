import { expect, test } from '@playwright/test'
import { visualProbeHtml } from '../scripts/visual-probe-html.mjs'

test('aurora edge helper samples keep the transparent HDR falloff finite', async ({ page }) => {
  await page.route('**/aurora-boundary-probe', route => route.fulfill({ contentType: 'text/html', body: visualProbeHtml('<body></body>') }))
  await page.goto('/aurora-boundary-probe')
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js')
    const { auroraFragment } = await import('/src/features/spectrum/three/ambient/aurora-shaders.ts')
    const { SceneBloom } = await import('/src/features/spectrum/three/classic/scene-bloom.ts')
    const canvas = document.createElement('canvas'), renderer = new T.WebGLRenderer({ canvas })
    renderer.setSize(256, 256)
    const target = new T.WebGLRenderTarget(256, 256, { type: T.HalfFloatType }), bloom = new SceneBloom()
    bloom.resize(256, 256, 'balanced', 1, true)
    const geometry = new T.PlaneGeometry(2, 2), scene = new T.Scene(), camera = new T.Camera()
    // Thin, perspective-projected triangles can extrapolate helper samples far
    // outside their UV range. Exercise both exterior limits and the visible rim.
    const material = new T.ShaderMaterial({ fragmentShader: auroraFragment,
      vertexShader: `varying vec2 vUv;varying float vLayer,vEnergy;
        void main(){vUv=vec2(uv.x,uv.y*202.-101.);vLayer=1.;vEnergy=.4;gl_Position=vec4(position,1.);}`,
      uniforms: { uAuroraPhase:{value:266.22},uImpulse:{value:.8},uBands:{value:new T.Vector3(.3,.4,.2)},
        uBrightness:{value:1},uWarm:{value:new T.Color('#54ccbd')},uMid:{value:new T.Color('#4a96d9')},uHigh:{value:new T.Color('#aad9ff')} },
      depthTest:false,blending:T.NoBlending })
    scene.add(new T.Mesh(geometry, material))
    try {
      renderer.setRenderTarget(target);renderer.render(scene,camera);bloom.draw(renderer,target.texture,.2)
      let invalid=0,negative=0,lit=0
      for(const source of [target,...(bloom as any).levels.slice(0,bloom.count).flat()]){
        const pixels=new Uint16Array(source.width*source.height*4)
        renderer.readRenderTargetPixels(source,0,0,source.width,source.height,pixels)
        for(const bits of pixels){const v=T.DataUtils.fromHalfFloat(bits);invalid+=Number(!Number.isFinite(v));negative+=Number(v<-.001);lit+=Number(v>.001)}
      }
      return {invalid,negative,lit,error:renderer.getContext().getError()}
    } finally { material.dispose();geometry.dispose();target.dispose();bloom.dispose();renderer.dispose();renderer.forceContextLoss() }
  })
  expect(result).toMatchObject({invalid:0,negative:0,error:0});expect(result.lit).toBeGreaterThan(10)
})

test('face-on silk and jellyfish surfaces keep source and bloom finite across normal directions', async ({ page }) => {
  await page.route('**/surface-boundary-probe', route => route.fulfill({ contentType: 'text/html', body: visualProbeHtml('<body></body>') }))
  await page.goto('/surface-boundary-probe')
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js')
    const { createJellyfishGarden } = await import('/src/features/spectrum/three/classic/immersive/jellyfish-garden.ts')
    const { createWindSilk } = await import('/src/features/spectrum/three/classic/immersive/wind-silk.ts')
    const { disposeVisualTree } = await import('/src/features/spectrum/three/r3f/resources.ts')
    const { SceneBloom } = await import('/src/features/spectrum/three/classic/scene-bloom.ts')
    const canvas = document.createElement('canvas'), renderer = new T.WebGLRenderer({ canvas })
    renderer.setSize(256, 256)
    const source = new T.WebGLRenderTarget(256, 256, { type: T.HalfFloatType }), bloom = new SceneBloom()
    bloom.resize(256, 256, 'balanced', 1, true)
    const plane = new T.PlaneGeometry(2, 2), geometry = new T.InstancedBufferGeometry()
    geometry.setIndex(plane.index); geometry.setAttribute('position', plane.attributes.position); geometry.setAttribute('uv', plane.attributes.uv)
    const normals = [], tiles = []
    // Cover many almost face-on normals, including the roundoff boundary where
    // dot(normalize(n), normalize(view)) can exceed one by a float ULP.
    for (let i = 0; i < 256; i++) {
      const angle = i * 2.399963, z = -.99 + 1.98 * (i + .5) / 256, radius = Math.sqrt(1 - z * z)
      normals.push(Math.cos(angle) * radius, z, Math.sin(angle) * radius); tiles.push(i % 16, Math.floor(i / 16))
    }
    geometry.setAttribute('aNormal', new T.InstancedBufferAttribute(new Float32Array(normals), 3))
    geometry.setAttribute('aTile', new T.InstancedBufferAttribute(new Float32Array(tiles), 2)); geometry.instanceCount = 256
    const vertex = `attribute vec3 aNormal;attribute vec2 aTile;
      varying vec3 vWorld;varying vec2 vUv;varying float vLane,vAlpha,vLight;
      void main(){vec3 n=normalize(aNormal),side=normalize(cross(n,vec3(0.,1.,0.))),up=cross(n,side);
        vWorld=n*1000.+side*position.x+up*position.y;vUv=uv;vLane=aTile.x;vAlpha=.5;vLight=.3;
        gl_Position=vec4((position.xy+1.+aTile*2.)/16.-1.,0.,1.);}`
    const scenes = [createJellyfishGarden(), createWindSilk(1)], results = []
    try {
      for (let index = 0; index < scenes.length; index++) {
        const original = scenes[index].group.children.map(o => (o as T.Mesh).material as T.ShaderMaterial)
          .find(m => m?.fragmentShader?.includes(index ? 'float grazing=' : 'float diffuse=.2+'))!
        if (!original) throw Error('Authored surface material missing')
        const material = original.clone(); material.vertexShader = vertex; material.depthTest = false; material.blending = T.NoBlending
        const scene = new T.Scene(), camera = new T.Camera(), mesh = new T.Mesh(geometry, material); mesh.frustumCulled = false; scene.add(mesh)
        renderer.setRenderTarget(source); renderer.render(scene, camera); bloom.draw(renderer, source.texture, .2)
        let invalid = 0, negative = 0
        for (const target of [source, ...(bloom as any).levels.slice(0, bloom.count).flat()]) {
          const data = new Uint16Array(target.width * target.height * 4)
          renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, data)
          for (const bits of data) { const value = T.DataUtils.fromHalfFloat(bits); invalid += Number(!Number.isFinite(value)); negative += Number(value < -.001) }
        }
        results.push({ effect: index ? 'rhythm_skin' : 'rhythm_balls', invalid, negative, error: renderer.getContext().getError() }); material.dispose()
      }
      return results
    } finally {
      scenes.forEach(s => disposeVisualTree(s.group)); geometry.dispose(); plane.dispose(); source.dispose(); bloom.dispose(); renderer.dispose(); renderer.forceContextLoss()
    }
  })
  for (const row of result) expect(row, JSON.stringify(row)).toMatchObject({ invalid: 0, negative: 0, error: 0 })
})
