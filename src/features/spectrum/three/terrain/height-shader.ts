/** Mirrors SceneMotion.sample; tested against its CPU reference. */
export const heightFragment = `
uniform sampler2D uSeeds;
uniform float uSpectrum[48];
uniform vec4 uLevels;
uniform float uPhase;
uniform float uHeight;
uniform float uSpeed;
uniform float uSize;
uniform float uGrid;
uniform vec4 uRipples[12];
uniform float uPointer[12];
uniform int uRippleCount;
void main() {
  vec2 uv = gl_FragCoord.xy / uGrid;
  vec2 p = (uv - .5) * uSize;
  float seed = texture2D(uSeeds, uv).r;
  float position = mod(uv.x * 30. + uv.y * 17., 47.);
  int bin = int(floor(position));
  float spectrum = clamp(mix(uSpectrum[bin], uSpectrum[bin + 1], fract(position)), 0., 1.) * uLevels.x;
  vec2 center = vec2(p.x + 2. - sin(uPhase * .27) * 3., p.y + 5.) / vec2(23., 17.);
  float footprint = exp(-dot(center, center) * 1.4);
  float ridges = .5 + .5 * sin(p.x * .23 + p.y * .17 - uPhase);
  float crossing = .5 + .5 * sin(p.y * .3 - p.x * .12 + uPhase * .65);
  float relief = .4 + ridges * .55 + crossing * .25 + (seed - .5) * .18;
  vec2 shoulder = vec2(p.x / 27., (p.y + 1.) / 25.);
  float shoulders = exp(-dot(shoulder, shoulder));
  float height = footprint * (uLevels.x * 1.4 + spectrum * 8. + uLevels.y * 6.) * relief * 1.1
    + shoulders * (uLevels.z * 2.5 + uLevels.w * 4.) * pow(seed, 7.);
  float crest = 0.;
  for (int i = 0; i < 12; i++) {
    if (i >= uRippleCount) break;
    vec4 ripple = uRipples[i];
    float front = distance(p, ripple.xy) - ripple.z * uSpeed;
    float width = 1.1 + ripple.z * .22;
    if (abs(front) > width * 4.) continue;
    float wave = cos(front * 1.45) * exp(-front * front / (width * width * 4.)) * exp(-ripple.z * .36) * ripple.w;
    height += wave * mix(.3, .65, uPointer[i]);
    crest += max(0., wave);
  }
  height = max(0., height) * uHeight;
  height = 16. * (1. - 2. / (exp(2. * height / 16.) + 1.));
  float heat = clamp((height / 10. * .8 + footprint * uLevels.x * .32 + spectrum * .15) * (.36 + footprint * .64), 0., 1.);
  gl_FragColor = vec4(height, footprint, min(1., crest * .65), heat);
}`
