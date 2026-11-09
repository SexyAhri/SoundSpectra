/** Mirrors SceneMotion.sample; tested against its CPU reference. */
export const heightFragment = `
uniform sampler2D uSeeds;
uniform float uSpectrum[48];
uniform vec4 uLevels;
uniform vec2 uMass;
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
  float position = clamp(uv.x * 39. + sin(p.y * .09 - uPhase * .3) * 4. + 3., 0., 47.);
  int bin = min(46, int(floor(position)));
  float spectrum = clamp(mix(uSpectrum[bin], uSpectrum[bin + 1], position-float(bin)), 0., 1.) * uLevels.x;
  vec2 center = vec2(p.x + 2. - sin(uPhase * .1) * .8, p.y + 5.) / vec2(23., 17.);
  float footprint = exp(-dot(center, center) * 1.4);
  // Cusped crests and unequal shoulders read as a rock ridge, not a soft dome.
  float ridgeAxis = p.x * .23 + p.y * .17 - uPhase + sin(p.y * .15) * .38;
  float ridges = 1. - abs(sin((ridgeAxis - 1.5707963268) * .5));
  float crossing = .5 + .5 * sin(p.y * .3 - p.x * .12 - uPhase * .65);
  float relief = .14 + pow(ridges,2.4)*1.85 + pow(crossing,4.)*.2 + (seed - .5) * .008;
  vec2 shoulder = vec2(p.x / 27., (p.y + 1.) / 25.);
  float shoulders = exp(-dot(shoulder, shoulder));
  float height = footprint * (uMass.x * 2.5 + spectrum * 5.2 + uMass.y * 3.8) * relief * 1.8
    + shoulders * (uLevels.z * 3.8 + uLevels.w * 4.) * pow(ridges * crossing, 3.);
  float crest = 0.;
  for (int i = 0; i < 12; i++) {
    if (i >= uRippleCount) break;
    vec4 ripple = uRipples[i];
    float front = distance(p, ripple.xy) - ripple.z * uSpeed;
    float width = 1.1 + ripple.z * .22;
    if (abs(front) > width * 4.) continue;
    float wave = cos(front * 1.45) * exp(-front * front / (width * width * 4.)) * exp(-ripple.z * .36) * ripple.w;
    height += wave * mix(.24, .8, uPointer[i]);
    crest += max(0., wave);
  }
  height = max(footprint * uLevels.x * .65, height) * uHeight * 2.2;
  height = 16. * (1. - 2. / (exp(2. * height / 16.) + 1.));
  // Continuous ledges: each layer joins its neighbors without a height jump.
  float layerWarp = sin(p.x * .15 + p.y * .19) * .11;
  float layer = height / 3. + layerWarp;
  float terraced = (floor(layer) + smoothstep(.2,.8,fract(layer)) - layerWarp) * 3.;
  height = max(0., mix(height,terraced,.32*smoothstep(1.2,5.,height)));
  float heat = clamp((height / 10. * .8 + footprint * uLevels.x * .32 + spectrum * .15) * (.36 + footprint * .64), 0., 1.);
  gl_FragColor = vec4(height, footprint, min(1., crest * .65), heat);
}`;
