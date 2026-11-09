import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
} from "three";
import type { LyricPalette } from "./lyric-palette";
import { quietLyricAudio, type LyricAudio } from "./lyric-audio";

/** A fixed pool of prismatic sails and angular slivers sharing the captured music accents. */
export function createFoldedStage(palette: LyricPalette) {
  const count = 36,
    geometry = new PlaneGeometry(1, 1);
  const fades = new Float32Array(count);
  geometry.setAttribute("fade", new InstancedBufferAttribute(fades, 1));
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: `attribute float fade; varying vec2 vUv; varying vec3 vColor; varying float vFade;
      void main(){vUv=uv;vColor=instanceColor;vFade=fade;
        gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 vUv;varying vec3 vColor;varying float vFade;
      void main(){vec2 p=vUv;float cut=smoothstep(.0,.025,p.x-p.y*.28)*(1.-smoothstep(.975,1.,p.x-p.y*.28+.28));
        float tip=pow(max(0.,1.-abs(p.x*2.-1.)),.45);float edge=pow(max(0.,1.-abs(p.y*2.-1.)),2.);
        float crease=exp(-abs(p.y-.48)*55.)*.8;float a=(edge*.38+crease)*tip*cut*vFade;
        gl_FragColor=vec4(vColor,a);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  const color = new Color();
  const setPalette = (palette: LyricPalette) => {
    for (let i = 0; i < count; i++)
      mesh.setColorAt(i, color.set(palette.prism[i % 3]));
    mesh.instanceColor!.needsUpdate = true;
  };
  setPalette(palette);
  const pose = new Object3D();
  return {
    mesh,
    setPalette,
    update(
      time: number,
      width: number,
      height: number,
      energy: number,
      visible: boolean,
      reduced: boolean,
      variant: number,
      audio: Readonly<LyricAudio> = quietLyricAudio,
    ) {
      mesh.visible = visible && !reduced;
      if (!mesh.visible) return;
      const t = time / 1000,
        short = height < width * 0.2;
      for (let i = 0; i < count; i++) {
        const seed = (i * 0.61803398875) % 1,
          sail = i < 8;
        const cycle = (t * (0.14 + seed * 0.08) + seed) % 1;
        const spread = (cycle - 0.5) * 2;
        const side = i % 2 ? 1 : -1;
        if (sail) {
          pose.position.set(
            side * width * (0.12 + seed * 0.3) +
              Math.sin(t * 0.6 + i) * width * 0.018,
            Math.sin(i * 2.4 + t * 0.42) * height * (short ? 0.22 : 0.35) +
              side * audio.bass * height * 0.025,
            -100 - i * 12,
          );
          pose.scale.set(
            width * (0.22 + seed * 0.18) * (1 + audio.body * 0.08),
            height * (0.08 + seed * 0.1),
            1,
          );
          pose.rotation.set(
            Math.sin(t * 0.35 + i) * 0.3,
            side * (0.35 + Math.sin(t * 0.3 + i) * 0.18),
            side * (0.24 + seed * 0.34) * (short ? 0.24 : 1) + variant * 0.04,
          );
          fades[i] =
            (0.32 + energy * 0.65) * (0.6 + 0.4 * Math.sin(t + i) ** 2);
        } else {
          pose.position.set(
            spread * width * 0.49,
            Math.sin(i * 7.1) * height * 0.42 + side * energy * height * 0.12,
            -25 - seed * 70,
          );
          pose.scale.set(
            (3 + seed * 25) * (1 + energy * 0.8),
            (1 + seed * 2.8) * (1 + audio.treble * 0.45),
            1,
          );
          pose.rotation.set(0, 0, side * (0.4 + seed * 1.1) + t * 0.22);
          fades[i] = Math.sin(cycle * Math.PI) ** 2 * (0.18 + energy * 0.75);
        }
        pose.updateMatrix();
        mesh.setMatrixAt(i, pose.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      geometry.attributes.fade.needsUpdate = true;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
