import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  AdditiveBlending,
  Color,
} from "three";
import { sampleInk } from "./glyph-dust";
import type { LyricPalette } from "./lyric-palette";

/** Reuse the panel's rasterized ink, with a bounded point buffer per panel. */
export function foldedDust(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  palette: LyricPalette,
  limit: number,
) {
  const samples = sampleInk(data, width, height, limit);
  const positions: number[] = [],
    seeds: number[] = [];
  samples.forEach((p) => {
    positions.push(p.x / 192 - 0.125, 0.75 - p.y / 192, 0.002);
    seeds.push(p.seed, p.x / width);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new Float32BufferAttribute(seeds, 2));
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      release: { value: 0 },
      accent: { value: 0 },
      flow: { value: 0 },
      resolution: { value: 1 },
      cyan: { value: new Color(palette.prism[0]) },
      violet: { value: new Color(palette.prism[1]) },
    },
    vertexShader: `attribute vec2 aSeed; uniform float release,accent,flow,resolution;
      varying float vAlpha,vSeed;
      void main(){float delay=aSeed.y*.32;float age=clamp((release-delay)/(1.-delay),0.,1.);
        float travel=age*age,side=aSeed.x>.5?1.:-1.;float reach=1.8+aSeed.x*2.;
        vec3 p=position;p.x+=reach*travel*(flow>.5&&flow<1.5?side:1.);
        p.y+=flow>1.5?reach*age*.7-sin(age*5.+aSeed.x*6.)*age*.3:reach*travel*(.3+aSeed.x*.5);
        p.z+=flow>.5&&flow<1.5?reach*travel*.8:0.;
        vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
        float size=length(modelViewMatrix[0].xyz)*.024*(1.+accent*.2);
        gl_PointSize=clamp(size*projectionMatrix[1][1]*resolution/max(1.,-mv.z),.6,4.);
        vAlpha=sin(min(1.,age*5.)*1.5707963)*pow(1.-age,1.4)*(.85+accent*.12);vSeed=aSeed.x;
      }`,
    fragmentShader: `uniform vec3 cyan,violet;varying float vAlpha,vSeed;
      void main(){float d=length(gl_PointCoord-.5);float a=(1.-smoothstep(.2,.5,d))*vAlpha;
        if(a<.005)discard;gl_FragColor=vec4(mix(cyan,violet,vSeed),a);
        #include <colorspace_fragment>
      }`,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 4;
  points.visible = false;
  return {
    points,
    material,
    count: samples.length,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
