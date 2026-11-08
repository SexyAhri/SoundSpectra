import * as T from 'three'
import { commonUniforms,flowDriver,randomStream,uniformSource,type FlowEffect } from '../flow/shared'
import { reactiveUniforms, reactiveSource, updateReactiveUniforms } from '../../reactive-motion'

const vertex=`${uniformSource}${reactiveSource}
attribute vec4 aSeed;varying float vAlpha,vTurn,vDetail,vAspect,vSize;
void main(){
 float fall=mod(aSeed.y*110.+uPhase*(2.+aSeed.z*2.),110.);
 vec3 p=vec3((aSeed.x-.5)*155.+sin(uPhase*.35+aSeed.y*14.)*(1.+uWidth*2.+uDragBands.y*2.)+fall*uTwist*.08,
   50.-fall,-115.+aSeed.z*130.);
 // A broad crosswind carries flakes; accents turn crystals without pulling
 // their centers away from, then back onto, the falling path.
 p.x+=sin(uPhase*.13+aSeed.z*2.)*1.1;
 vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
 gl_PointSize=clamp((.6+aSeed.w*1.4)*uRange*230./max(8.,-mv.z),1.2,22.)*uPixelRatio*(1.+step(.8,aSeed.w)*uAccents.z*.25);
 vSize=gl_PointSize/max(.5,uPixelRatio);
 vAlpha=(.24+aSeed.w*.46)*smoothstep(0.,6.,fall)*(1.-smoothstep(100.,110.,fall));
 vTurn=aSeed.x*6.283+uPhase*(.1+aSeed.z*.1)+uDrift.z*(.3+aSeed.w*.7);vDetail=aSeed.z;
 vAspect=.72+.28*cos(uPhase*(.22+aSeed.x*.13)+aSeed.y*19.+uDrift.y*.4);
}`
const fragment=`${uniformSource}
varying float vAlpha,vTurn,vDetail,vAspect,vSize;
void main(){
 vec2 p=(gl_PointCoord-.5)*2.;float c=cos(vTurn),s=sin(vTurn);p=mat2(c,-s,s,c)*p;
 p.x/=max(.4,vAspect);
 float radius=length(p);if(radius>1.)discard;
 float angle=atan(p.y,p.x),six=abs(sin(angle*3.));
 float crystal=(1.-smoothstep(.035,.13,six*radius))*(1.-smoothstep(.72,.95,radius));
 float branches=pow(.5+.5*cos(radius*22.),9.)*(1.-smoothstep(.04,.20,six*radius));
 float soft=exp(-radius*radius*7.);
 // Subpixel crystals should read as distant snow, not flickering asterisks.
 float detail=smoothstep(.5,.9,vDetail)*smoothstep(3.,7.,vSize);
 float alpha=mix(soft,crystal*.8+branches*.35,detail)*vAlpha;
 vec3 tint=mix(uColor,uHighlight,vDetail);
 // A cool edge preserves the crystal on pale wallpaper without an opaque box.
 tint=mix(tint,uAccent*.42,smoothstep(.2,.9,radius)*.65);
 gl_FragColor=vec4(tint,alpha);
}`

/** Depth-separated snow falls softly; no opaque sky covers the user's wallpaper. */
export function createDriftingSnow(detail:number):FlowEffect{
 const group=new T.Group(),uniforms={...commonUniforms(),...reactiveUniforms()},drive=flowDriver(uniforms),random=randomStream(44123)
 const capacity=Math.round(2200*Math.max(.5,Math.min(1.3,detail))),seeds=new Float32Array(capacity*4)
 for(let i=0;i<seeds.length;i++)seeds[i]=random()
 const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(new Float32Array(capacity*3),3)).setAttribute('aSeed',new T.BufferAttribute(seeds,4))
 const snow=new T.Points(geometry,new T.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,toneMapped:false}));snow.frustumCulled=false;group.add(snow)
 return {group,update(motion,config,reduced){
   const m=config.music;drive(motion,config,reduced,.55+m.speed*.12)
   updateReactiveUniforms(uniforms,motion,'ripple',reduced)
   uniforms.uWidth.value=m.rippleWidth;uniforms.uRange.value=.6+m.rippleWidth*.5
   uniforms.uTwist.value=m.rippleTwist;uniforms.uCount.value=m.rippleLights
   geometry.setDrawRange(0,Math.round(capacity*(.25+m.rippleLights*.18)))
 }}
}
