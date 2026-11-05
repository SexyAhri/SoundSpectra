export const passVertex = `
void main() { gl_Position = vec4(position.xy, 0., 1.); }
`

export const compositeFragment = `
uniform sampler2D uImage;
uniform vec3 uLow;
uniform vec3 uWarm;
uniform float uOpacity;
uniform float uImmersive;
uniform vec2 uResolution;
uniform vec4 uRegion;
uniform vec4 uMasks[8];
uniform float uFeather[8];
uniform int uMaskCount;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec4 terrain = texture2D(uImage, uv);
  vec2 sky = (uv - vec2(.5, .49)) * vec2(1.1, 1.6);
  float halo = exp(-dot(sky, sky) * 11.);
  vec3 backdrop = mix(uLow * .08, uLow * .24, uv.y) + uWarm * halo * .055;
  float pool = (1. - smoothstep(.46, .88, length((uv - vec2(.5, .32)) * vec2(1.1, 1.3)))) * .97;
  float backdropAlpha = mix(pool, .985, uImmersive);
  float alpha = terrain.a + backdropAlpha * (1. - terrain.a);
  vec3 color = (terrain.rgb + backdrop * backdropAlpha * (1. - terrain.a)) / max(alpha, .0001);
  float border = smoothstep(0., .025, uv.x) * smoothstep(0., .025, 1. - uv.x)
    * smoothstep(0., .025, uv.y) * smoothstep(0., .025, 1. - uv.y);
  alpha *= uOpacity * mix(border, 1., uImmersive);
  vec2 point = uRegion.xy + vec2(uv.x, 1. - uv.y) * uRegion.zw;
  for (int i = 0; i < 8; i++) {
    if (i >= uMaskCount) break;
    vec4 mask = uMasks[i];
    vec2 outside = max(mask.xy - point, point - mask.xy - mask.zw);
    float distance = max(outside.x, outside.y);
    alpha *= uFeather[i] > .00001 ? smoothstep(-uFeather[i], 0., distance) : step(0., distance);
  }
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}`
