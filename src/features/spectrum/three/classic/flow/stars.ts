import * as T from 'three'
import { commonUniforms, flowDriver, material, mesh, randomStream, surfaceFragment, surfaceGeometry, surfaceVertex, uniformSource, type FlowEffect } from './shared'

const starPath = `
vec3 starPosition(vec4 seed,float past){
  float phase=uPhase-past;
  float angle=seed.x*6.2831853+phase*(.035+seed.z*.025);
  float latitude=(seed.y-.5)*2.1;
  float radius=3.5+seed.z*9.;
  return vec3(cos(angle)*cos(latitude)*radius,sin(latitude)*radius*.75,sin(angle)*cos(latitude)*radius*uDepth);
}`
const starsVertex = `${uniformSource}
attribute vec4 aSeed;
varying vec3 vWorld;
varying vec2 vUv;
varying float vLane,vAlpha,vLight;
${starPath}
void main(){
  float size=(.05+aSeed.z*.07)*(1.+uTreble*.45);
  vec3 p=starPosition(aSeed,0.)+position*size;
  vWorld=(modelMatrix*vec4(p,1.)).xyz; vUv=uv; vLane=aSeed.x*3.;
  vAlpha=aSeed.w<uCount?.8:0.; vLight=.45+uTreble*.2;
  gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
}`
const linksVertex = `${uniformSource}
attribute vec4 aSeed;
attribute float aMax;
attribute float aRole;
varying float vAlpha;
varying float vTint;
${starPath}
void main(){
  vec3 p=starPosition(aSeed,aRole*max(0.,uTrail)*.6);
  vAlpha=aMax<uCount?1.:0.;
  if(aRole>0.)vAlpha*=min(1.,uTrail);
  vTint=aSeed.x;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`
const linksFragment = `${uniformSource}
varying float vAlpha;
varying float vTint;
void main(){
  float alpha=vAlpha*.13;
  gl_FragColor=vec4(mix(uColor,uAccent,vTint),alpha);
}`

const atlasCore = surfaceVertex(`
  float latitude=t*PI, longitude=a+uPhase*.065;
  float radius=2.35+uBass*.12;
  p=vec3(sin(latitude)*cos(longitude),cos(latitude),sin(latitude)*sin(longitude))*radius;
  vLight=0.;vAlpha=1.;
`)
const atlasFragment = `${uniformSource}
varying vec3 vWorld;
varying vec2 vUv;
varying float vLane,vAlpha,vLight;
void main(){
  vec3 n=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
  float rim=pow(1.-abs(dot(n,normalize(cameraPosition-vWorld))),3.4);
  float latitude=pow(abs(cos(vUv.x*3.14159265*8.)),100.);
  float longitude=pow(abs(cos(vUv.y*6.2831853*6.)),130.);
  vec3 tint=mix(uColor,uAccent,.45+.3*sin(vUv.x*3.14159265));
  // A dark globe occludes the far half of each orbit; only its rim is luminous.
  gl_FragColor=vec4(tint*(.018+rim*.55+latitude*.065+longitude*.045),1.);
}`
const atlasOrbits = surfaceVertex(`
  float theta=t*TAU+uPhase*(lane<.5?.08:-.045);
  float radius=3.35+lane*.85, tilt=.35+lane*.48;
  vec3 q=vec3(cos(theta)*(radius+cos(a)*.027),sin(a)*.027,sin(theta)*(radius+cos(a)*.027));
  p=vec3(q.x,cos(tilt)*q.y-sin(tilt)*q.z,sin(tilt)*q.y+cos(tilt)*q.z);
  float turn=.45;
  p.xy=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*p.xy;
  vAlpha=.46;vLight=.55;
`)
const atlasSatellites = surfaceVertex(`
  float theta=lane*2.1+uPhase*(lane<.5?.08:-.045), latitude=t*PI;
  float radius=3.35+lane*.85, tilt=.35+lane*.48;
  vec3 center=vec3(cos(theta)*radius,-sin(tilt)*sin(theta)*radius,cos(tilt)*sin(theta)*radius);
  float turn=.45;center.xy=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*center.xy;
  p=center+vec3(sin(latitude)*cos(a),cos(latitude),sin(latitude)*sin(a))*(.16+lane*.035);
  vAlpha=.95;vLight=.55+uTreble*.25;
`)

/** A celestial atlas with an anchored globe, oblique orbits and deep constellations. */
export function createDreamStars(detail: number): FlowEffect {
  const group = new T.Group(), uniforms = commonUniforms(), drive = flowDriver(uniforms)
  const random = randomStream(91827), count = 192, seeds = new Float32Array(count * 4)
  let longitude = 0, latitude = 0, radius = 0
  for (let i = 0; i < count; i++) {
    if (i % 4 === 0) { longitude = random(); latitude = random(); radius = random() }
    seeds.set([(longitude + (i % 4) * .014) % 1, Math.min(.98, latitude + (i % 4) * .035), radius, i], i * 4)
  }
  const sphere = new T.SphereGeometry(1, detail > .8 ? 10 : 8, 6), stars = new T.InstancedBufferGeometry()
  stars.setIndex(sphere.getIndex()); stars.setAttribute('position', sphere.getAttribute('position')); stars.setAttribute('uv', sphere.getAttribute('uv'))
  stars.setAttribute('aSeed', new T.InstancedBufferAttribute(seeds, 4)); stars.instanceCount = count; sphere.dispose()
  mesh(group, stars, material(uniforms, starsVertex, surfaceFragment))
  mesh(group, surfaceGeometry(48, 64), material(uniforms, atlasCore, atlasFragment))
  mesh(group, surfaceGeometry(192, 6, 3), material(uniforms, atlasOrbits, undefined, true))
  mesh(group, surfaceGeometry(12, 16, 3), material(uniforms, atlasSatellites))

  const linkSeeds: number[] = [], max: number[] = [], roles: number[] = []
  const push = (index: number, maximum: number, role: number) => { linkSeeds.push(...seeds.subarray(index * 4, index * 4 + 4)); max.push(maximum); roles.push(role) }
  for (let cluster = 0; cluster < count / 4; cluster += 3) {
    for (let j = 0; j < 3; j++) { const i = cluster * 4 + j; push(i, i + 1, 0); push(i + 1, i + 1, 0) }
  }
  const constellationVertices = max.length
  for (let i = 0; i < count; i += 4) { push(i, i, 0); push(i, i, 1) }
  const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(new Float32Array(max.length * 3), 3))
    .setAttribute('aSeed', new T.Float32BufferAttribute(linkSeeds, 4)).setAttribute('aMax', new T.Float32BufferAttribute(max, 1))
    .setAttribute('aRole', new T.Float32BufferAttribute(roles, 1))
  const lines = new T.LineSegments(geometry, material(uniforms, linksVertex, linksFragment, true)); lines.frustumCulled = false; group.add(lines)

  return { group, update(motion, config, reduced) {
    drive(motion, config, reduced, .4 + config.music.speed * .18)
    uniforms.uCount.value = config.music.starCount; uniforms.uDepth.value = config.music.starDepth
    uniforms.uTrail.value = reduced ? 0 : config.music.starTrail
    geometry.setDrawRange(0, uniforms.uTrail.value > 0 ? max.length : constellationVertices)
  } }
}
