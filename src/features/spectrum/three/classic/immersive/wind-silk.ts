import * as T from 'three'
import { flowDriver,surfaceGeometry,surfaceVertex,uniformSource,type FlowEffect } from '../flow/shared'
import { daylightSky,daylightUniforms } from './daylight'

const vertex=surfaceVertex(`
 float x=(t-.5)*180.,across=(uv.y-.5)*17.*uWidth;
 float fold=sin(x*.055-uPhase*.45+lane*1.8);
 float twist=x*.035+lane+sin(uPhase*.14)*.4;
 p=vec3(x,(-12.+lane*17.)+fold*(7.+uMiddle*5.)+across*cos(twist),
   -18.-lane*22.+across*sin(twist)+sin(x*.08+lane-uPhase*.3)*5.);
 p.y+=sin(uv.y*23.+x*.12-uPhase*.7)*(.35+uBass*.6);
 vLight=fold;
`)
const fragment=`${uniformSource}
varying vec3 vWorld;varying vec2 vUv;varying float vLane,vAlpha,vLight;
void main(){
 vec3 n=cross(dFdx(vWorld),dFdy(vWorld));n/=max(length(n),.00001);if(!gl_FrontFacing)n=-n;
 vec3 light=normalize(vec3(-.5,.8,.8)),view=normalize(cameraPosition-vWorld);
 float diffuse=.4+.6*abs(dot(n,light));
 float sheen=pow(max(0.,dot(reflect(-light,n),view)),18.);
 float transmission=pow(max(0.,dot(-n,light)),2.);
 vec3 dye=mix(uColor,uAccent,clamp(vLane*.3+vUv.y*.25,0.,1.));
 float threads=.96+.04*sin(vUv.y*1500.);
 vec3 color=dye*diffuse*threads+vec3(.38,.29,.24)*(sheen*.16+transmission*.08);
 float hem=exp(-max(0.,min(vUv.y,1.-vUv.y))*160.);
 color+=dye*hem*(.05+uTrail*.01);
 gl_FragColor=vec4(color,1.);
}`

/** Broad suspended silk folds catch daylight; melody bends the fabric instead of flashing it. */
export function createWindSilk(detail:number):FlowEffect{
 const group=new T.Group(),uniforms=daylightUniforms(),drive=flowDriver(uniforms)
 uniforms.uSkyHigh.value.set('#6b6665');uniforms.uSkyLow.value.set('#96877c');daylightSky(group,uniforms)
 const sheet=new T.Mesh(surfaceGeometry(Math.round(200*Math.max(.65,detail)),64,3),new T.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,side:T.DoubleSide,toneMapped:false}));sheet.frustumCulled=false;group.add(sheet)
 return {group,update(motion,config,reduced){
   const m=config.music;drive(motion,config,reduced,m.skinFlowSpeedMultiplier*(.12+m.speed*.06))
   uniforms.uWidth.value=m.dragonWidth;uniforms.uTrail.value=m.dragonTrail
   uniforms.uSkyHigh.value.copy(uniforms.uShade.value).lerp(uniforms.uAccent.value,.3)
   uniforms.uSkyLow.value.copy(uniforms.uHighlight.value).multiplyScalar(.6)
 }}
}
