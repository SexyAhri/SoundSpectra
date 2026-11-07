import { useEffect, useMemo } from "react";
import { createPortal, useThree } from "@react-three/fiber";
import * as T from "three";
import { FIELD_SIZE } from "../motion";
import { heightFragment } from "../terrain/height-shader";
import { fieldFragment, fieldVertex } from "../terrain/terrain-shaders";
import { createTerrainGrid } from "../terrain/terrain-grid";
import { passVertex } from "../composite";
import { resolveEffectPalette } from "../../effect-palette";
import { fullscreenGeometry } from "./resources";
import { useVisualFrame, useVisualRuntime } from "./runtime";

/** The height prepass stays on the GPU; only the seed texture changes with quality. */
export function TerrainLayer({ grid }: { grid: number }) {
  const gl = useThree((state) => state.gl);
  const runtime = useVisualRuntime();
  const resources = useMemo(() => {
    const field = createTerrainGrid(grid),
      scene = new T.Scene(),
      camera = new T.Camera(),
      geometry = fullscreenGeometry();
    const target = new T.WebGLRenderTarget(grid, grid, {
      type: T.HalfFloatType,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
      depthBuffer: false,
    });
    const height = {
      uSeeds: { value: field.texture },
      uSpectrum: { value: new Float32Array(48) },
      uLevels: { value: new T.Vector4() },
      uMass: { value: new T.Vector2() },
      uPhase: { value: 0 },
      uHeight: { value: 1 },
      uSpeed: { value: 1 },
      uSize: { value: FIELD_SIZE },
      uGrid: { value: grid },
      uRipples: { value: Array.from({ length: 12 }, () => new T.Vector4()) },
      uPointer: { value: new Float32Array(12) },
      uRippleCount: { value: 0 },
    };
    const uniforms = {
      uField: { value: target.texture },
      uCell: { value: field.step },
      uLow: { value: new T.Color() },
      uMid: { value: new T.Color() },
      uWarm: { value: new T.Color() },
      uHigh: { value: new T.Color() },
      uBrightness: { value: 1 },
    };
    const material = new T.ShaderMaterial({
      uniforms,
      vertexShader: fieldVertex,
      fragmentShader: fieldFragment,
      depthWrite: true,
      transparent: true,
      blending: T.NormalBlending,
      toneMapped: false,
    });
    const heightMaterial = new T.ShaderMaterial({
      uniforms: height,
      vertexShader: passVertex,
      fragmentShader: heightFragment,
      depthTest: false,
      depthWrite: false,
      blending: T.NoBlending,
      toneMapped: false,
    });
    return {
      field,
      scene,
      camera,
      geometry,
      target,
      height,
      uniforms,
      material,
      heightMaterial,
    };
  }, [grid]);
  useEffect(() => {
    const prepare=()=>{
      const previous=gl.getRenderTarget();
      try{gl.setRenderTarget(resources.target);return gl.compileAsync(resources.scene,resources.camera)}
      finally{gl.setRenderTarget(previous)}
    };
    runtime.diagnostics.preparations?.add(prepare);
    Object.assign(runtime.diagnostics, {
      heightTarget: resources.target,
      grid,
      seeds: resources.field.seeds,
    });
    gl.domElement.dataset.heightPass = "gpu";
    gl.domElement.dataset.cells = String(resources.field.count);
    return () => {
      runtime.diagnostics.preparations?.delete(prepare);
      delete runtime.diagnostics.heightTarget;
      delete runtime.diagnostics.grid;
      delete runtime.diagnostics.seeds;
      resources.field.geometry.dispose();
      resources.field.texture.dispose();
      resources.geometry.dispose();
      resources.target.dispose();
      resources.material.dispose();
      resources.heightMaterial.dispose();
    };
  }, [resources, gl, runtime, grid]);
  useVisualFrame(({ settings: config, motion }) => {
    const { height: h, uniforms: u } = resources,
      palette = resolveEffectPalette(config);
    u.uLow.value.set(palette.low);
    u.uMid.value.set(palette.main);
    u.uWarm.value.set(palette.accent);
    u.uHigh.value.set(palette.high);
    u.uBrightness.value = (config.music.fieldBrightness / 45) * 1.12;
    if (motion.frame) h.uSpectrum.value.set(motion.terrainSpectrum);
    else h.uSpectrum.value.fill(0);
    h.uLevels.value.set(
      motion.volume,
      motion.bass,
      motion.terrainPeaks[0],
      motion.terrainPeaks[1],
    );
    h.uPhase.value = motion.phase;
    h.uMass.value.fromArray(motion.terrainMass);
    h.uHeight.value = config.music.fieldHeight;
    h.uSpeed.value =
      (2.9 + config.music.speed * 0.35) * config.music.fieldSpread;
    h.uRippleCount.value = motion.ripples.length;
    motion.ripples.forEach((ripple, i) => {
      h.uRipples.value[i].set(
        ripple.x,
        ripple.z,
        ripple.age,
        ripple.strength *
          (ripple.source === 'music' ? (1 - Math.exp(-ripple.lifetime * 10)) ** 2 : 1) *
          Math.exp(-Math.max(0, ripple.lifetime - ripple.age) * 0.36),
      );
      h.uPointer.value[i] = ripple.source === "pointer" ? 1 : 0;
    });
    if (runtime.presentationPaused) return;
    gl.setRenderTarget(resources.target);
    gl.clear();
    gl.render(resources.scene, resources.camera);
    gl.setRenderTarget(null);
  }, -1);
  return (
    <>
      {createPortal(
        <mesh
          geometry={resources.geometry}
          material={resources.heightMaterial}
          frustumCulled={false}
          dispose={null}
        />,
        resources.scene,
      )}
      <mesh
        geometry={resources.field.geometry}
        material={resources.material}
        frustumCulled={false}
        dispose={null}
      />
    </>
  );
}
