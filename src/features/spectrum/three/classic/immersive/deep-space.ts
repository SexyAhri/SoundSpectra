import * as T from 'three'
import { commonUniforms, flowDriver, randomStream, uniformSource, type FlowEffect } from '../flow/shared'
import { cosmicMaterial, cosmicStars, noiseSource } from './cosmic-common'

const vertex=`${uniformSource}
attribute vec3 aSeed;varying float vAlpha,vTint;
void main(){
 float radius=position.x,a=position.y+uPhase*.035/(.35+radius*.012);
 vec3 p=vec3(cos(a)*radius,sin(a)*radius*.37,position.z+sin(a)*radius*.3);
 p.y+=p.x*.26;p.z-=48.;p.x+=8.;
 p.z*=.75+uDepth*.25;
 vec4 view=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*view;
 gl_PointSize=clamp((.55+aSeed.y*1.8)*180./max(8.,-view.z),1.,7.)*uPixelRatio;
 vAlpha=(.18+aSeed.z*.6)*(1.+uTreble*.38);vTint=aSeed.x;
}`
const fragment=`${uniformSource}
varying float vAlpha,vTint;
void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;
 vec3 tint=mix(uColor,uAccent,vTint);tint=mix(tint,vec3(.85,.91,1.),.32);
 gl_FragColor=vec4(tint,(exp(-r*r*15.)+exp(-r*r*3.)*.12)*vAlpha);}`
const cloudVertex=`varying vec3 vP;varying vec2 vUv;
void main(){vP=position;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`
const cloudFragment=`${uniformSource}${noiseSource}
varying vec3 vP;varying vec2 vUv;
void main(){
 vec2 p=vP.xy;float radius=length(p*vec2(1.,2.2)),a=atan(p.y*2.2,p.x);
 float arm=.5+.5*cos(a*2.-radius*.105+uPhase*.055);
 float structure=fbm(vec3(p*.065,uPhase*.016));
 float dust=fbm(vec3(p*.14+11.,uPhase*.012));
 float envelope=exp(-radius*.019)*(1.-smoothstep(70.,112.,radius));
 float cloud=pow(arm,3.)*smoothstep(.26,.73,structure)*envelope;
 float core=exp(-radius*radius/130.);
 float rift=smoothstep(.37,.63,dust);
 vec3 tint=mix(uAccent,uColor,smoothstep(.25,.8,structure));
 vec3 color=tint*cloud*(.24+uMiddle*.1)*(1.-rift*.75);
 color+=mix(uColor,vec3(.9,.75,.55),.65)*core*.23;
 float edge=smoothstep(0.,.08,vUv.x)*smoothstep(0.,.08,1.-vUv.x)*smoothstep(0.,.08,vUv.y)*smoothstep(0.,.08,1.-vUv.y);
 gl_FragColor=vec4(color,edge*min(1.,uTrail+.15));
}`

/** A tilted spiral nebula of depth-separated dust sheets and individual stars. */
export function createDeepSpace(detail:number):FlowEffect {
 const group=new T.Group(),uniforms=commonUniforms(),drive=flowDriver(uniforms),random=randomStream(918273)
 const background=cosmicStars(group,uniforms,detail*.65)
 const count=Math.round(16000*Math.max(.5,Math.min(1.3,detail)))
 const positions=new Float32Array(count*3),seeds=new Float32Array(count*3)
 for(let i=0;i<count;i++){
   const r=5+Math.pow(random(),.7)*100
   const a=r*.052+(i%2)*Math.PI+(random()+random()-1)*(.12+r*.0018)
   positions.set([r,a,(random()+random()-1)*(2+r*.035)],i*3)
   seeds.set([random(),random()**4,random()],i*3)
 }
 const geometry=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(positions,3)).setAttribute('aSeed',new T.BufferAttribute(seeds,3))
 const stars=new T.Points(geometry,cosmicMaterial(uniforms,vertex,fragment,true));stars.frustumCulled=false;group.add(stars)
 for(let i=0;i<3;i++){
   const cloud=new T.Mesh(new T.PlaneGeometry(230,140,32,16),cosmicMaterial(uniforms,cloudVertex,cloudFragment,true))
   cloud.position.set(8,2+i*1.6,-55-i*13);cloud.rotation.set(-.22,.08,.24+i*.025);cloud.frustumCulled=false;group.add(cloud)
 }
 return {group,update(motion,config,reduced){
   const m=config.music;drive(motion,config,reduced,.65+m.speed*.16)
   uniforms.uDepth.value=m.starDepth;uniforms.uTrail.value=m.starTrail
   background.setDensity(m.starCount/192)
   geometry.setDrawRange(0,Math.round(count*m.starCount/192))
 }}
}
