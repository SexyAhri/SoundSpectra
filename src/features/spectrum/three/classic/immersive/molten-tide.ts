import * as T from 'three'
import { flowDriver, uniformSource, type FlowEffect } from '../flow/shared'
import { noiseSource } from './cosmic-common'
import { daylightSky,daylightUniforms } from './daylight'

const field=`${uniformSource}${noiseSource}
float height(vec2 p){
 vec2 q=p*.068;float time=uPhase*.55;
 float warp=fbm(vec3(q*.55,time*.11));
 float ridge=sin(q.x*1.2+q.y*.7+warp*3.-time);
 float cross=sin(q.x*.5-q.y*1.4+warp*2.+time*.6);
 return -5.+(ridge*2.5+cross*1.4+sin(q.x*3.+q.y*2.+time)*.3)*uWidth*(.7+uBass*.65)
   +fbm(vec3(q*1.8,time*.2))*uCount;
}`
const vertex=`${field} varying vec3 vP;
void main(){vP=position;vP.y=height(vP.xz);gl_Position=projectionMatrix*modelViewMatrix*vec4(vP,1.);}`
const fragment=`${field} varying vec3 vP;
void main(){
 float e=.08;vec3 n=normalize(vec3(height(vP.xz-vec2(e,0.))-height(vP.xz+vec2(e,0.)),2.*e,height(vP.xz-vec2(0.,e))-height(vP.xz+vec2(0.,e))));
 vec3 view=normalize(cameraPosition-vP),r=reflect(-view,n);
 float broad=pow(max(0.,dot(r,normalize(vec3(-.3,.8,-.6)))),4.);
 float strip=exp(-pow((r.x+r.z*.45-.15)*5.,2.))*smoothstep(-.4,.6,r.y);
 float dark=exp(-pow((r.x-.42)*6.,2.));
 float edge=pow(1.-max(0.,dot(n,view)),4.);
 float reflection=.5+.5*sin(r.x*8.+r.z*4.);
 vec3 metal=mix(uColor*.10,uAccent*.65,pow(broad,1.7));
 metal*=1.-dark*.88;
 metal+=uColor*reflection*.12;
 metal+=mix(uColor,uAccent,.55)*strip*(.22+uMiddle*.06)+uAccent*edge*.08;
 float grain=fbm(vec3(vP.xz*1.6,uPhase*.08));
 metal+=uColor*pow(grain,8.)*.18*uTrail;
 float haze=smoothstep(50.,230.,-vP.z);
 gl_FragColor=vec4(mix(metal,vec3(.46,.30,.14),haze*.35),1.);
}`

/** Broad reflected light describes a continuous liquid-metal surface, without emissive grids. */
export function createMoltenTide(detail:number):FlowEffect{
 const group=new T.Group(),uniforms=daylightUniforms(),drive=flowDriver(uniforms)
 uniforms.uSkyHigh.value.set('#4d4846');uniforms.uSkyLow.value.set('#82705b');daylightSky(group,uniforms)
 const segments=Math.round(180*Math.max(.6,Math.min(1.2,detail)))
 const geometry=new T.PlaneGeometry(300,310,segments,segments);geometry.rotateX(-Math.PI/2);geometry.translate(0,0,-100)
 const water=new T.Mesh(geometry,new T.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,side:T.DoubleSide,toneMapped:false}));water.frustumCulled=false;group.add(water)
 return {group,update(motion,config,reduced){
   const m=config.music;drive(motion,config,reduced,m.fluidSpeedMultiplier*(.4+m.speed*.16),true)
   uniforms.uWidth.value=m.fluidWidth;uniforms.uCount.value=m.fluidCount;uniforms.uTrail.value=1/(1+m.sourceFluidFadeSpeed*.04)
   uniforms.uColor.value.set(m.fieldPalette==='lake'?'#527372':m.fieldPalette==='ember'?'#855039':'#88612f')
   uniforms.uAccent.value.set(m.fieldPalette==='lake'?'#92b1a6':m.fieldPalette==='ember'?'#bd9674':'#c8a674')
 }}
}
