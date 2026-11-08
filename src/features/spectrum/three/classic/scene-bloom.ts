import * as T from "three";
import { passVertex } from "../composite";
import type { SpectrumSettings } from "../../model";
import { visualQuality } from "../r3f/quality";

const profiles: Partial<Record<SpectrumSettings["effect"], [number, number]>> =
  {
    window_rain: [.9, .06],
    dream_stars: [0.55, 0.6],
    rhythm_balls: [0.6, 0.35],
    butterfly_flock: [.8, .08],

    caustic_light: [.4, .3],
    ginkgo_leaves: [.75, .1],
    cosmic_web: [.45, .26],
  };
export const bloomProfile = (
  effect: SpectrumSettings["effect"],
): [number, number] => profiles[effect] ?? [0.65, 0.23];

/** HDR, separable multiscale bloom; all targets are reused and region-budgeted. */
export class SceneBloom {
  private readonly scene = new T.Scene();
  private readonly camera = new T.Camera();
  private readonly geometry = new T.BufferGeometry().setAttribute(
    "position",
    new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  private readonly uniforms = {
    uSource: { value: null as T.Texture | null },
    uStep: { value: new T.Vector2() },
    uThreshold: { value: 0.55 },
    uExtract: { value: 0 },
    uEco: { value: 0 },
  };
  private readonly material = new T.ShaderMaterial({
    uniforms: this.uniforms,
    vertexShader: passVertex,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fragmentShader: `uniform sampler2D uSource;uniform vec2 uStep;uniform float uThreshold,uExtract,uEco;
    void main(){vec2 uv=gl_FragCoord.xy*uStep;vec3 c;
      if(uExtract>.5){c=texture2D(uSource,uv).rgb;if(uExtract<1.5){float l=max(max(c.r,c.g),c.b);float knee=.2;
        float soft=clamp(l-uThreshold+knee,0.,2.*knee);soft=soft*soft/(4.*knee+.00001);
        c*=max(l-uThreshold,soft)/max(l,.00001);}
      }else{uv=gl_FragCoord.xy/vec2(textureSize(uSource,0));
        c=texture2D(uSource,uv+uStep*1.384615).rgb*.316216+texture2D(uSource,uv-uStep*1.384615).rgb*.316216;
        if(uEco>.5)c+=texture2D(uSource,uv+uStep*.35).rgb*.183784+texture2D(uSource,uv-uStep*.35).rgb*.183784;
        else c+=texture2D(uSource,uv).rgb*.227027+(texture2D(uSource,uv+uStep*3.230769).rgb+texture2D(uSource,uv-uStep*3.230769).rgb)*.070270;
      }gl_FragColor=vec4(c,1.);}`,
  });
  private readonly levels = Array.from({ length: 3 }, () => [
    new T.WebGLRenderTarget(1, 1, {
      type: T.HalfFloatType,
      depthBuffer: false,
    }),
    new T.WebGLRenderTarget(1, 1, {
      type: T.HalfFloatType,
      depthBuffer: false,
    }),
  ]);
  count = 1;
  constructor() {
    this.scene.add(new T.Mesh(this.geometry, this.material));
  }
  prepare(renderer:T.WebGLRenderer){
    const previous=renderer.getRenderTarget();
    try{renderer.setRenderTarget(this.levels[0][0]);return renderer.compileAsync(this.scene,this.camera)}
    finally{renderer.setRenderTarget(previous)}
  }
  resize(
    width: number,
    height: number,
    quality: SpectrumSettings["quality"],
    regions: number,
    hdr: boolean,
  ) {
    this.count = visualQuality(quality, regions).bloomLevels;
    this.uniforms.uEco.value = quality === "eco" ? 1 : 0;
    const limit = regions > 1 ? Math.min(720, height / 2) : 720,
      scale = Math.min(0.5, limit / Math.max(width, height));
    this.levels.forEach((pair, i) =>
      pair.forEach((target) => {
        const type = hdr ? T.HalfFloatType : T.UnsignedByteType;
        if (target.texture.type !== type) {
          target.texture.type = type;
          target.dispose();
        }
        target.setSize(
          Math.max(1, Math.round((width * scale) / 2 ** i)),
          Math.max(1, Math.round((height * scale) / 2 ** i)),
        );
      }),
    );
  }
  draw(renderer: T.WebGLRenderer, source: T.Texture, threshold: number) {
    const u = this.uniforms;
    u.uThreshold.value = threshold;
    for (let i = 0; i < this.count; i++) {
      const [a, b] = this.levels[i];
      u.uSource.value = i ? this.levels[i - 1][0].texture : source;
      u.uExtract.value = i ? 2 : 1;
      // Only the first level extracts highlights; subsequent levels downsample existing light.
      u.uThreshold.value = i ? 0 : threshold;
      u.uStep.value.set(1 / a.width, 1 / a.height);
      renderer.setRenderTarget(a);
      renderer.render(this.scene, this.camera);
      u.uExtract.value = 0;
      u.uSource.value = a.texture;
      u.uStep.value.set(1 / a.width, 0);
      renderer.setRenderTarget(b);
      renderer.render(this.scene, this.camera);
      u.uSource.value = b.texture;
      u.uStep.value.set(0, 1 / a.height);
      renderer.setRenderTarget(a);
      renderer.render(this.scene, this.camera);
    }
  }
  texture(index: number) {
    return this.levels[Math.min(index, this.count - 1)][0].texture;
  }
  dispose() {
    this.levels.flat().forEach((target) => target.dispose());
    this.geometry.dispose();
    this.material.dispose();
  }
}
