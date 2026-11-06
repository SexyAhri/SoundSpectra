import * as T from 'three'
import { material, mesh, randomStream, surfaceGeometry, surfaceVertex, uniformSource, type FlowEffect } from '../flow/shared'
import { environmentDriver, environmentUniforms, surfaceVaryings, waveSource } from './environment-shared'

const stormSpace = `
vec3 storm(vec3 p){
  float tilt=.66;
  p.yz=mat2(cos(tilt),-sin(tilt),sin(tilt),cos(tilt))*p.yz;
  p.xy=mat2(.91,-.415,.415,.91)*p.xy;
  return p+vec3(15.,8.,-115.);
}
`
const armsVertex = surfaceVertex(`
  float across=uv.y*2.-1.;
  float arm=mod(lane,5.), layer=floor(lane/5.);
  float radius=(7.+pow(t,.78)*183.)*uRange;
  float theta=t*5.1+arm*TAU/max(2.,uCount)-uPhase*.095+layer*.19;
  float width=(2.4+radius*.11)*uWidth*(layer<.5?1.:.65);
  vec3 radial=vec3(cos(theta),sin(theta),0.);
  vec3 tangent=vec3(-sin(theta),cos(theta),0.);
  vec3 q=radial*radius+tangent*across*width;
  q.z=sin(t*12.+arm+across*2.-uPhase*.2)*(1.4+t*7.)+layer*3.;
  p=storm(q);
  vAlpha=arm<uCount?smoothstep(0.,.04,t)*smoothstep(0.,.08,1.-t):0.;
  vAlpha*=layer<.5?1.:.35;
  vLight=wavefront(p.z);
`, stormSpace + waveSource)
const armsFragment = `${uniformSource}
${surfaceVaryings}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);
}
float cloud(vec2 p){return noise(p)*.53+noise(p*2.07)*.28+noise(p*4.11)*.13+noise(p*8.03)*.06;}
void main(){
  float across=vUv.y*2.-1.;
  float body=pow(max(0.,1.-across*across),1.3);
  vec2 q=vec2(vUv.x*19.-uPhase*.045,vUv.y*5.+vLane*7.);
  float distortion=cloud(q*.6);
  float vapor=cloud(q+vec2(distortion*2.7,distortion*.8));
  float cloudBody=smoothstep(.25,.75,vapor);
  float filaments=pow(max(0.,1.-abs(vapor-.5)*8.),5.);
  vec3 tint=mix(uColor,uAccent,.12+.16*sin(vUv.x*5.+vLane*1.7));
  float hot=pow(clamp(1.-vUv.x,0.,1.),2.5);
  tint=mix(tint,uAccent,hot*.55);
  vec3 color=tint*(.025+cloudBody*.32+filaments*.045+vLight*.1);
  gl_FragColor=vec4(color,clamp(vAlpha,0.,1.)*body*(.25+cloudBody*.6));
}`

const sparksVertex = `${uniformSource}
${stormSpace}
attribute vec4 aSeed;
varying float vAlpha;
void main(){
  float t=aSeed.x,arm=floor(aSeed.y*5.);
  float radius=(7.+pow(t,.78)*183.)*uRange;
  float theta=t*5.1+arm*6.2831853/max(2.,uCount)-uPhase*.095;
  vec3 q=vec3(cos(theta),sin(theta),0.)*radius;
  q+=vec3(-sin(theta),cos(theta),0.)*(aSeed.z-.5)*(4.8+radius*.22)*uWidth;
  q.z=(aSeed.w-.5)*18.;
  vec4 mv=modelViewMatrix*vec4(storm(q),1.);
  gl_Position=projectionMatrix*mv;
  gl_PointSize=clamp((.6+aSeed.w)*120./max(25.,-mv.z),.7,2.5)*uPixelRatio;
  vAlpha=arm<uCount?(.15+aSeed.w*.4):0.;
}`
const sparksFragment = `${uniformSource}
varying float vAlpha;
void main(){
  float r=length(gl_PointCoord-.5)*2.;
  gl_FragColor=vec4(mix(uColor,uHighlight,.35),exp(-r*r*4.)*vAlpha);
}`

const lightningVertex = `${uniformSource}
attribute float aBranch;
varying float vPower;
void main(){
  vPower=uPulse*max(0.,1.-aBranch*.13);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
}`
const lightningFragment = `${uniformSource}
varying float vPower;
void main(){gl_FragColor=vec4(mix(uColor,uHighlight,.5),vPower*.22);}`

/** A tilted stellar weather system surrounds the viewer with sweeping cloud arms. */
export function createIonStorm(detail: number): FlowEffect {
  const group = new T.Group(), uniforms = environmentUniforms(), drive = environmentDriver(uniforms)
  const segments = Math.round(230 * Math.max(.65, Math.min(1.2, detail)))
  mesh(group, surfaceGeometry(segments, 40, 10), material(uniforms, armsVertex, armsFragment, true))
  const random = randomStream(99187), positions: number[] = [], branches: number[] = []
  const seeds=Float32Array.from({length:480*4},()=>random())
  const sparkGeometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(new Float32Array(480*3),3))
    .setAttribute('aSeed',new T.Float32BufferAttribute(seeds,4))
  const sparks=new T.Points(sparkGeometry,material(uniforms,sparksVertex,sparksFragment,true))
  sparks.frustumCulled=false;group.add(sparks)
  const rotation = new T.Matrix4().makeRotationZ(-.428).multiply(new T.Matrix4().makeRotationX(-.66))
  for (let branch = 0; branch < 4; branch++) {
    const theta = branch * 1.56 + .4, radius = 32 + branch * 19
    let previous = new T.Vector3(Math.cos(theta)*radius,Math.sin(theta)*radius,0)
    for (let i = 0; i < 9; i++) {
      const next = previous.clone().add(new T.Vector3((random()-.2)*6,(random()-.5)*8,(random()-.5)*3))
      const a = previous.clone().applyMatrix4(rotation).add(new T.Vector3(15,8,-115))
      const b = next.clone().applyMatrix4(rotation).add(new T.Vector3(15,8,-115))
      positions.push(a.x,a.y,a.z,b.x,b.y,b.z); branches.push(branch,branch); previous = next
    }
  }
  const geometry = new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(positions,3))
    .setAttribute('aBranch',new T.Float32BufferAttribute(branches,1))
  const lightning = new T.LineSegments(geometry,material(uniforms,lightningVertex,lightningFragment,true))
  lightning.frustumCulled = false; group.add(lightning)
  return { group, update(motion, config, reduced) {
    drive(motion, config, reduced, .3 + config.music.speed * .12)
    uniforms.uCount.value = config.music.vortexArms
    uniforms.uWidth.value = config.music.vortexWidth
    uniforms.uRange.value = config.music.vortexRange
    lightning.visible = !reduced
  } }
}
