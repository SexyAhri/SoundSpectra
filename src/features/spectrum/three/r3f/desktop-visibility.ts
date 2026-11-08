import type { SpectrumEffect } from "../../model";

/** Thin luminous details need coverage and a narrow contrast edge on wallpaper. */
const profiles: Partial<Record<SpectrumEffect, readonly [number, number]>> = {
  rhythm_balls: [1.65, 0.22],
  rhythm_rain: [2.4, 0.5],
  ripple: [2.2, 0.5],
  volume_rain: [2.1, 0.4],
  star_flight: [2.4, 0.45],
  cosmic_web: [2.2, 0.4],
  aurora_flow: [1.4, 0.12],
  tidal_knot: [1.7, 0.25],
  layered_tides: [1.7, 0.25],
};
const unchanged = [1, 0] as const;
export const desktopVisibility = (effect: SpectrumEffect) =>
  profiles[effect] ?? unchanged;

export const desktopVisibilitySource = /* glsl */ `
uniform vec2 uDesktopVisibility;
// Use actual luminous fragments, not the footprint of a transparent mesh.
// Empty pixels remain empty; a broad backing plane would obscure wallpaper.
float desktopFeature(vec4 sampleColor){
  float light=max(max(sampleColor.r,sampleColor.g),sampleColor.b)*uSceneBrightness;
  return clamp(sampleColor.a,0.,1.)*smoothstep(.002,.06,light);
}
`;

export const desktopVisibilityComposite = /* glsl */ `
  if(uImmersive<.5){
    float coverage=terrain.a;
    float strengthened=1.-pow(1.-coverage,uDesktopVisibility.x);
    terrain.rgb*=strengthened/max(coverage,.0001);
    terrain.a=strengthened;
    if(uDesktopVisibility.y>0.){
      vec2 pixel=vec2(clamp(uResolution.y/720.,1.,2.))/uResolution;
      float edge=desktopFeature(texture2D(uImage,uv));
      edge=max(edge,desktopFeature(texture2D(uImage,uv+vec2(pixel.x,0.))));
      edge=max(edge,desktopFeature(texture2D(uImage,uv-vec2(pixel.x,0.))));
      edge=max(edge,desktopFeature(texture2D(uImage,uv+vec2(0.,pixel.y))));
      edge=max(edge,desktopFeature(texture2D(uImage,uv-vec2(0.,pixel.y))));
      float support=edge*uDesktopVisibility.y*(1.-terrain.a)*(1.-focusMask*.85);
      terrain.rgb+=min(uLow*.08,vec3(.025))*support;
      terrain.a+=support;
    }
  }
`;
