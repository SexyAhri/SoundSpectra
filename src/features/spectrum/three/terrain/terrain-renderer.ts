import * as T from 'three'
import type { SpectrumSettings } from '../../model'
import { FIELD_SIZE, SceneMotion } from '../motion'
import { threeDrawingSize } from '../render-budget'
import { fieldVertex, fieldFragment } from './terrain-shaders'
import { passVertex, compositeFragment } from '../composite'
import { heightFragment } from './height-shader'
import { SceneCamera } from '../camera'
import { resolveEffectPalette } from '../../effect-palette'


/** GPU height field, solid terrain, then one compositing pass for wallpaper and masks. */
export class SoundFieldRenderer {
  readonly renderer: T.WebGLRenderer
  readonly scene = new T.Scene()
  readonly camera = new T.PerspectiveCamera(48, 1, .1, 160)
  private readonly ray = new T.Raycaster()
  private readonly plane = new T.Plane(new T.Vector3(0, 1, 0), 0)
  private readonly intersection = new T.Vector3()
  private readonly pointer = new T.Vector2()
  private readonly target = new T.Vector3(0, 1.6, -5)
  private readonly basePosition = new T.Vector3()
  private readonly viewpoint = new SceneCamera()
  private readonly heightTarget = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: false })
  private readonly image = new T.WebGLRenderTarget(1, 1, { samples: 4 })
  private readonly heightScene = new T.Scene()
  private readonly compositeScene = new T.Scene()
  private readonly passCamera = new T.Camera()
  private readonly passGeometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([-1,-1,0, 3,-1,0, -1,3,0], 3))
  private readonly heightUniforms = {
    uSeeds: { value: null as T.DataTexture | null }, uSpectrum: { value: new Float32Array(48) },
    uLevels: { value: new T.Vector4() }, uPhase: { value: 0 }, uHeight: { value: 1 },
    uSpeed: { value: 1 }, uSize: { value: FIELD_SIZE }, uGrid: { value: 1 },
    uRipples: { value: Array.from({ length: 12 }, () => new T.Vector4()) },
    uPointer: { value: new Float32Array(12) }, uRippleCount: { value: 0 },
  }
  private readonly uniforms = {
    uField: { value: this.heightTarget.texture }, uCell: { value: 1 }, uImage: { value: this.image.texture },
    uLow: { value: new T.Color() }, uMid: { value: new T.Color() }, uWarm: { value: new T.Color() }, uHigh: { value: new T.Color() },
    uBrightness: { value: 1 }, uOpacity: { value: 0 }, uImmersive: { value: 0 },
    uResolution: { value: new T.Vector2(1, 1) }, uRegion: { value: new T.Vector4() },
    uMasks: { value: Array.from({ length: 8 }, () => new T.Vector4()) },
    uFeather: { value: new Float32Array(8) }, uMaskCount: { value: 0 },
  }
  private readonly layers: Array<T.Mesh<T.BufferGeometry, T.ShaderMaterial>> = []
  private texture: T.DataTexture | null = null
  private offsets = new Float32Array(0)
  private seeds = new Float32Array(0)
  private grid = 0
  private frames = 0
  private config: SpectrumSettings | null = null
  private readonly heightMaterial = new T.ShaderMaterial({ uniforms: this.heightUniforms, vertexShader: passVertex, fragmentShader: heightFragment, depthTest: false, depthWrite: false, blending: T.NoBlending, toneMapped: false })
  private readonly compositeMaterial = new T.ShaderMaterial({ uniforms: this.uniforms, vertexShader: passVertex, fragmentShader: compositeFragment, depthTest: false, depthWrite: false, blending: T.NoBlending, premultipliedAlpha: true })

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.toneMapping = T.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = .9
    const heightPass = new T.Mesh(this.passGeometry, this.heightMaterial), compositePass = new T.Mesh(this.passGeometry, this.compositeMaterial)
    heightPass.frustumCulled = false; compositePass.frustumCulled = false
    this.heightScene.add(heightPass); this.compositeScene.add(compositePass)
    this.canvas.dataset.heightPass = 'gpu'
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      throw new Error(gl.getProgramInfoLog(program) || gl.getShaderInfoLog(vertex) || gl.getShaderInfoLog(fragment) || '三维声场着色器初始化失败。')
    }
  }

  resize(config: SpectrumSettings, regionCount: number) {
    const size = threeDrawingSize(this.canvas.clientWidth, this.canvas.clientHeight, devicePixelRatio, config.quality, regionCount)
    this.renderer.setSize(size.width, size.height, false)
    const samples = config.quality === 'eco' ? 0 : Math.min(4, this.renderer.capabilities.maxSamples)
    if (this.image.samples !== samples) {
      this.image.samples = samples
      // setSize alone keeps the old framebuffer when dimensions have not changed.
      this.image.dispose()
    }
    this.image.setSize(size.width, size.height)
    this.uniforms.uResolution.value.set(size.width, size.height)
    this.camera.aspect = size.width / size.height
    this.camera.updateProjectionMatrix()
    const density = config.quality === 'eco' ? 72 : config.quality === 'balanced' ? 128 : 160
    const grid = Math.max(32, Math.floor(density / Math.sqrt(Math.max(1, regionCount))))
    if (grid !== this.grid) this.buildGrid(grid)
  }

  private disposeGrid() {
    for (const object of this.layers) {
      this.scene.remove(object); object.geometry.dispose(); object.material.dispose()
    }
    this.texture?.dispose(); this.texture = null; this.layers.length = 0
  }

  private buildGrid(grid: number) {
    this.disposeGrid(); this.grid = grid
    const count = grid * grid, step = FIELD_SIZE / grid
    this.offsets = new Float32Array(count * 2)
    this.seeds = new Float32Array(count)
    const uv = new Float32Array(count * 2)
    const seedData = new Float32Array(count * 4)
    let random = 9351
    for (let z = 0; z < grid; z++) for (let x = 0; x < grid; x++) {
      const i = z * grid + x
      this.offsets[i * 2] = (x + .5) * step - FIELD_SIZE / 2
      this.offsets[i * 2 + 1] = (z + .5) * step - FIELD_SIZE / 2
      uv[i * 2] = (x + .5) / grid; uv[i * 2 + 1] = (z + .5) / grid
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      this.seeds[i] = random / 4294967296
      seedData[i * 4] = this.seeds[i]
    }
    this.texture = new T.DataTexture(seedData, grid, grid, T.RGBAFormat, T.FloatType)
    this.texture.needsUpdate = true; this.heightUniforms.uSeeds.value = this.texture
    this.heightTarget.setSize(grid, grid); this.heightUniforms.uGrid.value = grid; this.uniforms.uCell.value = step
    const s = step / 2, geometry = new T.InstancedBufferGeometry()
    geometry.setAttribute('position', new T.Float32BufferAttribute([-s,0,-s, s,0,-s, s,0,s, -s,0,s, -s,1,-s, s,1,-s, s,1,s, -s,1,s], 3))
    geometry.setIndex([4,7,6,4,6,5, 3,2,6,3,6,7, 0,4,5,0,5,1, 1,5,6,1,6,2, 0,3,7,0,7,4, 0,1,2,0,2,3])
    geometry.setAttribute('aOffset', new T.InstancedBufferAttribute(this.offsets, 2))
    geometry.setAttribute('aSample', new T.InstancedBufferAttribute(uv, 2))
    geometry.setAttribute('aSeed', new T.InstancedBufferAttribute(this.seeds, 1))
    geometry.instanceCount = count
    const material = new T.ShaderMaterial({ uniforms: this.uniforms, vertexShader: fieldVertex, fragmentShader: fieldFragment,
      depthWrite: true, blending: T.NoBlending, toneMapped: false })
    const mesh = new T.Mesh(geometry, material); mesh.frustumCulled = false; this.scene.add(mesh)
    this.layers.push(mesh)
    this.canvas.dataset.cells = String(count)
  }

  hit(clientX: number, clientY: number) {
    const box = this.canvas.getBoundingClientRect()
    this.pointer.set((clientX - box.left) / box.width * 2 - 1, -(clientY - box.top) / box.height * 2 + 1)
    this.ray.setFromCamera(this.pointer, this.camera)
    if (this.ray.ray.intersectPlane(this.plane, this.intersection) && Math.abs(this.intersection.x) <= FIELD_SIZE / 2 && Math.abs(this.intersection.z) <= FIELD_SIZE / 2) {
      return { x: this.intersection.x, z: this.intersection.z }
    }
    return null
  }

  draw(motion: SceneMotion, config: SpectrumSettings, _reduced: boolean) {
    if (this.config !== config) {
      const palette = resolveEffectPalette(config)
      this.uniforms.uLow.value.set(palette.low); this.uniforms.uMid.value.set(palette.main); this.uniforms.uWarm.value.set(palette.accent); this.uniforms.uHigh.value.set(palette.high)
      this.uniforms.uBrightness.value = config.music.fieldBrightness / 45 * 1.12
      this.uniforms.uImmersive.value = config.sceneMode === 'immersive' ? 1 : 0
      const b = config.bounds; this.uniforms.uRegion.value.set(b.x, b.y, b.width, b.height)
      this.uniforms.uMaskCount.value = config.masks.length
      config.masks.forEach((mask, i) => { const b = mask.bounds; this.uniforms.uMasks.value[i].set(b.x, b.y, b.width, b.height); this.uniforms.uFeather.value[i] = mask.feather })
      this.config = config
    }
    this.uniforms.uOpacity.value = config.opacity / 100 * motion.presence
    const h = this.heightUniforms
    if (motion.frame) h.uSpectrum.value.set(motion.frame.spectrum)
    else h.uSpectrum.value.fill(0)
    h.uLevels.value.set(motion.volume, motion.bass, motion.middle, motion.treble)
    h.uPhase.value = motion.phase; h.uHeight.value = config.music.fieldHeight
    h.uSpeed.value = (2.9 + config.music.speed * .35) * config.music.fieldSpread
    h.uRippleCount.value = motion.ripples.length
    motion.ripples.forEach((ripple, i) => {
      // The shader already attenuates spatial age. Account for elapsed time while
      // propagation was frozen so reduced-motion touches fade in place.
      const strength = ripple.strength * Math.exp(-Math.max(0, ripple.lifetime - ripple.age) * .36)
      h.uRipples.value[i].set(ripple.x, ripple.z, ripple.age, strength)
      h.uPointer.value[i] = ripple.source === 'pointer' ? 1 : 0
    })
    const scale = config.music.fieldScale
    this.basePosition.set(Math.sin(.06) * 42 / scale, 24 / scale, Math.cos(.06) * 42 / scale - 5)
    this.viewpoint.apply(this.camera, this.basePosition, this.target, config.view)
    this.renderer.setRenderTarget(this.heightTarget); this.renderer.render(this.heightScene, this.passCamera)
    this.renderer.setRenderTarget(this.image); this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(null); this.renderer.render(this.compositeScene, this.passCamera)
    this.canvas.dataset.frames = String(++this.frames)
  }

  clear() { this.renderer.clear() }
  dispose() {
    this.disposeGrid(); this.heightTarget.dispose(); this.image.dispose()
    this.passGeometry.dispose(); this.heightMaterial.dispose(); this.compositeMaterial.dispose(); this.renderer.dispose()
  }
}
