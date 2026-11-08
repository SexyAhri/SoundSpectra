export const fieldVertex = `
uniform sampler2D uField;
uniform float uCell;
attribute vec2 aOffset;
attribute vec2 aSample;
attribute float aSeed;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vLocal;
varying vec4 vField;
varying float vDepth;
varying float vGrain;
varying float vFaceHeight;
void main() {
  // Every vertex reads the same height so the column cap stays planar.
  vField = texture2D(uField, aSample);
  vec3 p = position;
  vLocal = position.xz / uCell + .5;
  float coverage = smoothstep(.08, .65, vField.r) * smoothstep(.035, .2, vField.g);
  p.xz *= (.91 + aSeed * .025) * mix(.18, 1., coverage);
  p.y *= vField.r;
  p.xz += aOffset;
  vNormal = transpose(inverse(mat3(modelMatrix))) * normal;
  vWorld = (modelMatrix * vec4(p, 1.)).xyz;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  vGrain = aSeed;
  vFaceHeight = position.y;
  vDepth = -mv.z;
}`;

export const fieldFragment = `
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uWarm;
uniform vec3 uHigh;
uniform float uBrightness;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vLocal;
varying vec4 vField;
varying float vDepth;
varying float vGrain;
varying float vFaceHeight;
void main() {
  // Quiet edge cells shrink away instead of leaving a solid dark floor.
  if (vField.r < .055 || vField.g < .035) discard;
  vec3 normal = normalize(vNormal);
  float top = max(0., normal.y);
  float heat = clamp(vField.a + (vGrain - .5) * .045, 0., 1.);
  vec3 color = mix(uLow * .85, uMid, smoothstep(.015, .3, heat));
  color = mix(color, uWarm, smoothstep(.2, .7, heat) * .88);
  color = mix(color, uHigh, smoothstep(.68, 1., heat) * .65);
  float diffuse = max(0., dot(normal, normalize(vec3(-.55, .8, .45))));
  float shade = .23 + diffuse * .64 + top * .29;
  color *= shade * mix(.48, 1., vFaceHeight) * (.95 + vGrain * .1) * uBrightness;
  float strata = .5 + .5 * sin(vWorld.y * 2.5 + vGrain * .4);
  color *= 1. - (1. - top) * (.025 + strata * .045);
  float edge = min(min(vLocal.x, 1. - vLocal.x), min(vLocal.y, 1. - vLocal.y));
  float rim = 1. - smoothstep(.015, .04 + fwidth(edge), edge);
  // Grazing cap highlights describe individual columns without lighting the
  // entire grid. The travelling onset field illuminates only reached caps.
  vec3 eye=normalize(cameraPosition-vWorld);
  vec3 halfLight=normalize(eye+normalize(vec3(-.55,.8,.45)));
  float capShine=pow(max(0.,dot(normal,halfLight)),32.)*top;
  color += uWarm * (rim * top * heat * .07 + vField.b * top * .09);
  color += uHigh * capShine * heat * .075 * uBrightness;
  color = mix(color, uLow * .28, smoothstep(48., 105., vDepth) * .25);
  gl_FragColor = vec4(color, smoothstep(.055, .16, vField.r) * smoothstep(.035, .075, vField.g));
}`;
