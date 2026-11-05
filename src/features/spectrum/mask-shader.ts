// Apply masks after every effect's own entry point, including early returns.
// Screen coordinates use a top-left origin in both preview and desktop.
export function withSceneMasks(source: string) {
  return source.replace(/void main\s*\(\s*\)/, 'void drawEffect()') + `
uniform vec4 u_maskBounds[8];
uniform float u_maskFeather[8];
uniform int u_maskCount;
uniform vec4 u_regionBounds;
uniform vec2 u_maskSize;
void main() {
  drawEffect();
  vec2 local = vec2(gl_FragCoord.x / u_maskSize.x, 1.0 - gl_FragCoord.y / u_maskSize.y);
  vec2 point = u_regionBounds.xy + local * u_regionBounds.zw;
  float visible = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= u_maskCount) break;
    vec4 mask = u_maskBounds[i];
    vec2 outside = max(mask.xy - point, point - mask.xy - mask.zw);
    float distance = max(outside.x, outside.y);
    float feather = u_maskFeather[i];
    visible *= feather > 0.00001 ? smoothstep(-feather, 0.0, distance) : step(0.0, distance);
  }
  outColor *= visible;
}`
}
