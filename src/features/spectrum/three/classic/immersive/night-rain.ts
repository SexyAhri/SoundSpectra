import * as T from 'three'
import { flowDriver, type FlowEffect } from '../flow/shared'
import { wetUniforms, wetField, wetPalette, wetMaterial, wetMesh, seededGeometry } from './wet-shared'
import { reactiveUniforms, reactiveSource, updateReactiveUniforms } from '../../reactive-motion'

// Drops, impact rings and spray share seeds and transport. At the moment a
// drop lands and restarts above the view, its impact begins on the surface.
const rainSpace = `${wetField}${reactiveSource}
uniform float uImmersive;
uniform vec3 uHighlight;
float rainRate(vec4 seed){return .55+seed.z*.25;}
float rainCycle(vec4 seed){return fract(seed.w+(uPhase+uDrift.x*.12)*rainRate(seed));}
float rainEnabled(vec4 seed){return step(hash(seed.z*29.17+seed.x*17.31),uCount);}
vec3 rainLanding(vec4 seed){
  float z=mix(-130.,12.,pow(seed.y,.7));
  float spread=mix(115.,33.,smoothstep(-130.,12.,z));
  return vec3((seed.x-.5)*spread*2.,-9.,z);
}
`
const rainVertex = `${rainSpace}
attribute vec4 aSeed;varying vec2 vUv;varying vec3 vColor;varying float vAlpha;
void main(){
  float cycle=rainCycle(aSeed);vec3 landing=rainLanding(aSeed);
  float height=(1.-cycle)*78.;
  float near=smoothstep(-105.,12.,landing.z);
  float air=sin(aSeed.w*17.+uPhase*.17)*uDragBands.y*.24;
  vec3 p=landing+vec3((uWind+air*.025)*height,height,0.);
  float note=musicFront(aSeed.x,.6,.07,vec3(1.,.65,.25));
  float extent=(.32+near*.78+aSeed.z*.24)*(.8+uWidth*.2);
  extent*=1.+note*step(.75,aSeed.z)*.26;
  p+=vec3(uWind,1.,0.)*(uv.y-.5)*extent;
  vec4 mv=modelViewMatrix*vec4(p,1.);
  mv.x+=(uv.x-.5)*(.022+max(0.,-mv.z)*.0042)*uWidth;
  gl_Position=projectionMatrix*mv;vUv=uv;
  vColor=mix(uColor,uHighlight,.25+near*.45);
  vAlpha=(.27+near*.45+aSeed.z*.10)*(1.+note*.25)
    *smoothstep(0.,.025,cycle)*(1.-smoothstep(.97,1.,cycle))
    *smoothstep(0.,1.3,height)*smoothstep(2.,7.,-mv.z)
    *rainEnabled(aSeed)*depthFade(p);
}`
const rainFragment = `varying vec2 vUv;varying vec3 vColor;varying float vAlpha;
void main(){
  float x=(vUv.x-.5)*2.,y=clamp(vUv.y,0.,1.);
  float core=exp(-x*x*3.),caps=smoothstep(0.,.07,y)*(1.-smoothstep(.70,1.,y));
  float a=core*caps*(.35+.65*pow(1.-y,.7))*vAlpha;
  if(a<.003)discard;gl_FragColor=vec4(vColor*a,a);
}`
const impactVertex = `${rainSpace}
attribute vec4 aSeed;varying vec2 vUv;varying vec3 vColor;varying float vAlpha;
void main(){
  float age=rainCycle(aSeed)/rainRate(aSeed),life=age/.55;
  float radius=.06+age*1.65,angle=uv.x*6.2831853;
  vec3 center=rainLanding(aSeed);
  float width=.07+max(0.,24.-center.z)*.0026;
  float r=radius+(uv.y-.5)*width;
  vec3 p=center+vec3(cos(angle)*r,.015,sin(angle)*r);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
  float note=musicFront(aSeed.x,.6,.07,vec3(1.,.6,.2));
  vUv=uv;vColor=mix(mix(uColor,uHighlight,.58),uAccent,note*.18);
  vAlpha=(1.-exp(-age*45.))*exp(-age*5.)*(1.-smoothstep(.65,1.,life))
    *rainEnabled(aSeed)*depthFade(center)*(.95+note*.7);
}`
const impactFragment = `varying vec2 vUv;varying vec3 vColor;varying float vAlpha;
void main(){float y=clamp(vUv.y,0.,1.)*2.-1.;float a=exp(-y*y*5.)*vAlpha;
  if(a<.002)discard;gl_FragColor=vec4(vColor*a,a);}`
const sprayVertex = `${rainSpace}
attribute vec4 aSeed;varying float vAlpha;varying vec3 vColor;
void main(){
  float age=rainCycle(aSeed)/rainRate(aSeed),life=age/.18;
  float arc=clamp(life,0.,1.),direction=aSeed.x*67.;
  vec3 center=rainLanding(aSeed);
  vec3 p=center+vec3(cos(direction)*arc*.55,sin(arc*3.14159265)*(.24+aSeed.z*.4),sin(direction)*arc*.55);
  vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
  gl_PointSize=clamp(55./max(5.,-mv.z),.7,2.3)*uPixelRatio;
  vAlpha=sin(arc*3.14159265)*rainEnabled(aSeed)*depthFade(center)*.38;
  vColor=mix(uColor,uHighlight,.65);
}`
const sprayFragment=`varying float vAlpha;varying vec3 vColor;
void main(){vec2 p=(gl_PointCoord-.5)*2.;float a=exp(-dot(p,p)*5.)*vAlpha;
  if(a<.003)discard;gl_FragColor=vec4(vColor*a,a);}`
const lightsVertex=`${rainSpace}
attribute vec4 aSeed;varying vec2 vUv;varying vec3 vColor;varying float vAlpha;
void main(){
  vec3 center=vec3((aSeed.x-.5)*215.,-8.+aSeed.y*6.,-115.-aSeed.z*65.);
  float size=2.2+aSeed.w*7.;
  vec4 mv=modelViewMatrix*vec4(center,1.);mv.xy+=(uv-.5)*size;
  gl_Position=projectionMatrix*mv;vUv=uv;
  vColor=mix(uColor,uAccent,step(.36,aSeed.z));
  vAlpha=(.035+aSeed.w*.08)*mix(.16,1.,uImmersive)*(1.+uDragBands.y*.18);
}`
const lightsFragment=`varying vec2 vUv;varying vec3 vColor;varying float vAlpha;
void main(){vec2 p=(vUv-.5)*2.;float r=dot(p,p);
  float a=exp(-r*3.5)*(1.-smoothstep(.5,1.,r))*vAlpha;
  gl_FragColor=vec4(vColor*a,a);}`
const reflectionVertex=`${rainSpace}
attribute vec4 aSeed;varying vec2 vUv;varying vec3 vColor;varying float vAlpha;
varying vec3 vWorld;
void main(){
  vec3 p=vec3((aSeed.x-.5)*215.+(uv.x-.5)*(6.+aSeed.w*9.),
    -8.98,-115.-aSeed.z*65.+uv.y*(55.+aSeed.w*25.));
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
  vUv=uv;vWorld=p;vColor=mix(uColor,uAccent,step(.36,aSeed.z));
  vAlpha=(.055+aSeed.w*.025)*mix(.18,1.,uImmersive);
}`
const reflectionFragment=`${wetField}
varying vec2 vUv;varying vec3 vColor;varying float vAlpha;varying vec3 vWorld;
void main(){
  vec2 uv=clamp(vUv,0.,1.);float x=(uv.x-.5)*2.;
  float broken=noise(vWorld.xz*vec2(.55,.85)+vec2(0.,uPhase*.12));
  float a=exp(-x*x*4.)*smoothstep(0.,.18,uv.y)*(1.-smoothstep(.45,1.,uv.y))
    *(.3+broken*.7)*vAlpha;
  if(a<.001)discard;gl_FragColor=vec4(vColor*a,a);
}`

function impactGeometry(seeds:T.BufferAttribute|T.InterleavedBufferAttribute,count:number){
  const plane=new T.PlaneGeometry(1,1,36,1),g=new T.InstancedBufferGeometry();
  g.setIndex(plane.getIndex());g.setAttribute('position',plane.getAttribute('position'));g.setAttribute('uv',plane.getAttribute('uv'));
  g.setAttribute('aSeed',new T.InstancedBufferAttribute(new Float32Array(seeds.array.slice(0,count*4)),4));
  g.instanceCount=count;plane.dispose();return g;
}

/** Fine night rain, distant lamps and physically paired surface impacts. */
export function createNightRain(detail:number):FlowEffect{
  const group=new T.Group();group.name='night-rain';
  const uniforms={...wetUniforms(),...reactiveUniforms(),uImmersive:{value:0}},drive=flowDriver(uniforms);
  const capacity=Math.round(3400*Math.max(.55,Math.min(1.4,detail)));
  const drops=seededGeometry(capacity,3195,true);
  const lights=wetMesh(group,seededGeometry(38,684,true),wetMaterial(uniforms,lightsVertex,lightsFragment));
  lights.name='rain-distant-lights';lights.renderOrder=-2;
  const reflections=wetMesh(group,seededGeometry(38,684,true),wetMaterial(uniforms,reflectionVertex,reflectionFragment));
  reflections.name='rain-water-reflections';reflections.renderOrder=-1;
  const falling=wetMesh(group,drops,wetMaterial(uniforms,rainVertex,rainFragment));falling.name='rain-drops';
  const count=Math.min(capacity,Math.round(1100*detail));
  const impacts=wetMesh(group,impactGeometry(drops.getAttribute('aSeed'),count),wetMaterial(uniforms,impactVertex,impactFragment));
  impacts.name='rain-impacts';
  const spray=new T.Points(seededGeometry(count,3195),wetMaterial(uniforms,sprayVertex,sprayFragment));
  spray.name='rain-spray';spray.frustumCulled=false;group.add(spray);
  return {group,update(motion,config,reduced){
    const m=config.music;
    drive(motion,config,reduced,(.45+m.rainSpeedMultiplier*.55)*(.8+m.speed*.2));
    updateReactiveUniforms(uniforms,motion,'rhythm_rain',reduced);wetPalette(uniforms,config);
    uniforms.uWidth.value=m.rainRadiusMultiplier;uniforms.uCount.value=m.rainCount/20;
    uniforms.uWind.value=m.rainDirection==='down'?0:m.rainDirection==='left'?.13:-.13;
    uniforms.uReduced.value=Number(reduced);uniforms.uImmersive.value=Number(config.sceneMode==='immersive');
  }};
}
