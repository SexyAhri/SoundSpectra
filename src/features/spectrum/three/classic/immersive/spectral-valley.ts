import * as T from 'three'
import { flowDriver, uniformSource, type FlowEffect } from '../flow/shared'
import { spectral } from '../kinetic/common'
import { noiseSource } from './cosmic-common'
import { daylightSky,daylightUniforms } from './daylight'

const field=`${uniformSource}
uniform float uBands[40];
float band(float x){float p=clamp(x,0.,1.)*(uCount-1.);int i=int(floor(p));return mix(uBands[i],uBands[min(i+1,int(uCount)-1)],fract(p));}
float terrain(vec2 p){
 float bend=sin(p.y*.021)*13.;float x=p.x-bend;
 float shoulders=1.-exp(-x*x/360.);
 float ridges=.5+.5*sin(p.x*.09+p.y*.035+sin(p.y*.023)*1.8);
 float fine=.5+.5*sin(p.x*.22-p.y*.065+uPhase*.16);
 float energy=band(clamp((-p.y+25.)/235.,0.,1.));
 return -8.+shoulders*(4.+ridges*17.+fine*3.+energy*22.)*uRange;
}`
const vertex=`${field}
varying vec3 vP;varying float vEnergy;
void main(){vP=position;vP.y=terrain(position.xz);vEnergy=band((-position.z+25.)/235.);gl_Position=projectionMatrix*modelViewMatrix*vec4(vP,1.);}`
const fragment=`${field}${noiseSource}
varying vec3 vP;varying float vEnergy;
void main(){
 vec3 n=normalize(cross(dFdx(vP),dFdy(vP)));if(!gl_FrontFacing)n=-n;
 float light=.32+.68*max(0.,dot(n,normalize(vec3(-.6,1.,.5))));
 float grain=fbm(vP*.2);
 float h=(vP.y+8.)*.28+grain*.35+sin(vP.x*.04)*.45;
 float layer=.5+.5*sin(h*6.283);
 float chalk=smoothstep(.76,.93,layer);
 float iron=smoothstep(.1,.55,.5+.5*sin(h*2.7+2.));
 vec3 stone=mix(uColor,uAccent,iron*.75);
 stone=mix(stone,vec3(.38,.29,.20),chalk*.32);
 float fine=.88+.12*noise3(vP*3.5);
 vec3 color=stone*light*fine;
 float valley=exp(-pow((vP.x-sin(vP.z*.021)*13.)/7.,2.));
 color=mix(color,vec3(.26,.18,.12)*light,valley*.4);
 float haze=smoothstep(25.,235.,-vP.z);
 gl_FragColor=vec4(mix(color,vec3(.29,.25,.20),haze*.6),1.);
}`

/** Warm mineral strata form a continuous landscape; separate frequency bands lift each ridge. */
export function createSpectralValley():FlowEffect {
 const group=new T.Group(),uniforms={...daylightUniforms(),uBands:{value:new Float32Array(40)}}
 const drive=flowDriver(uniforms)
 let last=-1
 const geometry=new T.PlaneGeometry(280,285,220,180);geometry.rotateX(-Math.PI/2);geometry.translate(0,0,-95)
 const terrain=new T.Mesh(geometry,new T.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,side:T.DoubleSide,toneMapped:false}));terrain.frustumCulled=false;group.add(terrain)
 uniforms.uSkyHigh.value.set('#687b7d');uniforms.uSkyLow.value.set('#9b8972');daylightSky(group,uniforms)
 return {group,update(motion,config,reduced){
   const m=config.music;const dt=drive(motion,config,reduced,.6+m.speed*.18)
   if(!motion.frame||motion.frame.now<last)uniforms.uBands.value.fill(0)
   uniforms.uRange.value=m.spectrumAmplitude;uniforms.uCount.value=m.spectrumTracks;uniforms.uWidth.value=m.spectrumNoteDensity
   uniforms.uColor.value.set(m.fieldPalette==='lake'?'#526b60':m.fieldPalette==='ember'?'#805647':'#875f4a')
   uniforms.uAccent.value.set(m.fieldPalette==='lake'?'#8a9581':m.fieldPalette==='ember'?'#a58266':'#ac9377')
   for(let i=0;i<m.spectrumTracks;i++){
     const target=spectral(motion,i/(m.spectrumTracks-1)),values=uniforms.uBands.value
     values[i]+=(target-values[i])*(1-Math.exp(-dt*(target>values[i]?14:4)))
   }
   last=motion.frame?.now??-1
 }}
}
