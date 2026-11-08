import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as T from "three";
import { useVisualFrame } from "../r3f/runtime";
import { disposeVisualTree } from "../r3f/resources";
import { SceneCamera } from "../camera";
import { compositionTime } from "./clock";
import { compositionAudio } from "./audio";
import { surfaceVertex, surfaceFragment } from "./shaders";
import { particleVertex, particleFragment } from "./particle-shaders";
import type { CompositionId } from "./presets";
import { resolveEffectPalette } from "../../effect-palette";
import { expanseFill } from "./expanse-layout";

export function CompositionCamera({ id }: { id: CompositionId }) {
  const camera = useThree((s) => s.camera) as T.PerspectiveCamera;
  const rig = useMemo(
    () => ({
      view: new SceneCamera(),
      base: new T.Vector3(),
      target: new T.Vector3(),
    }),
    [],
  );
  useVisualFrame(({ settings }) => {
    const { base, target, view } = rig;
    const fov = id === "passage" ? 61 : id === "expanse" ? 48 : 43;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (id === "sculpture") {
      base.set(1.2, 0.6, 14.5);
      target.set(0, 0, 0);
    } else if (id === "expanse") {
      const fill = expanseFill(settings.music.fieldScale);
      base.set(8 - 4 * fill, 10.5 + 11.5 * fill, 22);
      target.set(0, -0.4, -5);
    } else {
      base.set(0.7, 0.2, 13);
      target.set(0, 0, -24);
    }
    if (id !== "passage")
      base.multiplyScalar(Math.max(1, 1.35 / camera.aspect));
    base
      .sub(target)
      .multiplyScalar(1.35 / settings.music.fieldScale)
      .add(target);
    // A lyric appearing/disappearing must not toggle camera drift and snap the
    // entire scene back to its base pose. Music moves the surface, not the eye.
    view.apply(camera, base, target, settings.view);
  }, -3);
  return null;
}

export function CompositionScene({
  id,
  detail,
}: {
  id: CompositionId;
  detail: number;
}) {
  const camera = useThree((s) => s.camera) as T.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const bundle = useMemo(() => {
    const root = new T.Group(),
      materials: T.ShaderMaterial[] = [];
    root.name = `composition-${id}`;
    const particles = id !== "passage",
      count = particles ? 2 : 6;
    const geometry = particles
      ? new T.BufferGeometry()
      : new T.PlaneGeometry(1, 1, detail < 0.8 ? 192 : 288, 32);
    if (particles) {
      const columns = Math.round(
          (id === "sculpture" ? 150 : 220) *
            Math.min(1.15, Math.max(0.65, detail)),
        ),
        rows = id === "sculpture" ? 90 : 140;
      const uv = new Float32Array(columns * rows * 2),
        seed = new Float32Array(columns * rows);
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < columns; x++) {
          const i = y * columns + x,
            s = Math.abs((Math.sin(i * 127.1 + 37.7) * 43758.5453) % 1),
            sy = Math.abs((Math.sin(i * 269.5 + 91.3) * 22578.1459) % 1);
          seed[i] = s;
          // Independent stratified offsets remove diagonal rows while keeping
          // the same sample count and even coverage at viewport boundaries.
          uv[i * 2] = (x + 0.5 + (s - 0.5) * 0.92) / columns;
          uv[i * 2 + 1] = (y + 0.5 + (sy - 0.5) * 0.92) / rows;
        }
      geometry.setAttribute(
        "position",
        new T.BufferAttribute(new Float32Array(columns * rows * 3), 3),
      );
      geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
      geometry.setAttribute("aSeed", new T.BufferAttribute(seed, 1));
    }
    for (let i = 0; i < count; i++) {
      const material = new T.ShaderMaterial({
        vertexShader: particles ? particleVertex : surfaceVertex,
        fragmentShader: particles ? particleFragment : surfaceFragment,
        uniforms: {
          uTime: { value: 0 },
          uKind: { value: id === "sculpture" ? 0 : id === "expanse" ? 1 : 2 },
          uLayer: { value: i },
          uBass: { value: 0 },
          uMiddle: { value: 0 },
          uTreble: { value: 0 },
          uAccents: { value: new Float32Array(3) },
          uWaves: { value: new Float32Array(8) },
          uShape: { value: 1 },
          uPixelHeight: { value: 540 },
          uReduced: { value: 0 },
          uDaily: { value: 0 },
          uMapBend: { value: 0 },
          uMapUnfold: { value: 0 },
          uScatter: { value: 0 },
          uSeaFill: { value: 0 },
          uSeaProjection: { value: new T.Matrix4() },
          uSeaEye: { value: new T.Vector3() },
          uMain: { value: new T.Color() },
          uAccent: { value: new T.Color() },
          uHigh: { value: new T.Color() },
        },
        side: T.DoubleSide,
        transparent: true,
        depthWrite: !particles,
        toneMapped: false,
      });
      const mesh = particles
        ? new T.Points(geometry, material)
        : new T.Mesh(geometry, material);
      mesh.frustumCulled = false;
      root.add(mesh);
      materials.push(material);
    }
    return { root, materials, right: new T.Vector3(), up: new T.Vector3() };
  }, [id, detail]);
  useEffect(() => () => disposeVisualTree(bundle.root), [bundle]);
  useVisualFrame(
    ({ motion, settings, reduced, focus, mapping, transition }) => {
      const daily = settings.sceneMode === "daily",
        t = compositionTime(
          motion,
          reduced,
          daily || !!focus?.bounds,
          settings.music.speed,
          id === "passage" && !focus?.bounds ? 0.55 : 0.3,
        ),
        palette = resolveEffectPalette(settings);
      const audio = compositionAudio(motion, reduced);
      const fill =
        id === "expanse" ? expanseFill(settings.music.fieldScale) : 0;
      gl.domElement.dataset.compositionTime = t.toFixed(6);
      bundle.materials.forEach((material) => {
        const u = material.uniforms;
        u.uTime.value = t;
        u.uBass.value = audio.bands[0];
        u.uMiddle.value = audio.bands[1];
        u.uTreble.value = audio.bands[2];
        u.uAccents.value = audio.accents;
        u.uWaves.value = audio.waves;
        u.uPixelHeight.value = gl.domElement.height;
        u.uReduced.value = reduced ? 1 : 0;
        u.uDaily.value = daily ? 1 : 0;
        u.uShape.value = settings.music.fieldHeight;
        u.uSeaFill.value = fill;
        if (id === "expanse") {
          u.uSeaProjection.value.multiplyMatrices(
            camera.matrixWorld,
            camera.projectionMatrixInverse,
          );
          u.uSeaEye.value.copy(camera.position);
        }
        u.uMapBend.value = mapping?.bend ?? 0;
        u.uMapUnfold.value = mapping?.unfold ?? 0;
        u.uScatter.value = reduced ? 0 : (transition?.scatter ?? 0);
        u.uMain.value.set(palette.main);
        u.uAccent.value.set(palette.accent);
        u.uHigh.value.set(palette.high);
      });
      const root = bundle.root;
      // Position in camera axes, keeping the daily reading lane clear without a floor.
      bundle.right.setFromMatrixColumn(camera.matrixWorld, 0);
      bundle.up.setFromMatrixColumn(camera.matrixWorld, 1);
      root.position.set(0, 0, 0);
      root.scale.setScalar(1);
      if (daily) {
        if (id === "sculpture") {
          root.position.addScaledVector(bundle.right, 3.6);
          root.scale.setScalar(0.8);
        }
        if (id === "expanse") {
          root.position.addScaledVector(bundle.up, -3.7 * (1 - fill));
          root.scale.setScalar(0.85 + 0.15 * fill);
        }
        if (id === "passage") {
          root.position.addScaledVector(bundle.right, 3.8);
          root.scale.setScalar(1.05);
        }
      }
      root.rotation.set(
        id === "sculpture" ? 0.13 : 0,
        id === "sculpture" ? -0.35 + t * 0.055 : 0,
        id === "sculpture" ? -0.22 : 0,
      );
    },
    -1,
  );
  return <primitive object={bundle.root} dispose={null} />;
}
