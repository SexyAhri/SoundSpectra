import * as T from 'three'
import type { SpectrumSettings } from '../../model'
import type { SceneMotion } from '../motion'
import { threeDrawingSize } from '../render-budget'
import { compositeFragment, passVertex } from '../composite'
import { petalGeometry, auroraGeometry, dustGeometry } from './ambient-geometry'
import { petalVertex, petalFragment, dustVertex, dustFragment, trailFragment, coreVertex } from './ambient-shaders'
import { SceneCamera } from '../camera'
import { auroraVertex, auroraFragment } from './aurora-shaders'
import { flightSheetGeometry, orbitVertex, orbitFragment, ribbonVertex, ribbonFragment, flightStarFragment } from './star-flight'

const palettes = {
  iris: ['#12192f', '#799fd1', '#c4a4e0', '#f4debd'],
  ember: ['#261925', '#a585ba', '#e4a578', '#f7dfb1'],
  lake: ['#0c2330', '#789bd9', '#73d9be', '#bce8ea'],
} as const
const flightPalettes = {
  iris: ['#10152e', '#719ac6', '#ae8aba', '#ebd8b9'],
  ember: ['#211026', '#a48dbb', '#cfa77d', '#eedfc6'],
  lake: ['#081e2c', '#719bc5', '#83bfbc', '#d6e8e3'],
} as const
const auroraPalettes = {
  iris: ['#0b1720', '#4c91aa', '#6dd4a3', '#a28fb8'],
  ember: ['#1d1420', '#a07ea4', '#d2b18c', '#bca6ca'],
  lake: ['#0b1722', '#4d91bd', '#63c6be', '#93b8d5'],
} as const

/** Actual mesh petals, layered 3D curtains and depth-projected star travel. */
export class AmbientSceneRenderer {
  readonly renderer: T.WebGLRenderer
  readonly scene = new T.Scene()
  readonly camera = new T.PerspectiveCamera(46, 1, .1, 160)
  private readonly root = new T.Group()
  private readonly image = new T.WebGLRenderTarget(1, 1, { samples: 4 })
  private readonly postScene = new T.Scene()
  private readonly postCamera = new T.Camera()
  private readonly postGeometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([-1,-1,0, 3,-1,0, -1,3,0], 3))
  private readonly ray = new T.Raycaster()
  private readonly plane = new T.Plane(new T.Vector3(0, 0, 1), 0)
  private readonly point = new T.Vector3()
  private readonly ndc = new T.Vector2()
  private readonly pointer = new T.Vector2()
  private readonly viewpoint = new SceneCamera()
  private readonly basePosition = new T.Vector3()
  private readonly target = new T.Vector3(0, 0, -5)
  private readonly uniforms = {
    uAuroraPhase: { value: 0 }, uPhase: { value: 0 }, uVolume: { value: 0 }, uBands: { value: new T.Vector3() },
    uSpectrum: { value: new Float32Array(48) }, uTouch: { value: 0 }, uPointer: { value: new T.Vector2() },
    uSpread: { value: 1 }, uBrightness: { value: 1 }, uMode: { value: 0 },
    uLow: { value: new T.Color() }, uMid: { value: new T.Color() }, uWarm: { value: new T.Color() }, uHigh: { value: new T.Color() },
    uImage: { value: this.image.texture }, uOpacity: { value: 0 }, uImmersive: { value: 0 },
    uResolution: { value: new T.Vector2(1, 1) }, uRegion: { value: new T.Vector4() },
    uMasks: { value: Array.from({ length: 8 }, () => new T.Vector4()) }, uFeather: { value: new Float32Array(8) }, uMaskCount: { value: 0 },
  }
  private readonly postMaterial = new T.ShaderMaterial({ uniforms: this.uniforms, vertexShader: passVertex, fragmentShader: compositeFragment,
    depthTest: false, depthWrite: false, blending: T.NoBlending, premultipliedAlpha: true })
  private regionCount = 1
  private stamp = ''
  private frames = 0

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' })
    this.renderer.setClearColor(0, 0); this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .95
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      throw new Error(gl.getProgramInfoLog(program) || gl.getShaderInfoLog(vertex) || gl.getShaderInfoLog(fragment) || '三维场景初始化失败。')
    }
    this.scene.add(this.root)
    const post = new T.Mesh(this.postGeometry, this.postMaterial); post.frustumCulled = false; this.postScene.add(post)
    canvas.dataset.heightPass = 'geometry'
  }

  resize(config: SpectrumSettings, regionCount: number) {
    this.regionCount = regionCount
    const size = threeDrawingSize(this.canvas.clientWidth, this.canvas.clientHeight, devicePixelRatio, config.quality, regionCount)
    this.renderer.setSize(size.width, size.height, false)
    // Preserve low-light curtain gradients before the final color conversion.
    const imageType = config.effect === 'aurora_flow' ? T.HalfFloatType : T.UnsignedByteType
    if (this.image.texture.type !== imageType) { this.image.texture.type = imageType; this.image.dispose() }
    const samples = config.quality === 'eco' ? 0 : Math.min(4, this.renderer.capabilities.maxSamples)
    if (this.image.samples !== samples) { this.image.samples = samples; this.image.dispose() }
    this.image.setSize(size.width, size.height); this.uniforms.uResolution.value.set(size.width, size.height)
    this.camera.aspect = size.width / size.height; this.camera.updateProjectionMatrix()
  }

  private material(vertexShader: string, fragmentShader: string, additive = false) {
    return new T.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader, transparent: true,
      depthWrite: false, side: T.DoubleSide, blending: additive ? T.AdditiveBlending : T.NormalBlending,
      premultipliedAlpha: additive, toneMapped: false })
  }

  private clearObjects() {
    this.root.traverse(object => {
      const mesh = object as T.Mesh
      mesh.geometry?.dispose()
      if (Array.isArray(mesh.material)) mesh.material.forEach(material => material.dispose())
      else mesh.material?.dispose()
    })
    this.root.clear()
  }

  private build(config: SpectrumSettings) {
    this.clearObjects()
    const detail = config.music.ambientDensity * (config.quality === 'eco' ? .7 : config.quality === 'balanced' ? 1 : 1.3) / Math.sqrt(Math.max(1, this.regionCount))
    const flight = config.effect === 'star_flight', aurora = config.effect === 'aurora_flow'
    this.uniforms.uMode.value = flight ? 1 : aurora ? 2 : 0
    if (!flight) {
      const surface = new T.Mesh(aurora ? auroraGeometry(detail) : petalGeometry(detail),
        this.material(aurora ? auroraVertex : petalVertex, aurora ? auroraFragment : petalFragment, aurora))
      surface.frustumCulled = false; this.root.add(surface)
      if (!aurora) {
        const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([-3.6,.2,-3, 5.6,-1.6,-7, 6.7,4.5,-15], 3))
        const cores = new T.Points(geometry, this.material(coreVertex, dustFragment, true)); cores.frustumCulled = false; this.root.add(cores)
      }
    }
    const count = Math.max(120, Math.round((flight ? 1500 : aurora ? 450 : 650) * detail))
    const stars = new T.Points(dustGeometry(count), this.material(dustVertex, flight ? flightStarFragment : dustFragment, true))
    stars.frustumCulled = false; this.root.add(stars)
    if (flight) {
      const trails = new T.LineSegments(dustGeometry(count, true), this.material(dustVertex, trailFragment, true))
      trails.frustumCulled = false; this.root.add(trails)
      const segments = Math.max(96, Math.round(160 * Math.min(detail, 1.4)))
      const orbits = new T.Mesh(flightSheetGeometry(5, segments), this.material(orbitVertex, orbitFragment, true))
      orbits.frustumCulled = false; this.root.add(orbits)
      const ribbons = new T.Mesh(flightSheetGeometry(2, segments), this.material(ribbonVertex, ribbonFragment, true))
      ribbons.frustumCulled = false; this.root.add(ribbons)
    }
    this.canvas.dataset.scene = config.effect; this.canvas.dataset.items = String(count)
  }

  hover(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2)
  }

  hit(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect()
    this.ndc.set((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2)
    this.ray.setFromCamera(this.ndc, this.camera)
    return this.ray.ray.intersectPlane(this.plane, this.point) ? { x: this.point.x, z: this.point.y } : null
  }

  draw(motion: SceneMotion, config: SpectrumSettings, reduced: boolean) {
    const stamp = `${config.effect}:${config.quality}:${config.music.ambientDensity}:${this.regionCount}`
    if (stamp !== this.stamp) { this.build(config); this.stamp = stamp }
    const u = this.uniforms, palette = (config.effect === 'star_flight' ? flightPalettes : config.effect === 'aurora_flow' ? auroraPalettes : palettes)[config.music.fieldPalette]
    u.uLow.value.set(palette[0]); u.uMid.value.set(palette[1]); u.uWarm.value.set(palette[2]); u.uHigh.value.set(palette[3])
    u.uAuroraPhase.value = motion.auroraPhase; u.uPhase.value = motion.phase; u.uVolume.value = motion.volume
    u.uBands.value.set(motion.bass, motion.middle, motion.treble)
    if (motion.frame) u.uSpectrum.value.set(motion.frame.spectrum); else u.uSpectrum.value.fill(0)
    u.uTouch.value = motion.ripples.reduce((value, ripple) => ripple.source === 'pointer' ? Math.max(value, Math.exp(-ripple.lifetime * 1.2)) : value, 0)
    u.uSpread.value = config.music.ambientSpread; u.uBrightness.value = config.music.fieldBrightness / 45
    u.uOpacity.value = config.opacity / 100 * motion.presence; u.uImmersive.value = config.sceneMode === 'immersive' ? 1 : 0
    const b = config.bounds; u.uRegion.value.set(b.x,b.y,b.width,b.height); u.uMaskCount.value = config.masks.length
    config.masks.forEach((mask, i) => { const b = mask.bounds; u.uMasks.value[i].set(b.x,b.y,b.width,b.height); u.uFeather.value[i] = mask.feather })
    const ease = reduced ? 1 : 1 - Math.exp(-(motion.frame?.dt ?? 16.67) / 100)
    u.uPointer.value.lerp(this.pointer, ease)
    const scale = config.music.fieldScale / 1.35, flight = config.effect === 'star_flight'
    const distance = config.effect === 'petal_bloom' ? 12 : flight ? 16 : 22
    this.basePosition.set(0, flight ? 0 : 1, distance / scale * Math.max(1, 1.2 / this.camera.aspect))
    this.viewpoint.apply(this.camera, this.basePosition, this.target, config.view)
    this.renderer.setRenderTarget(this.image); this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(null); this.renderer.render(this.postScene, this.postCamera)
    this.canvas.dataset.frames = String(++this.frames)
  }

  clear() { this.renderer.clear() }
  dispose() { this.clearObjects(); this.image.dispose(); this.postGeometry.dispose(); this.postMaterial.dispose(); this.renderer.dispose() }
}
