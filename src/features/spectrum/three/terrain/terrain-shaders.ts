export const fieldVertex = `
uniform sampler2D uField;
uniform float uCell;
attribute vec2 aOffset;
attribute vec2 aSample;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vField;
varying float vDepth;
vec4 fieldAt(vec2 uv) {
  return texture2D(uField,uv);
}
void main() {
  vec3 p = position;
  vec2 resolution=vec2(textureSize(uField,0));
  vec2 uv=aSample+position.xz/uCell/resolution;
  vField = fieldAt(uv);
  vec2 texel=1./resolution;
  float dx=fieldAt(uv+vec2(texel.x,0.)).r-fieldAt(uv-vec2(texel.x,0.)).r;
  float dz=fieldAt(uv+vec2(0.,texel.y)).r-fieldAt(uv-vec2(0.,texel.y)).r;
  // Height gradients describe the authored ridge, rather than exposing every
  // regular mesh triangle as a repeated tooth along its crest.
  vNormal=transpose(inverse(mat3(modelMatrix)))*vec3(-dx,2.*uCell,-dz);
  p.y = vField.r;
  p.xz += aOffset;
  vWorld = (modelMatrix * vec4(p, 1.)).xyz;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  vDepth = -mv.z;
}`

export const fieldFragment = `
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uWarm;
uniform vec3 uHigh;
uniform float uBrightness;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vField;
varying float vDepth;
float stoneGrain(vec3 p) {
  vec3 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  vec3 stepSize=vec3(1.,57.,113.);
  float base=dot(cell,stepSize);
  vec4 a=fract(sin(base+vec4(0.,1.,57.,58.))*43758.5453);
  vec4 b=fract(sin(base+vec4(113.,114.,170.,171.))*43758.5453);
  return mix(mix(mix(a.x,a.y,f.x),mix(a.z,a.w,f.x),f.y),
    mix(mix(b.x,b.y,f.x),mix(b.z,b.w,f.x),f.y),f.z);
}
void main() {
  if (vField.r < .001 || vField.g < .025) discard;
  vec3 normal = vNormal;
  normal /= max(length(normal), .00001);
  float heat = clamp(vField.a, 0., 1.);
  float top=clamp(normal.y,0.,1.),face=1.-smoothstep(.4,.88,top);
  float grain=stoneGrain(vWorld*3.6);
  float grainVisibility=1.-smoothstep(.6,1.8,length(fwidth(vWorld*3.6)));
  float stratum=vWorld.y/ .82+sin(vWorld.x*.15+vWorld.z*.19)*.11;
  float seam=1.-smoothstep(.035,.035+max(.025,fwidth(stratum)*.8),abs(fract(stratum)-.18));
  float band=.5+.5*sin(stratum*2.39996);
  vec3 cap=mix(uLow*.6,uMid,smoothstep(.02,.34,heat));
  cap=mix(cap,mix(uWarm,uHigh,.26),smoothstep(.28,.92,heat)*.9);
  vec3 cut=mix(cap*.72,uWarm,.09+band*.12);
  vec3 color=mix(cap,cut,face*.8);
  color*=1.-seam*(.025+face*.27);
  color*=1.+(grain-.5)*.08*grainVisibility;
  vec3 light=normalize(vec3(-.72,.72,.32));
  float diffuse=max(0.,dot(normal,light));
  float shade=.24+diffuse*.96+top*.08;
  color*=shade*uBrightness;
  // Crest light stays on sharp, exposed slopes; it does not soften whole hills.
  float crest=smoothstep(.28,.75,heat)*max(0.,dot(normal,normalize(vec3(.6,.3,-.5))));
  color+=uHigh*crest*.055+uWarm*vField.b*face*.045;
  color=mix(color,uLow*.24,smoothstep(48.,105.,vDepth)*.32);
  gl_FragColor = vec4(color, smoothstep(.035,.055,vField.g)*smoothstep(0.,.05,vField.r));
}`
