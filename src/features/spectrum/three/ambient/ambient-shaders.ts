export const audioUniforms = `
uniform float uPhase;
uniform float uVolume;
uniform vec3 uBands;
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
void main() {
  float t = uv.y, s = uv.x * 2. - 1., ring = aPetal.y;
  float opening = .58 + uVolume * .65 + uBands.x * .5 + uTouch * .16;
  float angle = aPetal.x + t * (.55 + ring * .12) + sin(uPhase * .22 + aPetal.w) * .14;
  float petalWidth = pow(max(0., sin(t * 3.14159265)), .7) * (.78 - ring * .12) * aOrigin.w;
  float radius = (.24 + t * (3.5 - ring * .65)) * aOrigin.w * opening;
  vec3 p = vec3(cos(angle) * radius - sin(angle) * petalWidth * s,
    sin(angle) * radius * .88 + cos(angle) * petalWidth * s,
    pow(t, 1.5) * (1.8 + ring * .55 - opening * .8) * aOrigin.w + s * s * sin(t * 3.14159265) * .55);
  p.z += sin(t * 5. + aPetal.x - uPhase * .45) * t * uBands.y * .18;
  float tilt = .5 + aPetal.w * .12;
  p.yz = mat2(cos(tilt), sin(tilt), -sin(tilt), cos(tilt)) * p.yz;
  p.xz = mat2(cos(.3), sin(.3), -sin(.3), cos(.3)) * p.xz;
  p.xy += uPointer * (.15 + t * .3);
  p += aOrigin.xyz * vec3(uSpread, 1., 1.);
  vWorld = (modelMatrix * vec4(p, 1.)).xyz; vUv = uv; vLayer = ring;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
}`

export const petalFragment = `${audioUniforms}
varying vec2 vUv;
varying vec3 vWorld;
varying float vLayer;
void main() {
  vec3 normal = cross(dFdx(vWorld), dFdy(vWorld));
  normal /= max(length(normal), .00001);
  vec3 view = normalize(cameraPosition - vWorld);
  float rim = pow(clamp(1. - abs(dot(normal, view)), 0., 1.), 1.6);
  float vein = pow(.5 + .5 * sin(vUv.x * 65. + sin(vUv.y * 6.) * 3.), 8.);
  float edge = pow(max(0., sin(vUv.x * 3.14159265)), .5) * pow(max(0., sin(vUv.y * 3.14159265)), .35);
  vec3 color = mix(uWarm, uMid, smoothstep(.08, .95, vUv.y));
  color = mix(color, uHigh, rim * .18 + vein * .04);
  float diffuse = .65 + .35 * abs(dot(normal, normalize(vec3(-.4,.7,1.))));
  color *= (diffuse + rim * .15 + uVolume * .1) * uBrightness;
  float alpha = edge * (.48 + rim * .15) * (1. - vLayer * .08);
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
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec3 p = position; p.x *= uSpread; p.xy += uPointer * .15;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(32. * (1. + uBands.x * .4 + uTouch * .25) * 15. / max(1., -mv.z) * uResolution.y / 900., 8., 56.);
  vColor = uHigh * uBrightness; vAlpha = .85;
}`
