import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as T from "three";
import type { AmbientEffect, MusicEffect } from "../../music-engine/catalog";
import { resolveEffectPalette } from "../../effect-palette";
import {
  auroraGeometry,
  petalGeometry,
  petalCoreGeometry,
  dustGeometry,
} from "../ambient/ambient-geometry";
import { auroraVertex, auroraFragment } from "../ambient/aurora-shaders";
import {
  petalVertex,
  petalFragment,
  dustVertex,
  dustFragment,
  coreVertex,
  pollenVertex,
  trailFragment,
} from "../ambient/ambient-shaders";
import {
  flightSheetGeometry,
  orbitVertex,
  orbitFragment,
  ribbonVertex,
  ribbonFragment,
  flightStarFragment,
  flightDustVertex,
} from "../ambient/star-flight";
import { useVisualFrame } from "./runtime";
import { reactiveUniforms, updateReactiveUniforms } from "../reactive-motion";

export function useLightFieldUniforms(effect: MusicEffect) {
  const gl = useThree((state) => state.gl);
  const u = useMemo(
    () => ({
      ...reactiveUniforms(),
      uAuroraPhase: { value: 0 },
      uPhase: { value: 0 },
      uVolume: { value: 0 },
      uSustain: { value: 0 },
      uOnsetAge: { value: 10 },
      uOnsetStrength: { value: 0 },
      uBands: { value: new T.Vector3() },
      uSpectrum: { value: new Float32Array(48) },
      uTouch: { value: 0 },
      uPointer: { value: new T.Vector2() },
      uSpread: { value: 1 },
      uBrightness: { value: 1 },
      uDesktop: { value: 0 },
      uMode: {
        value: effect === "star_flight" ? 1 : effect === "aurora_flow" ? 2 : 0,
      },
      uLow: { value: new T.Color() },
      uMid: { value: new T.Color() },
      uWarm: { value: new T.Color() },
      uHigh: { value: new T.Color() },
      uResolution: { value: new T.Vector2(1, 1) },
      uImpulse: { value: 0 },
      uAccents: { value: new T.Vector3() },
    }),
    [effect],
  );
  useVisualFrame(({ settings: config, motion, pointer, reduced, dt }) => {
    const palette = resolveEffectPalette(config),
      aurora = effect === "aurora_flow";
    u.uLow.value.set(palette.low);
    u.uMid.value.set(aurora ? palette.accent : palette.main);
    u.uWarm.value.set(aurora ? palette.main : palette.accent);
    u.uHigh.value.set(palette.high);
    u.uAuroraPhase.value = motion.auroraPhase;
    u.uPhase.value = motion.flowPhase(
      effect,
      0.8 + config.music.speed * 0.16,
      0.25,
      reduced,
    );
    updateReactiveUniforms(u, motion, effect, reduced);
    u.uVolume.value = motion.energy;
    u.uSustain.value = motion.frame?.audible ? motion.frame.sustain : 0;
    u.uOnsetAge.value = Math.min(
      10,
      Math.max(0, (motion.frame?.beatAge ?? 10000) / 1000),
    );
    u.uOnsetStrength.value = motion.onsetStrength;
    u.uBands.value.fromArray(motion.musicalBands);
    u.uAccents.value.fromArray(motion.accents);
    if (motion.frame) u.uSpectrum.value.set(motion.frame.spectrum);
    else u.uSpectrum.value.fill(0);
    u.uTouch.value = motion.ripples.reduce(
      (value, ripple) =>
        ripple.source === "pointer"
          ? Math.max(value, Math.exp(-ripple.lifetime * 1.2))
          : value,
      0,
    );
    u.uPointer.value.lerp(pointer, reduced ? 1 : 1 - Math.exp(-dt / 0.1));
    u.uSpread.value = config.music.ambientSpread;
    u.uBrightness.value = config.music.fieldBrightness / 45;
    u.uDesktop.value = config.sceneMode === "daily" ? 1 : 0;
    u.uResolution.value.set(gl.domElement.width, gl.domElement.height);
    u.uImpulse.value = reduced ? 0 : (motion.frame?.pulse ?? 0);
  }, -1);
  return u;
}
export type LightFieldUniforms = ReturnType<typeof useLightFieldUniforms>;

/** A reusable GPU layer: attach authored geometry and share audio/palette uniforms. */
export function LightSurface({
  geometry,
  uniforms,
  vertex,
  fragment,
  additive = false,
  kind = "mesh",
  depthWrite = false,
}: {
  geometry: T.BufferGeometry;
  uniforms: LightFieldUniforms;
  vertex: string;
  fragment: string;
  additive?: boolean;
  kind?: "mesh" | "points" | "lines";
  depthWrite?: boolean;
}) {
  const material = useMemo(
    () =>
      new T.ShaderMaterial({
        uniforms,
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite,
        side: T.DoubleSide,
        blending: additive ? T.AdditiveBlending : T.NormalBlending,
        premultipliedAlpha: additive,
        toneMapped: false,
      }),
    [uniforms, vertex, fragment, additive, depthWrite],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  if (kind === "points")
    return (
      <points
        geometry={geometry}
        material={material}
        frustumCulled={false}
        dispose={null}
      />
    );
  if (kind === "lines")
    return (
      <lineSegments
        geometry={geometry}
        material={material}
        frustumCulled={false}
        dispose={null}
      />
    );
  return (
    <mesh
      geometry={geometry}
      material={material}
      frustumCulled={false}
      dispose={null}
    />
  );
}
export function ParticleField({
  count,
  uniforms,
  flight = false,
  trails = false,
  petals = false,
}: {
  count: number;
  uniforms: LightFieldUniforms;
  flight?: boolean;
  trails?: boolean;
  petals?: boolean;
}) {
  const geometry = useMemo(() => dustGeometry(count, trails), [count, trails]);
  return (
    <LightSurface
      geometry={geometry}
      uniforms={uniforms}
      vertex={flight ? flightDustVertex : petals ? pollenVertex : dustVertex}
      fragment={
        trails ? trailFragment : flight ? flightStarFragment : dustFragment
      }
      additive
      kind={trails ? "lines" : "points"}
    />
  );
}
export function AmbientLayers({
  effect,
  detail,
}: {
  effect: AmbientEffect;
  detail: number;
}) {
  const uniforms = useLightFieldUniforms(effect),
    gl = useThree((state) => state.gl);
  const flight = effect === "star_flight",
    aurora = effect === "aurora_flow";
  const geometry = useMemo(
    () =>
      flight ? null : aurora ? auroraGeometry(detail) : petalGeometry(detail),
    [flight, aurora, detail],
  );
  const cores = useMemo(
    () => (flight || aurora ? null : petalCoreGeometry()),
    [flight, aurora],
  );
  const segments = Math.max(96, Math.round(160 * Math.min(detail, 1.4)));
  const sheets = useMemo(
    () =>
      flight
        ? [flightSheetGeometry(2, segments), flightSheetGeometry(5, segments)]
        : [],
    [flight, segments],
  );
  const count = Math.max(
    48,
    Math.round((flight ? 4200 : aurora ? 240 : 90) * detail),
  );
  useEffect(() => {
    gl.domElement.dataset.items = String(count);
  }, [gl, count]);
  return (
    <group name={`light-field:${effect}`}>
      {geometry && (
        <LightSurface
          geometry={geometry}
          uniforms={uniforms}
          vertex={aurora ? auroraVertex : petalVertex}
          fragment={aurora ? auroraFragment : petalFragment}
          additive={aurora}
          depthWrite={!aurora}
        />
      )}
      {cores && (
        <LightSurface
          geometry={cores}
          uniforms={uniforms}
          vertex={coreVertex}
          fragment={dustFragment}
          additive
          kind="points"
        />
      )}
      <ParticleField
        count={count}
        uniforms={uniforms}
        flight={flight}
        petals={!flight && !aurora}
      />
      {flight && (
        <>
          <ParticleField count={count} uniforms={uniforms} flight trails />
          <LightSurface
            geometry={sheets[0]}
            uniforms={uniforms}
            vertex={orbitVertex}
            fragment={orbitFragment}
            additive
          />
          <LightSurface
            geometry={sheets[1]}
            uniforms={uniforms}
            vertex={ribbonVertex}
            fragment={ribbonFragment}
            additive
          />
        </>
      )}
    </group>
  );
}
