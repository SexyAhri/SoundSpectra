import { InstancedBufferAttribute, InstancedBufferGeometry, PlaneGeometry } from 'three'
import { audioUniforms } from './ambient-shaders'

/** Thin, layered sheets: no textures, full-screen blur or extra render targets. */
export function flightSheetGeometry(lanes: number, segments: number) {
  const plane = new PlaneGeometry(1, 1, segments, 1), geometry = new InstancedBufferGeometry()
  geometry.setIndex(plane.getIndex()); geometry.setAttribute('position', plane.getAttribute('position')); geometry.setAttribute('uv', plane.getAttribute('uv'))
  geometry.setAttribute('aLane', new InstancedBufferAttribute(Float32Array.from({ length: lanes }, (_, i) => i), 1))
  geometry.instanceCount = lanes; plane.dispose()
  return geometry
}

// Rings and both helices describe one moving cylinder, including its fades and tint.
const flightPath = `
const float pathLength=72.;
const float ringSpacing=14.4;
float pathRadius() { return (5.1+uBands.x*.5+uTouch*.2)*uSpread; }
vec3 pathPoint(float angle,float depth,float radius) { return vec3(cos(angle)*radius,sin(angle)*radius,10.-depth); }
float pathNear(vec3 p) { return 1.-smoothstep(15.,75.,length((modelViewMatrix*vec4(p,1.)).xyz)); }
float pathFade(float depth,vec3 p) {
  float cameraDepth=-(modelViewMatrix*vec4(p,1.)).z;
  return smoothstep(0.,7.,depth)*(1.-smoothstep(48.,pathLength,depth))
    *mix(.22,1.,pathNear(p))*smoothstep(1.5,6.,cameraDepth);
}
`

export const orbitVertex = `${audioUniforms}${flightPath}
attribute float aLane;
varying vec2 vUv;
varying float vEnergy;
varying float vFade;
varying float vLane;
varying float vTint;
void main() {
  float lane=aLane, depth=mod(lane*ringSpacing+pathLength-uPhase*4.,pathLength);
  float angle=uv.x*6.2831853;
  float bin=uv.x*47.; int k=int(floor(bin));
  float signal=mix(uSpectrum[k],uSpectrum[min(k+1,47)],fract(bin))*uVolume;
  // Concentric circles: audio changes the whole radius, never the circular contour.
  float radius=pathRadius();
  vec3 center=pathPoint(angle,depth,radius);
  float near=pathNear(center);
  radius+=(uv.y-.5)*mix(.055,.16,near);
  vec3 p=pathPoint(angle,depth,radius);
  vUv=uv; vEnergy=signal; vLane=lane; vTint=.5+.5*sin(angle);
  vFade=pathFade(depth,center);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`

export const orbitFragment = `${audioUniforms}
varying vec2 vUv;
varying float vEnergy;
varying float vFade;
varying float vLane;
varying float vTint;
void main() {
  float edge=abs(vUv.y-.5)*2.;
  float core=exp(-edge*edge*65.);
  float arc=.5+.5*sin(vUv.x*6.2831853*2.+vLane*2.-uPhase*.35);
  float nodes=pow(max(0.,cos(vUv.x*6.2831853*12.+vLane)),24.);
  float alpha=(core*.5+exp(-edge*edge*5.)*.08)*(.35+pow(arc,3.)*.3+vEnergy*.4+nodes*.06)*vFade;
  vec3 color=mix(uMid,uWarm,vTint);
  color=mix(color,uHigh,core*(.2+vEnergy*.3));
  gl_FragColor=vec4(color*alpha*uBrightness*(1.+vEnergy*.4),alpha);
}`

export const ribbonVertex = `${audioUniforms}${flightPath}
attribute float aLane;
varying vec2 vUv;
varying float vLane;
varying float vEnergy;
varying float vFade;
varying float vTint;
void main() {
  float t=uv.x, depth=t*pathLength;
  // Opposite strands cross every ring at opposite points and share its transport.
  float angle=(depth+uPhase*4.)*3.14159265/ringSpacing+aLane*3.14159265;
  float signal=uSpectrum[int(clamp(t*47.,0.,47.))]*uVolume;
  vec3 center=pathPoint(angle,depth,pathRadius());
  float radius=pathRadius()+(uv.y-.5)*mix(.07,.24,pathNear(center));
  vec3 p=pathPoint(angle,depth,radius);
  vUv=uv; vLane=aLane; vEnergy=signal; vFade=pathFade(depth,center); vTint=.5+.5*sin(angle);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`

export const ribbonFragment = `${audioUniforms}
varying vec2 vUv;
varying float vLane;
varying float vEnergy;
varying float vFade;
varying float vTint;
void main() {
  float edge=abs(vUv.y-.5)*2.;
  float flow=.5+.5*sin(vUv.x*18.-uPhase*.45+vLane*3.14159265);
  float alpha=(exp(-edge*edge*50.)*.34+exp(-edge*edge*4.)*.06)*vFade*(.6+flow*.15+vEnergy*.25);
  vec3 color=mix(uMid,uWarm,vTint);
  gl_FragColor=vec4(color*alpha*uBrightness,alpha);
}`

export const flightStarFragment = `
varying float vAlpha;
varying vec3 vColor;
varying float vSpark;
void main() {
  vec2 p=gl_PointCoord-.5;
  float r=length(p),core=exp(-r*r*65.),halo=exp(-r*r*16.);
  float rays=(exp(-abs(p.x)*90.-abs(p.y)*9.)+exp(-abs(p.y)*90.-abs(p.x)*9.))*vSpark*.15;
  float alpha=(core+halo*.18+rays)*vAlpha*smoothstep(.5,.3,r);
  if(alpha<.003)discard;
  gl_FragColor=vec4(vColor*alpha,alpha);
}`
