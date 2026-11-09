import * as T from "three";
import { Batch } from "../kinetic/common";

/** Soft emitted volume behind a silhouette. Never writes depth or whitens its entire face. */
export function glowClouds(group: T.Group, capacity: number) {
  const clouds = new Batch(group, new T.PlaneGeometry(1, 1), capacity, true);
  const shader = clouds.mesh.material as T.ShaderMaterial;
  shader.vertexShader =
    "varying vec2 vUv;\n" +
    shader.vertexShader.replace(
      "vec4 p=vec4(position,1.);",
      "vUv=uv;vec4 p=vec4(position,1.);",
    );
  shader.fragmentShader = `varying vec2 vUv;varying vec3 vTint;varying float vOpacity;
    void main(){vec2 p=(vUv-.5)*2.;float r=dot(p,p);float a=exp(-r*6.)*(1.-smoothstep(.4,1.,r))*vOpacity;
      gl_FragColor=vec4(vTint*a,a);}`;
  clouds.mesh.renderOrder = 2;
  return clouds;
}
