import * as T from 'three'
import type { SpectrumSettings } from '../../model'
import type { SceneMotion } from '../motion'
import { SceneCamera } from '../camera'
import { threeDrawingSize } from '../render-budget'
import { compositeFragment, passVertex } from '../composite'
import { createImmersiveScene } from './immersive/scenes'
import { isClassicEffect } from '../../music-engine/catalog'
import { resolveEffectPalette } from '../../effect-palette'
import { SceneBloom, bloomProfile } from './scene-bloom'

interface SpatialEffect {
  group: T.Group
  layout?(aspect: number): void
  update(motion: SceneMotion, config: SpectrumSettings, reduced: boolean): void
}
const viewpoints: Partial<Record<SpectrumSettings['effect'],readonly [number,number,number]>> = {
  rhythm_balls:[0,2,24],rhythm_rain:[0,5,24],rhythm_skin:[0,4,24],
  volume_rain:[0,5,24],
  ripple:[0,4,24],dream_stars:[0,2,24],vortex:[0,4,24],
}
const composite = `uniform float uSceneBrightness,uTransparentScene,uBloomStrength,uAirPhase;
uniform sampler2D uBloom0,uBloom1,uBloom2;
${compositeFragment}`.replace(
  'vec4 terrain = texture2D(uImage, uv);',
  `vec4 terrain = texture2D(uImage, uv);
   vec3 glow=(texture2D(uBloom0,uv).rgb*.5+texture2D(uBloom1,uv).rgb*.3+texture2D(uBloom2,uv).rgb*.2)*uBloomStrength;
   terrain.rgb=(terrain.rgb+glow)*uSceneBrightness;
   terrain.a=max(terrain.a,clamp(max(max(glow.r,glow.g),glow.b)*.6,0.,.45));`,
).replace(
  'vec3 backdrop = mix(uLow * .08, uLow * .24, uv.y) + uWarm * halo * .055;',
  'vec3 backdrop = mix(uLow * .12, uLow * .32, uv.y) + uWarm * halo * .035 + uLow*(.02+.01*sin(uv.x*9.+uAirPhase*.02)*cos(uv.y*7.-uAirPhase*.01));',
).replace('float backdropAlpha = .985 * uImmersive;', 'float backdropAlpha = uImmersive * (1. - uTransparentScene);')

/** Shared real-geometry stage for the seven music effects. */
export class ClassicSceneRenderer {
  readonly renderer: T.WebGLRenderer
  readonly scene = new T.Scene()
  readonly camera = new T.PerspectiveCamera(46, 1, .1, 180)
  private readonly image = new T.WebGLRenderTarget(1, 1, { samples: 4, type:T.HalfFloatType })
  private readonly bloom = new SceneBloom()
  private hdr = true
  private readonly postScene = new T.Scene()
  private readonly postCamera = new T.Camera()
  private readonly postGeometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3))
  private readonly viewpoint = new SceneCamera()
  private readonly basePosition = new T.Vector3()
  private readonly target = new T.Vector3()
  private readonly ray = new T.Raycaster()
  private readonly pointer = new T.Vector2()
  private readonly plane = new T.Plane(new T.Vector3(0,1,0),0)
  private readonly point = new T.Vector3()
  private readonly uniforms = {
    uImage: { value: this.image.texture }, uLow: { value: new T.Color() }, uWarm: { value: new T.Color() },
    uOpacity: { value: 0 }, uImmersive: { value: 0 }, uSceneBrightness: { value: 1 },
    uTransparentScene: { value: 0 },
    uBloom0:{value:this.bloom.texture(0)},uBloom1:{value:this.bloom.texture(1)},uBloom2:{value:this.bloom.texture(2)},
    uBloomStrength:{value:0},uAirPhase:{value:0},
    uResolution: { value: new T.Vector2(1,1) }, uRegion: { value: new T.Vector4() },
    uMasks: { value: Array.from({length:8},()=>new T.Vector4()) }, uFeather: { value: new Float32Array(8) }, uMaskCount: { value: 0 },
  }
  private readonly postMaterial = new T.ShaderMaterial({ uniforms:this.uniforms, vertexShader:passVertex, fragmentShader:composite,
    depthTest:false,depthWrite:false,blending:T.NoBlending,premultipliedAlpha:true })
  private effect: SpatialEffect | undefined
  private stamp = ''
  private count = 1
  private frames = 0
  private pixelRatio = 1

  private syncPointScale() {
    this.effect?.group.traverse(object => {
      const material = (object as T.Points).material
      for (const item of Array.isArray(material) ? material : [material]) {
        if (item instanceof T.ShaderMaterial && item.uniforms.uPixelRatio) item.uniforms.uPixelRatio.value = this.pixelRatio
      }
    })
  }

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({canvas,alpha:true,premultipliedAlpha:true,antialias:false,powerPreference:'high-performance'})
    this.renderer.setClearColor(0,0); this.renderer.toneMapping=T.ACESFilmicToneMapping; this.renderer.toneMappingExposure=.95
    this.hdr=this.renderer.extensions.has('EXT_color_buffer_float')
    if(!this.hdr)this.image.texture.type=T.UnsignedByteType
    this.renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{throw new Error([
      gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment),gl.getProgramInfoLog(program),
    ].filter(Boolean).join('\n')||'三维灯效初始化失败。')}
    const post=new T.Mesh(this.postGeometry,this.postMaterial);post.frustumCulled=false;this.postScene.add(post)
    canvas.dataset.engine=`three.js r${T.REVISION}`;canvas.dataset.geometry='spatial'
  }

  resize(config: SpectrumSettings,regionCount:number) {
    this.count=regionCount
    const size=threeDrawingSize(this.canvas.clientWidth,this.canvas.clientHeight,devicePixelRatio,config.quality,regionCount)
    this.renderer.setSize(size.width,size.height,false)
    this.pixelRatio = size.height / Math.max(1, this.canvas.clientHeight)
    this.syncPointScale()
    const samples=config.quality==='eco'?0:Math.min(4,this.renderer.capabilities.maxSamples)
    if(this.image.samples!==samples){this.image.samples=samples;this.image.dispose()}
    this.image.setSize(size.width,size.height);this.uniforms.uResolution.value.set(size.width,size.height)
    this.bloom.resize(size.width,size.height,config.quality,regionCount,this.hdr)
    this.camera.aspect=size.width/size.height;this.camera.updateProjectionMatrix()
    this.effect?.layout?.(this.camera.aspect)
  }

  private releaseEffect() {
    if(!this.effect)return
    const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>()
    this.effect.group.traverse(object=>{
      const mesh=object as T.Mesh
      if(mesh.geometry)geometries.add(mesh.geometry)
      if(Array.isArray(mesh.material))mesh.material.forEach(material=>materials.add(material))
      else if(mesh.material)materials.add(mesh.material)
      if(object instanceof T.InstancedMesh)object.dispose()
    })
    geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose())
    this.scene.remove(this.effect.group);this.effect=undefined
  }

  hit(clientX:number,clientY:number) {
    const box=this.canvas.getBoundingClientRect()
    this.pointer.set((clientX-box.left)/box.width*2-1,1-(clientY-box.top)/box.height*2)
    this.ray.setFromCamera(this.pointer,this.camera)
    if(!this.ray.ray.intersectPlane(this.plane,this.point))return null
    return {x:this.point.x,z:this.point.z}
  }

  draw(motion:SceneMotion,config:SpectrumSettings,reduced:boolean) {
    const detail=config.music.ambientDensity*(config.quality==='eco'?.65:config.quality==='balanced'?1:1.2)/Math.sqrt(this.count)
    const stamp=`${config.effect}:${detail}`
    if(stamp!==this.stamp){
      this.releaseEffect()
      if(!isClassicEffect(config.effect))throw new Error(`Unknown classic scene: ${config.effect}`)
      this.effect=createImmersiveScene(config.effect,detail)
      this.effect.layout?.(this.camera.aspect)
      this.syncPointScale()
      this.scene.add(this.effect.group);this.stamp=stamp
      this.plane.constant=0
      this.canvas.dataset.scene=config.effect
    }
    const palette=resolveEffectPalette(config)
    this.effect!.update(motion,config,reduced)
    const u=this.uniforms,b=config.bounds
    u.uLow.value.set(palette.low);u.uWarm.value.set(palette.accent)
    u.uOpacity.value=config.opacity/100*motion.presence;u.uImmersive.value=config.sceneMode==='immersive'?1:0
    const snow=config.effect==='ripple'
    u.uTransparentScene.value=snow?1:0
    u.uAirPhase.value=reduced?0:motion.phase
    u.uLow.value.multiplyScalar(snow?0:1);u.uWarm.value.multiplyScalar(snow?0:1)
    const softMaterial=config.effect==='rhythm_skin'
    u.uSceneBrightness.value=softMaterial?Math.min(.95,.68*Math.sqrt(config.music.fieldBrightness/45)):config.music.fieldBrightness/45
    u.uRegion.value.set(b.x,b.y,b.width,b.height);u.uMaskCount.value=config.masks.length
    config.masks.forEach((mask,i)=>{const b=mask.bounds;u.uMasks.value[i].set(b.x,b.y,b.width,b.height);u.uFeather.value[i]=mask.feather})
    const position=viewpoints[config.effect]??[0,9,30]
    // A wide, short desktop region otherwise creates an extreme horizontal
    // field of view and stretches rounded silhouettes at its edges. A longer
    // lens preserves the vertical framing and normal proportions of geometry.
    const geometric=config.effect==='rhythm_balls'
    const fov=geometric?Math.min(38,130/this.camera.aspect):62
    const lensScale=Math.tan(31*Math.PI/180)/Math.tan(fov*Math.PI/360)
    const scale=1.35/config.music.fieldScale*Math.max(1,1.15/this.camera.aspect)*lensScale
    this.basePosition.set(position[0]*scale,position[1]*scale,position[2]*scale)
    this.target.set(0,0,0)
    if(this.camera.fov!==fov){this.camera.fov=fov;this.camera.updateProjectionMatrix()}
    this.viewpoint.apply(this.camera,this.basePosition,this.target,config.view)
    // The dolly and narrow regions can move the camera beyond the old fixed
    // clipping distance. Enclosing environments also extend far behind origin.
    const far=Math.max(350,this.camera.position.distanceTo(this.target)+350)
    if(Math.abs(this.camera.far-far)>.1){this.camera.far=far;this.camera.updateProjectionMatrix()}
    this.renderer.setRenderTarget(this.image);this.renderer.render(this.scene,this.camera)
    const [threshold,strength]=bloomProfile(config.effect)
    this.bloom.draw(this.renderer,this.image.texture,threshold)
    u.uBloom0.value=this.bloom.texture(0);u.uBloom1.value=this.bloom.texture(1);u.uBloom2.value=this.bloom.texture(2);u.uBloomStrength.value=snow?0:strength
    this.renderer.setRenderTarget(null);this.renderer.render(this.postScene,this.postCamera)
    this.canvas.dataset.frames=String(++this.frames)
  }

  clear(){this.renderer.setRenderTarget(null);this.renderer.clear()}
  dispose(){this.releaseEffect();this.bloom.dispose();this.image.dispose();this.postGeometry.dispose();this.postMaterial.dispose();this.renderer.dispose()}
}
