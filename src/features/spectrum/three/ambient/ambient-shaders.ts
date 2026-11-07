export const audioUniforms = `
uniform float uPhase;
uniform float uVolume;
uniform float uSustain,uOnsetAge,uOnsetStrength;
uniform vec3 uBands;
uniform vec3 uAccents;
uniform float uSpectrum[48];
uniform float uTouch;
uniform vec2 uPointer;
uniform float uSpread;
uniform float uBrightness;
uniform vec3 uMid;
uniform vec3 uWarm;
uniform vec3 uHigh;
`

export const petalVertex = `${audioUniforms}
attribute vec4 aPetal;
attribute vec4 aOrigin;
varying vec2 vUv;
varying vec3 vWorld;
varying float vLayer;
varying float vSeed;
void main() {
  float t=uv.y,s=uv.x*2.-1.,ring=max(0.,aPetal.y),seed=aPetal.z;
  float opening=.78+uSustain*.13+uBands.y*.09+uTouch*.07;
  float angle=aPetal.x+sin(uPhase*.14+aPetal.w*2.)*.065+t*.09*sin(seed*13.);
  float outline=pow(max(0.,sin(t*3.14159265)),.72);
  float width=outline*(.73-ring*.11)*(1.+s*.055*sin(seed*17.));
  float radius=.12+t*(3.25-ring*.64)*( .94+seed*.12)*opening;
  float cup=t*t*(.68+ring*.24)+pow(t,7.)*(.35+seed*.24);
  vec3 p=vec3(cos(angle)*radius-sin(angle)*width*s,
    sin(angle)*radius+cos(angle)*width*s,cup+s*s*outline*.24+ring*.13);
  float front=t-uOnsetAge*1.9,attack=1.-exp(-uOnsetAge*22.);
  float response=exp(-front*front*65.)*attack*attack*exp(-uOnsetAge*3.5)*uOnsetStrength;
  p.z+=response*.34*(.25+.75*seed)+t*t*sin(uPhase*.31+seed*9.)*(.04+uAccents.y*.16);
  p*=aOrigin.w;
  if(aPetal.y<0.){
    float drift=uPhase*(.28+seed*.23);
    p.y+=sin(drift+seed*13.)*.4;
    float turn=angle+drift*.25;
    p.xz=mat2(cos(turn),sin(turn),-sin(turn),cos(turn))*p.xz;
  }
  float tilt=.22+aPetal.w*.12;
  p.yz = mat2(cos(tilt), sin(tilt), -sin(tilt), cos(tilt)) * p.yz;
  p.xy+=uPointer*(.06+t*.08);
  p+=aOrigin.xyz*vec3(uSpread,1.,1.);
  if(aPetal.y<0.)p.y+=sin(uPhase*.22+seed*16.)*1.5;
  vWorld=(modelMatrix*vec4(p,1.)).xyz;vUv=uv;vLayer=ring;vSeed=seed;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
}`

export const petalFragment = `${audioUniforms}
varying vec2 vUv;
varying vec3 vWorld;
varying float vLayer;
varying float vSeed;
void main() {
  vec3 normal = cross(dFdx(vWorld), dFdy(vWorld));
  normal /= max(length(normal), .00001);
  vec3 view=cameraPosition-vWorld;view/=max(length(view),.00001);
  float rim = pow(clamp(1. - abs(dot(normal, view)), 0., 1.), 1.6);
  float t=clamp(vUv.y,0.,1.),across=abs(vUv.x*2.-1.);
  float vein=pow(max(0.,.5+.5*cos(vUv.x*95.+sin(t*8.+vSeed*9.)*1.8)),14.);
  float edge=(1.-smoothstep(.84,1.,across))*smoothstep(0.,.055,t)*(1.-smoothstep(.975,1.,t));
  vec3 ivory=mix(uHigh,vec3(1.,.97,.91),.08);
  vec3 blush=mix(uMid,ivory,.12);
  vec3 color=mix(blush,ivory,smoothstep(.12,.94,t)*.42);
  color=mix(color,uWarm,exp(-t*8.)*.24);
  float diffuse=.56+.44*abs(dot(normal,normalize(vec3(-.6,.8,1.))));
  float silk=pow(max(0.,dot(reflect(normalize(vec3(.6,-.8,-1.)),normal),view)),28.);
  color*=diffuse*.86+rim*.14+vein*.025;
  color+=ivory*(silk*.13+uAccents.z*.10*pow(t,6.)*step(.7,vSeed));
  color*=uBrightness;
  float alpha=edge*(.88+rim*.08);
  if(alpha<.01)discard;
  gl_FragColor = vec4(color, alpha);
}`

export const dustVertex = `${audioUniforms}
uniform vec2 uResolution;
uniform float uMode;
attribute vec3 aSeed;
attribute float aRole;
varying float vAlpha;
varying vec3 vColor;
varying float vSpark;
varying float vTrail;
void main() {
  vec3 p;
  float fade = 1.;
  if (uMode > .5 && uMode < 1.5) {
    float depth = mod(aSeed.z * 90. - uPhase * 12., 90.);
    float angle = aSeed.x * 6.2831853 + sin(uPhase * .1) * .05;
    float radius = (2.3 + pow(aSeed.y, .6) * 24.) * uSpread;
    p = vec3(cos(angle) * radius, sin(angle) * radius * .75, 14. - depth);
    p.xy += uPointer * (depth / 20. + .2);
    fade = smoothstep(0., 5., depth) * (1. - smoothstep(65., 90., depth));
  } else {
    p = vec3((aSeed.x - .5) * 44., (aSeed.y - .5) * 24., -aSeed.z * 30.);
    p.x += sin(uPhase * .2 + aSeed.y * 14.) * (.3 + uBands.y * .6);
    p.y += sin(uPhase * .15 + aSeed.x * 11.) * .45;
    p.xy *= uSpread;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((2. + aSeed.y * 2.5) * 18. / max(1., -mv.z) * uResolution.y / 900., .7, 13.);
  vAlpha = fade * (.2 + aSeed.y * .6) * (uMode > 1.5 ? .35 : 1.);
  vColor = mix(uMid, uHigh, aSeed.x) * uBrightness * (.7 + uBands.z * 1.4 + uTouch * .2);
  vSpark = 0.;
  vTrail = 0.;
  if (uMode > .5 && uMode < 1.5) {
    float distanceToCamera=length(mv.xyz);
    float near=1.-smoothstep(18.,52.,distanceToCamera);
    // Only a stable minority of nearby stars get tails; no per-frame random flicker.
    vTrail=step(.82,fract(aSeed.x*41.+aSeed.y*23.+aSeed.z*59.))*near;
    if(aRole>.5) {
      vec4 tail=projectionMatrix*modelViewMatrix*vec4(p-vec3(0.,0.,.21+uVolume*1.19),1.);
      if(gl_Position.w>.1 && tail.w>.1) {
        vec2 delta=tail.xy/tail.w-gl_Position.xy/gl_Position.w;
        float pixels=length(delta*uResolution*.5);
        // Bound close-camera perspective streaks as well as their world-space length.
        gl_Position.xy+=delta*min(1.,(8.*uResolution.y/900.)/max(pixels,.001))*gl_Position.w;
      }
    }
    vSpark = step(.99, fract(aSeed.x * 73. + aSeed.z * 17.));
    gl_PointSize = min(18., max(gl_PointSize * 1.25, 1.7 * uResolution.y / 900.) * (1. + vSpark * 1.5));
    vColor = mix(mix(uMid, uWarm, aSeed.x), uHigh, step(.78, aSeed.y) * .8)
      * uBrightness * (1. + uBands.z * 1.05 + vSpark * .4 + uTouch * .2);
    vAlpha *= mix(.6,.95,1.-smoothstep(15.,85.,distanceToCamera));
  }
}`

export const dustFragment = `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord - .5;
  float alpha = exp(-dot(p,p) * 22.) * vAlpha;
  if (dot(p,p) > .25 || alpha < .01) discard;
  gl_FragColor = vec4(vColor * alpha, alpha);
}`

export const trailFragment = `
varying float vAlpha;
varying vec3 vColor;
varying float vTrail;
void main() { float alpha = vAlpha * vTrail * .2; if(alpha<.002)discard; gl_FragColor = vec4(vColor * alpha, alpha); }
`

export const coreVertex = `${audioUniforms}
uniform vec2 uResolution;
attribute vec4 aOrigin;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec3 p=position*aOrigin.w;float tilt=.22+floor(float(gl_VertexID)/129.)*.12;
  p.yz=mat2(cos(tilt),sin(tilt),-sin(tilt),cos(tilt))*p.yz;
  p+=aOrigin.xyz*vec3(uSpread,1.,1.);p.xy+=uPointer*.06;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize=clamp(3.4*aOrigin.w*18./max(1.,-mv.z)*uResolution.y/900.,1.,5.);
  vColor=mix(mix(uWarm,uHigh,.6),vec3(.86,.60,.24),.24)*uBrightness*(.85+uAccents.z*.3);vAlpha=.95;
}`
