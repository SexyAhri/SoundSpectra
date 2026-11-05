import * as T from 'three'
import {
  commonUniforms, flowDriver, material, mesh, randomStream, surfaceGeometry, surfaceVertex,
  uniformSource, type FlowEffect,
} from '../flow/shared'

// The viewer is inside this volume. The nearest light ribs continue outside the
// viewport; the distant ones disappear into a bending, offset vanishing point.
const corridor = `
uniform vec4 uArrivals[4];
vec2 center(float z){return vec2(sin(z*.011)*4.2,sin(z*.017)*1.1);}
vec2 section(float theta,float z){
  vec2 q=vec2(cos(theta),sin(theta));
  q=sign(q)*pow(abs(q),vec2(.52));
  return q*vec2(17.,9.8)*uRange+center(z);
}
float visibility(float z){return smoothstep(-184.,-130.,z)*(1.-smoothstep(23.,34.,z));}
float arrival(float z){
  float energy=0.;
  for(int i=0;i<4;i++){
    vec4 event=uArrivals[i];
    float front=-164.+event.x*106.;
    float distance=z-front;
    if(event.x>=0.)energy+=exp(-distance*distance/135.)*event.y*exp(-event.x*.24);
  }
  return min(1.8,energy)*uTwist;
}
`

const ribsVertex = surfaceVertex(`
  float z=mod(lane*8.23+sin(lane*4.7)*1.3+uPhase*8.,214.)-180.;
  float theta=t*TAU+sin(z*.016)*.12;
  vec2 radial=normalize(section(theta,z)-center(z));
  vec2 xy=section(theta,z);
  // Alternating partial arches leave space between the horizontal and vertical
  // rhythm, rather than forming a sequence of closed target-like circles.
  float broken=smoothstep(-.3,.15,sin(theta*2.5+lane*1.73));
  float signal=arrival(z);
  // Maintain sub-pixel coverage in depth instead of letting a thin physical
  // tube disintegrate into bright disconnected pixels around the horizon.
  float thickness=.035+max(0.,24.-z)*.00075+signal*.018+uBass*.012;
  p=vec3(xy+radial*sin(a)*thickness,z+cos(a)*thickness);
  p.z+=sin(theta*2.+lane*.8)*1.8;
  vAlpha=visibility(z)*(.32+broken*.68);
  vLight=.24+signal*.75;
`, corridor)

const ribsFragment = `${uniformSource}
varying vec3 vWorld;
varying vec2 vUv;
varying float vLane,vAlpha,vLight;
void main(){
  float warm=step(.92,fract(vLane*.381966));
  vec3 cyan=mix(uColor,vec3(.11,.58,.72),.45);
  vec3 tint=mix(cyan,vec3(.95,.48,.13),warm*.8);
  float broken=smoothstep(-.3,.15,sin(vUv.x*15.7079+vLane*1.73));
  float edge=.65+.35*abs(sin(vUv.y*6.283185));
  gl_FragColor=vec4(tint*(.35+vLight)*edge,vAlpha*(.3+.7*broken));
}`

const trailsVertex = surfaceVertex(`
  float z=mix(-180.,33.,t), theta=lane*TAU/40.;
  theta+=sin(z*.018+lane*.37)*.045+sin(z*.006-uPhase*.08)*.035;
  vec2 radial=normalize(section(theta,z)-center(z));
  float paired=mod(lane,5.)<.5?1.:0.;
  float thickness=mix(.02,.032,paired)+max(0.,24.-z)*.00065;
  p=vec3(section(theta,z)+radial*sin(a)*thickness,z+cos(a)*thickness);
  vAlpha=visibility(z)*mix(.23,.64,paired);
  vLight=arrival(z)*.6;
`, corridor)

const trailsFragment = `${uniformSource}
varying vec3 vWorld;
varying vec2 vUv;
varying float vLane,vAlpha,vLight;
void main(){
  float primary=1.-step(.5,mod(vLane,5.));
  float warm=step(.95,fract(vLane*.618034));
  float detail=.88+.12*sin(vUv.x*12.+vLane*.31);
  vec3 tint=mix(mix(uColor,vec3(.06,.45,.64),.5),vec3(.93,.47,.12),warm*.8);
  gl_FragColor=vec4(tint*(.28+primary*.38+vLight)*detail,vAlpha);
}`

const shellVertex = surfaceVertex(`
  float z=mix(-180.,33.,t), theta=a;
  p=vec3(section(theta,z)*1.025,z);
  vAlpha=visibility(z);vLight=arrival(z);
`, corridor)
const shellFragment = `${uniformSource}
varying vec3 vWorld;
varying vec2 vUv;
varying float vLane,vAlpha,vLight;
void main(){
  float lower=smoothstep(.48,.62,vUv.y)*(1.-smoothstep(.86,1.,vUv.y));
  float seam=pow(.5+.5*cos(vUv.y*251.3274),42.);
  float bands=pow(.5+.5*cos(vUv.x*180.+sin(vUv.y*23.)*.6),38.);
  vec3 tint=mix(vec3(.012,.025,.042),uColor*.08,.45);
  vec3 color=tint*(.38+lower*.5)+uColor*(seam*.012+bands*.006+vLight*.018);
  gl_FragColor=vec4(color,vAlpha*.65);
}`

const dustVertex = `${uniformSource}
${corridor}
attribute vec4 aSeed;
varying float vAlpha,vWarm;
void main(){
  float z=mod(aSeed.x*214.+uPhase*(7.+aSeed.w*5.),214.)-180.;
  float theta=aSeed.y*6.2831853;
  vec2 xy=section(theta,z);
  // Most particles stay close to the walls. A few near-eye particles establish
  // parallax without making a dense snow field in front of the vanishing point.
  xy=mix(center(z),xy,.48+aSeed.z*.5);
  vec3 p=vec3(xy,z);
  vec4 mv=modelViewMatrix*vec4(p,1.);
  gl_Position=projectionMatrix*mv;
  gl_PointSize=clamp((.8+aSeed.w*1.5)*85./max(8.,-mv.z),.8,3.5)*uPixelRatio;
  vAlpha=visibility(z)*(.2+aSeed.w*.45)*step(aSeed.z,uCount);
  vWarm=step(.96,aSeed.w);
}`
const dustFragment = `${uniformSource}
varying float vAlpha,vWarm;
void main(){
  float d=length(gl_PointCoord-.5)*2.;
  float light=exp(-d*d*3.5);
  vec3 color=mix(mix(uColor,vec3(.22,.65,.8),.35),vec3(.95,.58,.22),vWarm*.8);
  gl_FragColor=vec4(color,light*vAlpha);
}`

/** An inhabited optical corridor, not a sculpture viewed against empty space. */
export function createLightCorridor(): FlowEffect {
  const group = new T.Group()
  const uniforms = Object.assign(commonUniforms(), {
    uArrivals: { value: Array.from({ length: 4 }, () => new T.Vector4(-1, 0, 0, 0)) },
  })
  const drive = flowDriver(uniforms)
  const shell = mesh(group, surfaceGeometry(160, 96), material(uniforms, shellVertex, shellFragment))
  shell.material.depthWrite = false
  shell.renderOrder = -2
  mesh(group, surfaceGeometry(160, 4, 40), material(uniforms, trailsVertex, trailsFragment, true))
  mesh(group, surfaceGeometry(192, 8, 26), material(uniforms, ribsVertex, ribsFragment, true))

  const random = randomStream(177031), seeds = new Float32Array(640 * 4)
  for (let i = 0; i < seeds.length; i++) seeds[i] = random()
  const geometry = new T.BufferGeometry()
    .setAttribute('position', new T.Float32BufferAttribute(new Float32Array(640 * 3), 3))
    .setAttribute('aSeed', new T.Float32BufferAttribute(seeds, 4))
  const dustMaterial = material(uniforms, dustVertex, dustFragment, true)
  const dust = new T.Points(geometry, dustMaterial)
  dust.frustumCulled = false; group.add(dust)

  let last = -1, beat = -1, next = 0
  return { group, update(motion, config, reduced) {
    const frame = motion.frame
    if (!frame || frame.now < last) {
      uniforms.uArrivals.value.forEach(event => { event.x = -1 })
      beat = -1; next = 0
    }
    const dt = drive(motion, config, reduced, .36 + config.music.speed * .14)
    if (!reduced) for (const event of uniforms.uArrivals.value) if (event.x >= 0) {
      event.x += dt
      if (event.x > 2.5) event.x = -1
    }
    if (!reduced && frame?.audible && frame.onset && frame.beatIndex !== beat) {
      beat = frame.beatIndex
      uniforms.uArrivals.value[next++ % 4].set(0, .3 + motion.bass * .3 + frame.beatStrength * .55, 0, 0)
    }
    if (reduced) uniforms.uArrivals.value.forEach(event => { event.x = -1 })
    uniforms.uRange.value = .76 + config.music.pulseRange * .24
    uniforms.uTwist.value = config.music.pulseImpact
    uniforms.uCount.value = .24 + config.music.pulseParticles / 22
    last = frame?.now ?? -1
  } }
}
