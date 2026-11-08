import * as T from 'three'
import { commonUniforms, flowDriver, material, mesh, randomStream, uniformSource, type FlowEffect } from '../flow/shared'
import { reactiveSource, reactiveUniforms, updateReactiveUniforms } from '../../reactive-motion'
import { seededGeometry } from './wet-shared'

const glassSource = /* glsl */ `${uniformSource}${reactiveSource}
uniform float uGlassAspect,uGlassDensity,uGlassSize,uGlassImmersive,uRoomEnergy;
uniform vec4 uWindowLights[18];
float glassHash(float n){return fract(sin(n*127.1+13.7)*43758.5453);}
// A quiet, defocused exterior. Only immersive mode paints this background;
// desktop mode keeps the wallpaper visible between individual water beads.
vec3 rainyBase(vec2 p){
  vec3 color=uShade*(.27+smoothstep(-.5,.6,p.y)*.20);
  float horizon=(p.y+.09)*4.;
  color+=uColor*exp(-horizon*horizon)*.055;
  return color;
}
vec3 rainyExterior(vec2 p){
  vec3 color=rainyBase(p);
  for(int i=0;i<18;i++){
    vec4 lamp=uWindowLights[i];float seed=lamp.w;
    vec2 center=lamp.xy;
    float radius=lamp.z;
    vec2 delta=p-center;float r=length(delta)/radius;
    float disc=1.-smoothstep(.55,1.5,r);
    float halo=exp(-r*r*.24)*.19;
    vec3 light=mix(uColor,uAccent,step(.47,seed));
    color+=light*(disc+halo)*(.10+seed*.34)*(1.+uRoomEnergy*.06);
    vec2 reflection=(p-center)*vec2(1.,.24);
    color+=light*exp(-dot(reflection,reflection)/(radius*radius*1.8))*.035*step(p.y,center.y);
  }
  return color;
}
float glassCycle(vec4 seed){
  return fract(seed.y+uPhase*(.021+seed.w*.017)+uDrift.y*.012);
}
float glassPath(float y,vec4 seed){
  return (seed.x-.5)*44.*uGlassAspect+sin(y*.7+seed.w*19.)*.075+sin(y*1.8+seed.z*8.)*.022;
}
vec3 glassCenter(vec4 seed){
  float moving=step(.76,seed.z),cycle=glassCycle(seed);
  float y=mix((seed.y-.5)*44.,27.-cycle*54.,moving);
  return vec3(glassPath(y,seed),y,.2+seed.w*.02);
}
`
const dropVertex = /* glsl */ `${glassSource}
attribute vec4 aSeed;
varying vec2 vDrop,vGlass;varying float vCycle,vMoving,vAlpha,vSeed,vNote;
void main(){
  float moving=step(.76,aSeed.z),cycle=glassCycle(aSeed);
  vec3 center=glassCenter(aSeed);
  float size=mix(.075+pow(aSeed.w,2.)*.19,.25+aSeed.w*.27,moving)*uGlassSize;
  size*=1.+moving*step(.65,aSeed.w)*uDragBands.x*.075;
  // A few leading beads carry the readable shape; the remaining droplets are fine condensation.
  vec3 p=center+vec3((uv-.5)*size*3.4,0.);
  vDrop=(uv-.5)*3.4;vGlass=p.xy/44.;vCycle=cycle;vMoving=moving;vSeed=aSeed.w;
  vNote=musicFront(aSeed.x,.38,.08,vec3(.65,1.,.25))*moving;
  float enabled=1.-smoothstep(uGlassDensity-.025,uGlassDensity+.025,glassHash(aSeed.x*37.+aSeed.w*53.));
  vAlpha=enabled*mix(.65,1.,moving)*mix(1.,smoothstep(0.,.035,cycle)*(1.-smoothstep(.95,1.,cycle)),moving);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`
const dropFragment = /* glsl */ `${glassSource}
varying vec2 vDrop,vGlass;varying float vCycle,vMoving,vAlpha,vSeed,vNote;
float waterShape(vec2 p){
  float merge=smoothstep(.28,.43,vCycle+vNote*.025)*vMoving;
  vec2 q=p;q.x*=1.+max(0.,q.y)*vMoving*.19;q.y*=mix(1.,.82,vMoving);
  float main=length(q)-mix(.81,.85+merge*.10,vMoving);
  vec2 satellite=vec2(1.23*(1.-merge),.65*(1.-merge));
  float other=length(p-satellite)-.34;
  float h=max(.20-abs(main-other),0.)/.20;
  return mix(main,min(main,other)-h*h*.05,vMoving);
}
void main(){
  if(vAlpha<.003)discard;
  float d=waterShape(vDrop),aa=max(.012,fwidth(d)),coverage=1.-smoothstep(-aa,aa,d);
  if(coverage<.003)discard;
  vec2 gradient=vec2(waterShape(vDrop+vec2(.012,0.))-waterShape(vDrop-vec2(.012,0.)),
    waterShape(vDrop+vec2(0.,.012))-waterShape(vDrop-vec2(0.,.012)))/.024;
  float rim=smoothstep(-.31,-.025,d),bulge=sqrt(clamp(-d*1.7,.025,1.));
  vec3 normal=normalize(vec3(gradient*(.35+rim*.65),bulge));
  vec2 refracted=vGlass+normal.xy*.058;
  vec3 through=rainyExterior(refracted)*mix(1.35,2.2,bulge);
  float glint=pow(max(0.,dot(normal,normalize(vec3(-.55,.7,1.)))),38.);
  float lower=pow(max(0.,dot(normal,normalize(vec3(.3,-.8,.8)))),24.);
  float detail=1.+uBodyBands.z*.14*(1.-vMoving)*step(.7,vSeed);
  vec3 color=mix(uShade*.38,uColor*.2,bulge)+uHighlight*(glint*1.6+lower*.23)*detail;
  color=mix(color,through+uHighlight*(glint*1.3+lower*.15),uGlassImmersive);
  // A narrow dark edge and a small bright reflection retain the water shape on pale wallpaper.
  color=mix(color,uShade*.22,rim*.44);
  float alpha=coverage*vAlpha*mix(.32+rim*.32+glint*.28,.82,uGlassImmersive);
  gl_FragColor=vec4(color,alpha);
}`
const trailVertex = /* glsl */ `${glassSource}
attribute vec4 aSeed;varying vec2 vTrail;varying float vAlpha,vSeed;
void main(){
  float cycle=glassCycle(aSeed);vec3 center=glassCenter(aSeed);
  float length=(1.4+aSeed.w*4.6)*uGlassSize*smoothstep(.02,.18,cycle);
  float y=center.y+uv.y*length;
  vec3 p=vec3(glassPath(y,aSeed)+(uv.x-.5)*.10*uGlassSize,y,.19);
  vTrail=uv;vSeed=aSeed.w;
  vAlpha=step(.76,aSeed.z)*(1.-smoothstep(uGlassDensity-.025,uGlassDensity+.025,glassHash(aSeed.x*37.+aSeed.w*53.)))
    *smoothstep(0.,.035,cycle)*(1.-smoothstep(.94,1.,cycle));
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`
const trailFragment = /* glsl */ `${uniformSource}
varying vec2 vTrail;varying float vAlpha,vSeed;
void main(){
  float taper=mix(.85,.15,vTrail.y),x=(vTrail.x-.5)*2./taper;
  float side=(abs(x)-.65)*5.;
  float line=exp(-x*x*5.),edge=exp(-side*side);
  float fade=pow(max(0.,1.-vTrail.y),1.7)*smoothstep(0.,.05,vTrail.y);
  float broken=.65+.35*sin(vTrail.y*37.+vSeed*8.);
  float alpha=(line*.05+edge*.10)*fade*broken*vAlpha;
  if(alpha<.002)discard;gl_FragColor=vec4(mix(uColor,uHighlight,.45),alpha);
}`

/** Close glass beads, seeded local coalescence and fine runoff, independent of ground rain. */
export function createWindowRain(detail: number): FlowEffect {
  const group = new T.Group();group.name = 'rain-on-window'
  const random=randomStream(61203)
  const u = { ...commonUniforms(), ...reactiveUniforms(), uGlassAspect: { value: 16 / 9 },
    uGlassDensity: { value: .8 }, uGlassSize: { value: 1 }, uGlassImmersive: { value: 0 }, uRoomEnergy: { value: 0 },
    uWindowLights:{value:Array.from({length:18},()=>new T.Vector4((random()-.5)*2.6,-.27+random()*.49,.022+random()*.035,random()))} }
  const drive = flowDriver(u), count = Math.round(760 * Math.max(.6, Math.min(1.2, detail)))
  const exterior = mesh(group, new T.PlaneGeometry(1, 1), material(u, `${glassSource}
    varying vec2 vGlass;void main(){vec3 p=vec3(position.x*60.*uGlassAspect,position.y*60.,-1.);
      vGlass=p.xy/44.;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`, `${glassSource}
    varying vec2 vGlass;void main(){if(uGlassImmersive<.5)discard;gl_FragColor=vec4(rainyBase(vGlass),1.);}`))
  exterior.name = 'scene-backdrop';exterior.renderOrder = -10
  // Eighteen small instanced quads keep the exterior lights off the fullscreen
  // fragment loop; only covered water beads evaluate the refracted environment.
  const lampGeometry=seededGeometry(18,61203,true)
  lampGeometry.setAttribute('aLamp',new T.InstancedBufferAttribute(new Float32Array(u.uWindowLights.value.flatMap(lamp=>lamp.toArray())),4))
  const lamps=mesh(group,lampGeometry,material(u,`${glassSource}
    attribute vec4 aLamp;varying vec2 vLamp;varying float vTint;
    void main(){vec3 p=vec3((aLamp.xy+(uv-.5)*aLamp.z*5.)*44.,-.8);
      vLamp=(uv-.5)*5.;vTint=aLamp.w;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
    `${glassSource}varying vec2 vLamp;varying float vTint;
    void main(){if(uGlassImmersive<.5)discard;float r=length(vLamp);
      float light=(1.-smoothstep(.55,1.5,r))+exp(-r*r*.24)*.19;
      light*=1.-smoothstep(2.,2.5,r);
      vec3 color=mix(uColor,uAccent,step(.47,vTint));
      gl_FragColor=vec4(color,light*(.10+vTint*.34)*(1.+uRoomEnergy*.06));}`,true))
  lamps.name='scene-backdrop';lamps.renderOrder=-9
  const trails = mesh(group, seededGeometry(count, 84193, true), material(u, trailVertex, trailFragment))
  trails.name = 'window-runoff';trails.renderOrder = 1;trails.material.depthWrite = false
  const drops = mesh(group, seededGeometry(count, 84193, true), material(u, dropVertex, dropFragment))
  drops.name = 'window-water-beads';drops.renderOrder = 2;drops.material.depthWrite = false
  return {
    group,
    layout(aspect) { u.uGlassAspect.value = aspect },
    update(motion, config, reduced) {
      const dt = drive(motion, config, reduced, .66 + config.music.speed * .16)
      updateReactiveUniforms(u, motion, 'window_rain', reduced)
      u.uGlassImmersive.value = config.sceneMode === 'immersive' ? 1 : 0
      u.uGlassDensity.value = Math.min(1, .65 * config.music.ambientDensity)
      u.uGlassSize.value = .72 + config.music.rainRadiusMultiplier * .28
      const target = motion.volume
      u.uRoomEnergy.value += (target - u.uRoomEnergy.value) * (1 - Math.exp(-dt / 1.6))
    },
  }
}
