import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  PlaneGeometry,
} from "three";
import { audioUniforms } from "./ambient-shaders";

/** Thin, layered sheets: no textures, full-screen blur or extra render targets. */
export function flightSheetGeometry(lanes: number, segments: number) {
  const plane = new PlaneGeometry(1, 1, segments, 1),
    geometry = new InstancedBufferGeometry();
  geometry.setIndex(plane.getIndex());
  geometry.setAttribute("position", plane.getAttribute("position"));
  geometry.setAttribute("uv", plane.getAttribute("uv"));
  geometry.setAttribute(
    "aLane",
    new InstancedBufferAttribute(
      Float32Array.from({ length: lanes }, (_, i) => i),
      1,
    ),
  );
  geometry.instanceCount = lanes;
  plane.dispose();
  return geometry;
}

// Open streams share the stars' forward transport; arcs are sparse depth cues.
const flightPath = `
const float pathLength=104.;
vec2 streamCenter(float depth,float lane){
  float angle=lane*2.39996+sin(depth*.025+lane)*.22;
  float radius=(7.+lane*2.1)*(1.+uDragBands.x*.12)*uSpread;
  return vec2(cos(angle)*radius+sin(depth*.04+lane)*3.,sin(angle)*radius*.68+cos(depth*.03+lane)*2.);
}
float pathFade(float depth,vec3 p) {
  float cameraDepth=-(modelViewMatrix*vec4(p,1.)).z;
  return smoothstep(0.,10.,depth)*(1.-smoothstep(70.,pathLength,depth))*smoothstep(2.,9.,cameraDepth);
}
`;

export const flightDustVertex = `${audioUniforms}${flightPath}
uniform vec2 uResolution;
attribute vec3 aSeed;attribute float aRole;
varying float vAlpha,vSpark,vTrail;
varying vec3 vColor;
void main(){
  float depth=mod(aSeed.z*pathLength-uPhase*6.+pathLength,pathLength);
  float lane=floor(aSeed.x*5.);
  float across=fract(aSeed.x*5.);
  float angle=across*6.2831853;
  float radius=pow(aSeed.y,.65)*(2.+lane*.45)*uSpread;
  vec2 stream=streamCenter(depth,lane)+vec2(cos(angle)*radius,sin(angle)*radius*.6);
  // A quiet central population establishes distant scale between the streams.
  float central=step(.72,aSeed.y);
  stream=mix(stream,vec2((fract(aSeed.x*23.37+aSeed.y*7.1)-.5)*68.,(fract(aSeed.x*19.41+aSeed.z*3.2)-.5)*42.)*uSpread,central);
  vec3 p=vec3(stream,13.-depth);p.xy+=uPointer*.45;
  vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
  float near=1.-smoothstep(20.,70.,-mv.z);
  vTrail=step(.82,fract(aSeed.x*31.+aSeed.z*47.))*near;
  if(aRole>.5){
    vec4 tail=projectionMatrix*modelViewMatrix*vec4(p-vec3(0.,0.,.45+uBodyBands.x*.65),1.);
    if(gl_Position.w>.1&&tail.w>.1){vec2 delta=tail.xy/tail.w-gl_Position.xy/gl_Position.w;
      float pixels=length(delta*uResolution*.5);
      gl_Position.xy+=delta*min(1.,18./max(pixels,.001))*gl_Position.w;
    }
  }
  float grain=fract(aSeed.x*63.+aSeed.y*37.);
  float front=musicFront(depth/pathLength,.52,.055,vec3(1.,.65,.35));
  vSpark=step(.987,grain);
  gl_PointSize=clamp((.9+grain*2.2+vSpark*2.)*(1.+uDesktop*near*.5)*uResolution.y/600.*32./max(4.,-mv.z),.8,8.);
  vAlpha=pathFade(depth,p)*(.18+grain*.54)*(central>.5?.72:1.)*(1.+uDesktop*near*.25);
  vColor=mix(mix(uMid,uWarm,lane/5.),uHigh,grain*.75)*uBrightness
    *(.8+near*.4+uBodyBands.z*.35+front*step(.65,grain)*1.2);
}`;

export const orbitVertex = `${audioUniforms}${flightPath}
attribute float aLane;
varying vec2 vUv;varying float vFade,vLane;
void main(){
  float depth=mod(aLane*49.+pathLength-uPhase*6.,pathLength);
  float angle=uv.x*.85+aLane*3.3+.35;
  float radius=(12.+aLane*8.)*uSpread+(uv.y-.5)*.13;
  vec3 p=vec3(cos(angle)*radius,sin(angle)*radius*.7,13.-depth);
  vUv=uv;vLane=aLane;vFade=pathFade(depth,p);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`;
export const orbitFragment = `${audioUniforms}
varying vec2 vUv;varying float vFade,vLane;
void main(){
  float across=(vUv.y-.5)*2.,ends=sin(vUv.x*3.14159265);
  float front=musicFront(vUv.x,.55,.07,vec3(.6,1.,.3));
  float alpha=exp(-across*across*12.)*ends*ends*vFade*(.055+front*.12);
  gl_FragColor=vec4(mix(uMid,uHigh,.35)*alpha*uBrightness,alpha);
}`;
export const ribbonVertex = `${audioUniforms}${flightPath}
attribute float aLane;
varying vec2 vUv;varying float vFade,vLane,vLight;
void main(){
  float depth=uv.x*pathLength,across=uv.y-.5;
  vec2 center=streamCenter(depth,aLane);
  vec2 side=normalize(vec2(center.y,-center.x));
  vec3 p=vec3(center+side*across*(1.5+aLane*.25)*uSpread,13.-depth);
  vUv=uv;vLane=aLane;vFade=pathFade(depth,p);
  float front=musicFront(uv.x,.52,.07,vec3(1.,.65,.3));
  vLight=.55+front*.9+uBodyBands.y*.35;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`;
export const ribbonFragment = `${audioUniforms}
varying vec2 vUv;varying float vFade,vLane,vLight;
void main(){
  float across=(vUv.y-.5)*2.;
  float grain=.5+.5*sin(vUv.x*43.+sin(vUv.x*17.+vLane)*2.+vLane*3.-uPhase*.7);
  float filament=exp(-pow(across-sin(vUv.x*19.+vLane)*.14,2.)*150.);
  float alpha=(exp(-across*across*4.)*.018+filament*.045)*vFade*vLight*(.35+grain*.65);
  gl_FragColor=vec4(mix(uMid,uWarm,vLane*.16)*alpha*uBrightness,alpha);
}`;

export const flightStarFragment = `
varying float vAlpha;
varying vec3 vColor;
varying float vSpark;
void main() {
  vec2 p=gl_PointCoord-.5;
  float r=length(p),core=exp(-r*r*65.),halo=exp(-r*r*16.);
  float rays=(exp(-abs(p.x)*90.-abs(p.y)*9.)+exp(-abs(p.y)*90.-abs(p.x)*9.))*vSpark*.15;
  float alpha=(core+halo*.18+rays)*vAlpha*(1.-smoothstep(.3,.5,r));
  if(alpha<.003)discard;
  gl_FragColor=vec4(vColor*alpha,alpha);
}`;
