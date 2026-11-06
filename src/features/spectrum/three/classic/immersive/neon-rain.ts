import * as T from 'three'
import {flowDriver,type FlowEffect} from '../flow/shared'
import {wetUniforms,wetField,wetPalette,wetSky,wetGround,wetMaterial,wetMesh,seededGeometry,plainVertex} from './wet-shared'

const rainVertex=`${wetField}
attribute vec4 aSeed;varying vec2 vUv;varying vec3 vColor;varying float vAlpha;
void main(){
  float cycle=fract(aSeed.w+uPhase*(.23+aSeed.z*.1));
  float y=75.-cycle*80.;float length=(1.3+aSeed.z*4.)*(.7+uWidth*.3);
  float z=mix(-220.,40.,pow(aSeed.y,.55));
  float spread=mix(110.,32.,smoothstep(-150.,25.,z));
  vec3 p=vec3((aSeed.x-.5)*spread*2.+uWind*(y+5.)*.38,y,z);
  p+=vec3(uWind*.38,1.,0.)*(uv.y-.5)*length;
  vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
  p+=right*(uv.x-.5)*(.045+uWidth*.035+max(0.,24.-p.z)*.0023);
  vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
  vUv=uv;vColor=mix(depthTint(p),uAccent,step(.91,aSeed.z)*.65);
  vAlpha=(.35+aSeed.z*.6)*depthFade(p)*smoothstep(0.,3.,-mv.z)*smoothstep(-5.,-3.,p.y)*step(hash(aSeed.w*127.),uCount);
}`
const rainFragment=`varying vec2 vUv;varying vec3 vColor;varying float vAlpha;
void main(){float width=exp(-pow((vUv.x-.5)*5.,2.));float tail=pow(clamp(1.-vUv.y,0.,1.),.65);
float a=width*tail*clamp(vAlpha,0.,1.);gl_FragColor=vec4(vColor*a*(1.+pow(clamp(1.-vUv.y,0.,1.),9.)*.5),a);}`
const towersVertex=`${wetField}
attribute vec4 aSeed;varying vec2 vUv;varying vec3 vColor;varying float vAlpha;
void main(){
  float x=(aSeed.x-.5)*240.,h=12.+aSeed.y*58.;
  vec3 p=vec3(x+(uv.x-.5)*(.55+aSeed.z*.45),-5.+uv.y*h,-130.-aSeed.z*70.);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);vUv=uv;
  vColor=mix(uColor,uAccent,step(.72,aSeed.w));vAlpha=.35+aSeed.y*.35+uMiddle*.2;
}`
const towerFragment=`varying vec2 vUv;varying vec3 vColor;varying float vAlpha;
void main(){float a=exp(-pow((vUv.x-.5)*3.,2.))*pow(clamp(1.-vUv.y,0.,1.),.35)*clamp(vAlpha,0.,1.);
gl_FragColor=vec4(vColor*a,a);}`
const groundFragment=`${wetField}
uniform float uImmersive;
varying vec3 vP;varying vec2 vUv;
void main(){
  float n=noise(vP.xz*.33+vec2(uPhase*.03,0.)),fine=noise(vP.xz*2.3);
  float strokes=pow(.5+.5*sin(vP.x*.31+noise(vP.xz*.035)*8.),18.);
  float reflection=strokes*(.035+n*.07)*(.4+smoothstep(30.,180.,-vP.z));
  vec2 tile=floor(vP.xz/3.5),local=fract(vP.xz/3.5)-.5;
  float seed=hash(tile.x+tile.y*73.),age=fract(seed+uPhase*.3);
  float radius=length(local-vec2(sin(seed*32.),cos(seed*21.))*.22);
  float ring=exp(-pow((radius-age*.53)*65.,2.))*pow(1.-age,2.)*step(seed,uCount);
  float sheen=reflection*fine+ring*.22;
  vec3 color=mix(vec3(.004,.012,.025),uColor*.055,n*.5)+depthTint(vP)*sheen;
  // Keep wet reflections on the desktop without laying an opaque dark floor
  // over the wallpaper. The complete avenue remains in immersive mode.
  color=mix(depthTint(vP)*(.45+sheen*.6),color,uImmersive);
  float coverage=mix(clamp(sheen*2.4,0.,.65),.93,uImmersive);
  gl_FragColor=vec4(color,depthFade(vP)*coverage);
}`

/** A rain-filled avenue of distant light with a wet surface extending beneath the viewer. */
export function createNeonRain(detail:number):FlowEffect{
  const group=new T.Group(),uniforms={...wetUniforms(),uImmersive:{value:0}},drive=flowDriver(uniforms)
  wetSky(group,uniforms)
  wetMesh(group,wetGround(),wetMaterial(uniforms,plainVertex,groundFragment,false))
  wetMesh(group,seededGeometry(54,684,true),wetMaterial(uniforms,towersVertex,towerFragment))
  const rain=wetMesh(group,seededGeometry(Math.round(Math.max(1600,Math.min(7000,4300*detail))),3195,true),wetMaterial(uniforms,rainVertex,rainFragment))
  rain.renderOrder=2
  return {group,update(motion,config,reduced){
    const m=config.music;drive(motion,config,reduced,(.16+m.rainSpeedMultiplier*.16)*(.55+m.speed*.2))
    wetPalette(uniforms,config);uniforms.uWidth.value=m.rainRadiusMultiplier
    uniforms.uCount.value=m.rainCount/20;uniforms.uWind.value=m.rainDirection==='down'?0:m.rainDirection==='left'?.8:-.8
    uniforms.uReduced.value=Number(reduced);uniforms.uImmersive.value=Number(config.sceneMode==='immersive')
  }}
}
