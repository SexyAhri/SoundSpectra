import * as T from 'three'
import { flowDriver,surfaceGeometry,surfaceVertex,uniformSource,type FlowEffect } from '../flow/shared'
import { daylightSky,daylightUniforms } from './daylight'

const vertex=surfaceVertex(`
 float x=(t-.5)*uRange,across=(uv.y-.5)*mix(17.,12.,uDepth)*uWidth;
 across*=mix(1.,.35+.65*pow(max(0.,sin(t*PI)),.35),uDepth);
 float materialX=x-uPhase*16.;
 float fold=sin(materialX*.065+lane*1.8)*5.8+sin(materialX*.115+lane*.8)*1.2;
 float twist=x*.035+lane+sin(x*.025-uPhase*.32)*.12;
 float ripple=0.;
 for(int i=0;i<6;i++){
   vec4 wave=uSilkWaves[i];
   float front=abs(t-wave.z)-wave.x*.42;
   float attack=1.-exp(-wave.w*18.);
   ripple+=exp(-front*front*720.)*attack*attack*exp(-wave.w*2.)
     *(1.-smoothstep(2.5,3.5,wave.w))*wave.y;
 }
 p=vec3(x,(-12.+lane*mix(17.,12.,uDepth))+fold*(1.+uSlowMid*.12)*mix(1.,.7,uDepth)+across*cos(twist),
   -18.-lane*22.+across*sin(twist)+sin(x*.08+lane-uPhase*.3)*5.);
 p.y+=sin(across*.7+materialX*.12+lane)*(.35+uSlowMid*.45)+ripple*sin(uv.y*15.+lane)*4.5;
 p.z+=pow(.5+.5*sin(materialX*.18+lane),6.)*sin(across*.6)*uAccents.y*.8;
 p.z+=sin(across*.9+materialX*.19)*.18;
 p.y+=sin(across*2.8+materialX*.32+lane)*.1;
 vLight=ripple;
`, 'uniform float uSlowMid; uniform vec4 uSilkWaves[6];')
const fragment=`${uniformSource}
varying vec3 vWorld;varying vec2 vUv;varying float vLane,vAlpha,vLight;
void main(){
 vec3 n=cross(dFdx(vWorld),dFdy(vWorld));n/=max(length(n),.00001);if(!gl_FrontFacing)n=-n;
 vec3 light=normalize(vec3(-.5,.8,.8)),view=cameraPosition-vWorld;view/=max(length(view),.00001);
 float diffuse=.4+.6*abs(dot(n,light));
 float sheen=pow(max(0.,dot(reflect(-light,n),view)),28.);
 // Rounded face-on dot products must not feed a negative base to pow.
 float grazing=pow(clamp(1.-abs(dot(n,view)),0.,1.),2.5);
 float transmission=pow(max(0.,dot(-n,light)),2.);
 vec3 dye=mix(uColor,uAccent,clamp(vLane*.3+vUv.y*.25,0.,1.));
 float weave=vUv.y*1500.;
 float threads=.97+.03*sin(weave)*exp(-fwidth(weave)*fwidth(weave)*.3);
 vec3 color=dye*(diffuse*threads+grazing*.14)+mix(dye,vec3(.9,.8,.68),.5)*(sheen*.32+transmission*.08+vLight*.12);
 float hem=exp(-max(0.,min(vUv.y,1.-vUv.y))*160.);
 color+=dye*hem*(.05+uTrail*.01);
 float tip=mix(1.,smoothstep(0.,.07,vUv.x)*(1.-smoothstep(.93,1.,vUv.x)),uDepth);
 if(tip<.005)discard;
 gl_FragColor=vec4(color,tip);
}`

/** Broad suspended silk folds catch daylight; melody bends the fabric instead of flashing it. */
export function createWindSilk(detail:number):FlowEffect{
 const group=new T.Group(),uniforms={...daylightUniforms(),uSilkWaves:{value:Array.from({length:6},()=>new T.Vector4(0,0,0,10))}},drive=flowDriver(uniforms)
 const waves:{age:number;life:number;strength:number;origin:number}[]=[]
 let beat=-1
 uniforms.uSkyHigh.value.set('#6b6665');uniforms.uSkyLow.value.set('#96877c');daylightSky(group,uniforms)
 const sheet=new T.Mesh(surfaceGeometry(Math.round(200*Math.max(.65,detail)),64,3),new T.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,side:T.DoubleSide,transparent:true,toneMapped:false}));sheet.frustumCulled=false;group.add(sheet)
 return {group,update(motion,config,reduced){
   const m=config.music,dt=drive(motion,config,reduced,m.skinFlowSpeedMultiplier*(.12+m.speed*.06))
   for(const wave of waves){wave.life+=dt;if(!reduced)wave.age+=dt}
   while(waves.length&&waves[0].life>3.5)waves.shift()
   const frame=motion.frame
   if(!reduced&&motion.transporting&&frame?.onset&&frame.beatIndex!==beat){
     beat=frame.beatIndex;if(waves.length===6)waves.shift()
     const regional=frame.bandOnsets[0]?1:frame.bandOnsets[1]?.75:.25
     waves.push({age:0,life:0,strength:motion.onsetStrength*regional,origin:uniforms.uOnsetOrigin.value})
   }
   uniforms.uSilkWaves.value.forEach((value,i)=>{const wave=waves[i];value.set(wave?.age??0,wave?.strength??0,wave?.origin??0,wave?.life??10)})
   uniforms.uWidth.value=m.dragonWidth;uniforms.uTrail.value=m.dragonTrail
   uniforms.uRange.value=config.sceneMode==='daily'?78:180;uniforms.uDepth.value=Number(config.sceneMode==='daily')
   uniforms.uSkyHigh.value.copy(uniforms.uShade.value).lerp(uniforms.uAccent.value,.3)
   uniforms.uSkyLow.value.copy(uniforms.uHighlight.value).multiplyScalar(.6)
 }}
}
