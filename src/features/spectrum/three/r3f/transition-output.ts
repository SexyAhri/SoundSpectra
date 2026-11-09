import * as T from "three";
import { passVertex } from "../composite";
import { fullscreenGeometry } from "./resources";
import type { TransitionFrame } from "../../../performance/transition";

/** Tone mapping happens in SceneCompositor once. Byte targets store sqrt-encoded
 * premultiplied light so dim gradients survive. Decode before mixing in linear light. */
export class TransitionOutput {
  readonly live = new T.WebGLRenderTarget(1, 1, { depthBuffer: false });
  private readonly output = new T.WebGLRenderTarget(1, 1, {
    depthBuffer: false,
  });
  private readonly history = new T.WebGLRenderTarget(1, 1, {
    depthBuffer: false,
  });
  private readonly scene = new T.Scene();
  private readonly camera = new T.Camera();
  private readonly geometry = fullscreenGeometry();
  private readonly blend = new T.ShaderMaterial({
    vertexShader: passVertex,
    fragmentShader: `
    uniform sampler2D uLive,uHistory;uniform float uBlend;varying vec2 vUnused;
    uniform vec2 uSize;uniform vec4 uRegion,uMasks[8],uFocus;uniform float uFeather[8],uFocusActive;uniform int uMaskCount;
    void main(){vec2 uv=gl_FragCoord.xy/uSize;vec4 a=texture2D(uHistory,uv),b=texture2D(uLive,uv);
      a.rgb*=a.rgb;b.rgb*=b.rgb;
      vec2 p=uRegion.xy+vec2(uv.x,1.-uv.y)*uRegion.zw;
      for(int i=0;i<8;i++){if(i>=uMaskCount)break;vec4 m=uMasks[i];vec2 o=max(m.xy-p,p-m.xy-m.zw);float d=max(o.x,o.y);a*=uFeather[i]>.00001?smoothstep(-uFeather[i],0.,d):step(0.,d);}
      vec2 o=max(uFocus.xy-p,p-uFocus.xy-uFocus.zw);float f=(1.-smoothstep(-.005,.035,max(o.x,o.y)))*uFocusActive;a.rgb*=1.-f*.46;
      gl_FragColor=mix(a,b,uBlend);gl_FragColor.rgb=sqrt(max(gl_FragColor.rgb,vec3(0.)));}`,
    uniforms: {
      uLive: { value: this.live.texture },
      uHistory: { value: this.history.texture },
      uBlend: { value: 1 },
      uSize: { value: new T.Vector2() },
      uRegion: { value: new T.Vector4() },
      uMasks: { value: Array.from({ length: 8 }, () => new T.Vector4()) },
      uFeather: { value: new Float32Array(8) },
      uMaskCount: { value: 0 },
      uFocus: { value: new T.Vector4() },
      uFocusActive: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
    blending: T.NoBlending,
    toneMapped: false,
  });
  private readonly present = new T.ShaderMaterial({
    vertexShader: passVertex,
    fragmentShader: `
    uniform sampler2D uImage;uniform vec2 uSize;
    void main(){vec4 c=texture2D(uImage,gl_FragCoord.xy/uSize);c.rgb*=c.rgb;gl_FragColor=vec4(c.rgb/max(c.a,.0001),c.a);
    #include <colorspace_fragment>
    #include <premultiplied_alpha_fragment>
    }`,
    uniforms: {
      uImage: { value: this.output.texture },
      uSize: { value: new T.Vector2() },
    },
    depthTest: false,
    depthWrite: false,
    blending: T.NoBlending,
    toneMapped: false,
    premultipliedAlpha: true,
  });
  private readonly mesh = new T.Mesh(this.geometry, this.blend);
  private valid = false;
  constructor() {
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  async prepare(gl: T.WebGLRenderer) {
    const previous = gl.getRenderTarget();
    try {
      this.mesh.material = this.blend;
      gl.setRenderTarget(this.output);
      const blend = gl.compileAsync(this.scene, this.camera);
      this.mesh.material = this.present;
      gl.setRenderTarget(null);
      const present = gl.compileAsync(this.scene, this.camera);
      await Promise.all([blend, present]);
    } finally {
      gl.setRenderTarget(previous);
    }
  }
  capture(gl: T.WebGLRenderer) {
    if (!this.valid) return;
    this.history.setSize(this.output.width, this.output.height);
    gl.initRenderTarget(this.history);
    gl.copyTextureToTexture(this.output.texture, this.history.texture);
  }
  draw(
    gl: T.WebGLRenderer,
    frame: TransitionFrame | undefined,
    uniforms: Record<string, { value: unknown }>,
  ) {
    const w = gl.domElement.width,
      h = gl.domElement.height;
    if (this.output.width !== w || this.output.height !== h)
      this.output.setSize(w, h);
    const u = this.blend.uniforms;
    u.uSize.value.set(w, h);
    u.uBlend.value = this.valid ? (frame?.blend ?? 1) : 1;
    for (const key of ["uRegion", "uMasks", "uFeather", "uMaskCount"])
      u[key].value = uniforms[key].value;
    u.uFocus.value = uniforms.uFocusBounds.value;
    u.uFocusActive.value = uniforms.uFocusActive.value;
    this.mesh.material = this.blend;
    gl.setRenderTarget(this.output);
    gl.clear();
    gl.render(this.scene, this.camera);
    this.present.uniforms.uSize.value.set(w, h);
    this.mesh.material = this.present;
    gl.setRenderTarget(null);
    gl.clear();
    gl.render(this.scene, this.camera);
    this.valid = true;
  }
  resize(w: number, h: number) {
    if (this.live.width !== w || this.live.height !== h)
      this.live.setSize(w, h);
  }
  dispose() {
    this.live.dispose();
    this.output.dispose();
    this.history.dispose();
    this.geometry.dispose();
    this.blend.dispose();
    this.present.dispose();
  }
}
