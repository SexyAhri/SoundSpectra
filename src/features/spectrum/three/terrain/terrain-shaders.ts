export const fieldVertex = `
uniform sampler2D uField;
uniform float uCell;
attribute vec2 aOffset;
attribute vec2 aSample;
attribute float aSeed;
varying vec3 vWorld;
varying vec2 vLocal;
varying vec4 vField;
varying float vDepth;
varying float vGrain;
varying float vFaceHeight;
void main() {
  vField = texture2D(uField, aSample);
  vec3 p = position;
  vLocal = position.xz / uCell + .5;
  float coverage = smoothstep(.15, .65, vField.r) * smoothstep(.03, .2, vField.g);
  p.xz *= (.94 + aSeed * .04) * mix(.12, 1., coverage);
  p.y *= vField.r;
  p.xz += aOffset;
  vWorld = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  vGrain = aSeed;
  vFaceHeight = position.y;
  vDepth = -mv.z;
}`

export const fieldFragment = `
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uWarm;
uniform vec3 uHigh;
uniform float uBrightness;
varying vec3 vWorld;
varying vec2 vLocal;
varying vec4 vField;
varying float vDepth;
varying float vGrain;
varying float vFaceHeight;
void main() {
  // Zero-height cells must not become a translucent checkerboard over wallpaper.
  if (vField.r < .12 || vField.g < .025) discard;
  vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float heat = clamp(vField.a + (vGrain - .5) * .06, 0., 1.);
  vec3 color = mix(uLow, uMid, smoothstep(.01, .3, heat));
  color = mix(color, uWarm, smoothstep(.25, .68, heat));
  color = mix(color, uHigh, pow(smoothstep(.75, 1., heat), 1.6) * .9);
  float top = max(0., normal.y);
  float shade = .23 + top * .77 + max(0., normal.x) * .22 + max(0., normal.z) * .12;
  color *= shade * mix(.6, 1., vFaceHeight) * (.92 + vGrain * .12) * uBrightness;
  float rim = 1. - smoothstep(.01, .05, min(min(vLocal.x, 1. - vLocal.x), min(vLocal.y, 1. - vLocal.y)));
  color += uWarm * (rim * top * heat * .035 + vField.b * .025);
  color = mix(color, uLow * .18, smoothstep(38., 95., vDepth) * .65);
  gl_FragColor = vec4(color, 1.);
}`
