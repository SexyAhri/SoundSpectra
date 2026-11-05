import * as T from 'three'
import type { SpectrumSettings } from '../../../model'
import type { SceneMotion } from '../../motion'

export interface KineticEffect {
  group: T.Group
  update(motion: SceneMotion, config: SpectrumSettings, reduced: boolean): void
}
export const TAU = Math.PI * 2
export const unit = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0))
export const fract = (n: number) => n - Math.floor(n)
export const random = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453123)
export const spectral = (motion: SceneMotion, location: number) => {
  const bins = motion.frame?.spectrum
  if (!bins?.length) return 0
  const p = unit(location) * (bins.length - 1), i = Math.floor(p)
  const j=Math.min(i+1,bins.length-1),f=p-i
  const normalized=bins[i]*(1-f)+bins[j]*f
  const shape=motion.spectralShape[i]*(1-f)+motion.spectralShape[j]*f
  return unit((normalized*.18+shape*.82)*motion.volume)
}
export const touchEnergy = (motion: SceneMotion) => motion.ripples.reduce((peak, ripple) =>
  ripple.source === 'pointer' ? Math.max(peak, Math.exp(-ripple.lifetime * 2)) : peak, 0)

/** A transport clock, not a beat generator. No motion advances without a live audible frame. */
export class AudioClock {
  time = 0
  dt = 0
  reset = false
  private last = -1
  step(motion: SceneMotion, reduced: boolean, speed = 1) {
    const frame = motion.frame
    this.reset = !frame || frame.now < this.last
    this.dt = frame && frame.now !== this.last ? Math.max(0, Math.min(.1, frame.dt / 1000)) : 0
    if (this.reset) this.time = 0
    if (!frame) { this.last = -1; return this.time }
    if (!reduced && frame.audible) this.time += this.dt * speed * (.45 + motion.volume * 1.8)
    this.last = frame.now
    return this.time
  }
}

export class Tint {
  readonly cool = new T.Color()
  readonly warm = new T.Color()
  readonly high = new T.Color()
  readonly body = new T.Color()
  readonly scratch = new T.Color()
  private readonly pale = new T.Color('#d6f3ff')
  private key = ''
  update(config: SpectrumSettings) {
    const key = `${config.color}:${config.music.fieldPalette}`
    if (this.key === key) return
    this.key = key
    this.cool.set(config.color)
    this.warm.set(config.music.fieldPalette === 'ember' ? '#ef7146' : config.music.fieldPalette === 'lake' ? '#528ef1' : '#9b63ed')
    this.high.copy(this.cool).lerp(this.pale, .46)
    this.body.copy(this.cool).multiplyScalar(.24)
  }
  at(t: number, brightness = 1) { return this.scratch.copy(this.cool).lerp(this.warm, unit(t)).multiplyScalar(brightness) }
}

const vertex = `
attribute vec3 aTint;
attribute float aOpacity;
varying vec3 vTint;
varying vec3 vNormal;
varying vec3 vView;
varying float vOpacity;
void main() {
  vec4 p=vec4(position,1.);
  vec3 n=normal;
  #ifdef USE_INSTANCING
    mat3 m=mat3(instanceMatrix);
    n/=max(vec3(dot(m[0],m[0]),dot(m[1],m[1]),dot(m[2],m[2])),vec3(.00001));
    n=m*n;
    p=instanceMatrix*p;
  #endif
  vec4 mv=modelViewMatrix*p;
  vNormal=normalize(normalMatrix*n);vView=-mv.xyz;vTint=aTint;vOpacity=aOpacity;
  gl_Position=projectionMatrix*mv;
}`
const litFragment = `
varying vec3 vTint;
varying vec3 vNormal;
varying vec3 vView;
varying float vOpacity;
void main() {
  if(vOpacity<.003)discard;
  vec3 n=normalize(vNormal),light=normalize(vec3(-.4,.75,.8)),view=normalize(vView);
  float diffuse=max(0.,dot(n,light));
  float specular=pow(max(0.,dot(reflect(-light,n),view)),44.);
  float rim=pow(1.-max(0.,dot(n,view)),3.);
  vec3 color=vTint*(.2+diffuse*.72+rim*.65)+vec3(.28,.34,.4)*specular*.34;
  gl_FragColor=vec4(color,vOpacity);
}`
const glowFragment = `
varying vec3 vTint;
varying float vOpacity;
void main() {
  if(vOpacity<.003)discard;
  gl_FragColor=vec4(vTint*vOpacity,vOpacity);
}`

/** Instance transforms and attributes are reused each frame; all geometry is truly spatial. */
export class Batch {
  readonly mesh: T.InstancedMesh
  private readonly tint: T.InstancedBufferAttribute
  private readonly opacity: T.InstancedBufferAttribute
  private readonly transform = new T.Object3D()
  constructor(group: T.Group, geometry: T.BufferGeometry, readonly capacity: number, glow = false) {
    this.tint = new T.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(T.DynamicDrawUsage)
    this.opacity = new T.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(T.DynamicDrawUsage)
    geometry.setAttribute('aTint', this.tint); geometry.setAttribute('aOpacity', this.opacity)
    const material = new T.ShaderMaterial({ vertexShader: vertex, fragmentShader: glow ? glowFragment : litFragment,
      transparent: glow, depthWrite: !glow, blending: glow ? T.AdditiveBlending : T.NormalBlending,
      premultipliedAlpha: glow, toneMapped: false })
    this.mesh = new T.InstancedMesh(geometry, material, capacity)
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); this.mesh.frustumCulled = false
    group.add(this.mesh)
  }
  place(index: number, x: number, y: number, z: number, sx: number, sy: number, sz: number,
    color: T.Color, alpha = 1, rx = 0, ry = 0, rz = 0) {
    this.transform.position.set(x, y, z); this.transform.scale.set(Math.max(.0001,sx),Math.max(.0001,sy),Math.max(.0001,sz))
    this.transform.rotation.set(rx, ry, rz); this.transform.updateMatrix()
    this.mesh.setMatrixAt(index, this.transform.matrix)
    this.tint.setXYZ(index, color.r, color.g, color.b); this.opacity.setX(index, unit(alpha))
  }
  finish(count = this.capacity) {
    this.mesh.count = Math.max(0, Math.min(count, this.capacity))
    this.mesh.instanceMatrix.needsUpdate = true; this.tint.needsUpdate = true; this.opacity.needsUpdate = true
  }
}

export function platform(group: T.Group, radius = 12, floor = -5.4) {
  const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, .12, 64), new T.MeshBasicMaterial({ color:'#03070d',transparent:true,opacity:.55,depthWrite:false,toneMapped:false }))
  mesh.position.y = floor; group.add(mesh)
  const ring=new T.Mesh(new T.TorusGeometry(radius,.016,4,160),new T.MeshBasicMaterial({color:'#35b7df',transparent:true,opacity:.18,blending:T.AdditiveBlending,depthWrite:false,toneMapped:false}))
  ring.rotation.x=Math.PI/2;ring.position.y=floor+.08;group.add(ring)
  const ticks:number[]=[]
  for(let i=0;i<48;i++) {
    const a=i/48*TAU,inner=radius-(i%4===0?.55:.2)
    ticks.push(Math.cos(a)*inner,floor+.09,Math.sin(a)*inner,Math.cos(a)*radius,floor+.09,Math.sin(a)*radius)
  }
  const markers=new T.LineSegments(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(ticks,3)),
    new T.LineBasicMaterial({color:'#529bc0',transparent:true,opacity:.22,depthWrite:false,blending:T.AdditiveBlending,toneMapped:false}))
  group.add(markers)
  const plate = mesh.material, edge = ring.material, marks = markers.material
  return { update(tint: Tint) {
    plate.color.copy(tint.cool).multiplyScalar(.016)
    edge.color.copy(tint.cool); marks.color.copy(tint.warm)
  } }
}
