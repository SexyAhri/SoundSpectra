import * as T from 'three'
import {flowDriver,type FlowEffect} from '../flow/shared'
import type {FieldRipple} from '../../motion'
import {wetUniforms,wetField,wetPalette,wetSky,wetGround,wetMaterial,wetMesh,seededGeometry,plainVertex,pointFragment} from './wet-shared'

const lakeField=`${wetField}
uniform vec4 uDrops[6];
float rippleHeight(vec2 p){
 float height=0.;
 for(int i=0;i<6;i++){
   vec4 d=uDrops[i];if(d.w<=0.||d.z<0.)continue;
   float front=length(p-d.xy)-d.z*(3.5+uRange*3.);
   height+=cos(front*2.2)*exp(-front*front/(6.+uCount*3.))*exp(-d.z*.3)*d.w*.45;
 }
 return height;
}
float lake(vec2 p){return -5.+sin(p.x*.17+p.y*.13+uPhase*.3)*.1+noise(p*.15+uPhase*.025)*.16+rippleHeight(p);}
`
const vertex=`${lakeField}
varying vec3 vP;varying vec2 vUv;
void main(){vP=position;vP.y=lake(vP.xz);vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(vP,1.);}`
const fragment=`${lakeField}
varying vec3 vP;varying vec2 vUv;
void main(){
  vec3 normal=normalize(cross(dFdx(vP),dFdy(vP)));if(!gl_FrontFacing)normal=-normal;
  float ripples=0.;
  for(int i=0;i<6;i++){
    vec4 drop=uDrops[i];if(drop.w<=0.||drop.z<0.)continue;
    float distance=length((vP.xz-drop.xy)*vec2(1.,1.));
    float front=distance-drop.z*(3.5+uRange*3.);
    float envelope=exp(-front*front/(6.+uCount*3.))*exp(-drop.z*.3);
    ripples+=pow(.5+.5*cos(front*2.2),12.)*envelope*drop.w;
  }
  float shimmer=noise(vP.xz*vec2(.9,3.5)+vec2(uPhase*.013,0.));
  float reflection=0.;
  for(int i=0;i<9;i++){
    float x=(float(i)-4.)*19.+sin(float(i)*8.3)*8.;
    float wander=sin(vP.z*.16+float(i)+uPhase*.06)*(.15+max(0.,80.+vP.z)*.015);
    float width=.28+max(0.,160.+vP.z)*.025;
    reflection+=exp(-pow((vP.x-x+wander)/width,2.))*(.18+hash(float(i))*.32);
  }
  float faraway=smoothstep(-20.,180.,-vP.z);
  float bridge=reflection*pow(shimmer,3.)*(.15+faraway*.8);
  vec3 color=mix(uColor*.018,uAccent*.045,faraway)+depthTint(vP)*bridge*.45;
  vec3 view=normalize(cameraPosition-vP),light=normalize(vec3(-.3,.8,-.4));
  float specular=pow(max(0.,dot(reflect(-light,normal),view)),36.);
  vec3 pearl=mix(uColor,vec3(.8,.96,1.),.45);
  color+=mix(pearl,uAccent,.3+.25*sin(vP.x*.04))*min(1.6,ripples)*.95;
  color+=pearl*specular*(.08+uMiddle*.12);
  float moonPath=exp(-pow((vP.x+20.+sin(vP.z*.1+uPhase*.1)*1.2)/(2.+max(0.,155.+vP.z)*.045),2.));
  color+=mix(uColor,vec3(.85,.74,.55),.45)*moonPath*pow(shimmer,3.)*.38;
  gl_FragColor=vec4(color,depthFade(vP)*.98);
}`
const shoreVertex=`${wetField}
attribute vec4 aSeed;varying vec3 vColor;varying float vAlpha;
void main(){vec3 p=vec3((aSeed.x-.5)*260.,-3.8+aSeed.z*.9,-175.-aSeed.y*26.);
vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=(1.+aSeed.z*2.)*uPixelRatio;
vColor=mix(uAccent,uColor,aSeed.w);vAlpha=.25+aSeed.z*.35;}`
const moonFragment=`${wetField}
varying vec3 vP;varying vec2 vUv;
void main(){vec2 q=(vUv-.5)*2.;float r=length(q);float disc=1.-smoothstep(.7,.76,r);
float crescent=1.-smoothstep(.64,.66,length(q-vec2(.32,.1)));
float a=max(0.,disc-crescent)*.8+exp(-r*r*5.)*.05;
gl_FragColor=vec4(mix(uColor,vec3(.75,.84,.98),.35)*a,a);}`

/** Quiet nocturnal water, shore reflections and audio-born ripples, without a line grid. */
export function createNightLake(detail:number):FlowEffect{
  const group=new T.Group(),uniforms=wetUniforms(),drive=flowDriver(uniforms)
  const pointerOffsets=new WeakMap<FieldRipple,number>()
  wetSky(group,uniforms)
  wetMesh(group,wetGround(220,270,Math.round(Math.max(90,Math.min(220,150*detail)))),wetMaterial(uniforms,vertex,fragment,false))
  const shore=new T.Points(seededGeometry(250,89271),wetMaterial(uniforms,shoreVertex,pointFragment));shore.frustumCulled=false;group.add(shore)
  const moon=wetMesh(group,new T.PlaneGeometry(23,23),wetMaterial(uniforms,plainVertex,moonFragment));moon.position.set(-34,25,-135)
  return {group,update(motion,config,reduced){
    const m=config.music;drive(motion,config,reduced,.22+m.speed*.09);wetPalette(uniforms,config)
    uniforms.uRange.value=m.waterRange;uniforms.uCount.value=m.waterEchoes;uniforms.uReduced.value=Number(reduced)
    const ripples=motion.ripples.slice(-m.waterDrops)
    for(let i=0;i<6;i++){
      const ripple=ripples[i]
      if(!ripple){uniforms.uDrops.value[i].set(0,0,-1,0);continue}
      const pointer=ripple.source==='pointer'
      const x=pointer?ripple.x:ripple.x*1.35,z=pointer?ripple.z:ripple.z*1.65-10
      // Reduced-motion clicks show a stationary ring immediately. Retain that
      // initial offset on resume so the ring cannot jump back toward its center.
      if(reduced&&pointer&&!pointerOffsets.has(ripple))pointerOffsets.set(ripple,Math.max(0,.7-ripple.age))
      const age=ripple.age+(pointerOffsets.get(ripple)??0)
      // The shader already fades spatial age. Keep fading elapsed lifetime for
      // every frozen wave, including music waves that existed before reduction.
      const strength=ripple.strength*Math.exp(-Math.max(0,ripple.lifetime-ripple.age)*.38)
      uniforms.uDrops.value[i].set(x,z,age,strength)
    }
  }}
}
