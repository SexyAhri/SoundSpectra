import * as T from "three";
import type { SpectrumSettings } from "../../../model";
import type { SceneMotion } from "../../motion";
import {
  resolveEffectPalette,
  type EffectPalette,
} from "../../../effect-palette";
import { effectDefinitions } from "../../../effect-definitions";

export interface FlowEffect {
  group: T.Group;
  layout?(aspect: number): void;
  update(motion: SceneMotion, config: SpectrumSettings, reduced: boolean): void;
}

export const TAU = Math.PI * 2;
export const commonUniforms = () => ({
  uPhase: { value: 0 },
  uVolume: { value: 0 },
  uBass: { value: 0 },
  uMiddle: { value: 0 },
  uTreble: { value: 0 },
  uPulse: { value: 0 },
  uTouch: { value: 0 },
  uColor: { value: new T.Color("#59d9ff") },
  uAccent: { value: new T.Color("#a08cff") },
  uHighlight: { value: new T.Color() },
  uShade: { value: new T.Color() },
  uWidth: { value: 1 },
  uTrail: { value: 1 },
  uRange: { value: 1 },
  uCount: { value: 1 },
  uTwist: { value: 1 },
  uDepth: { value: 1 },
  uThreshold: { value: 0 },
  uPixelRatio: { value: 1 },
  uSlowBass: { value: 0 },
  uBassFast: { value: 0 },
  uSlowMid: { value: 0 },
  uFastHigh: { value: 0 },
  uBeatGlow: { value: 0 },
  uSustain: { value: 0 },
  uOnsetAge: { value: 10 },
  uOnsetStrength: { value: 0 },
  uOnsetOrigin: { value: 0 },
  uAccents: { value: new T.Vector3() },
  uSpectrum: { value: new Float32Array(48) },
});
export type FlowUniforms = ReturnType<typeof commonUniforms>;
export function applyFlowPalette(
  uniforms: FlowUniforms,
  config: SpectrumSettings,
) {
  const palette = resolveEffectPalette(config);
  uniforms.uColor.value.set(palette.main);
  uniforms.uAccent.value.set(palette.accent);
  uniforms.uHighlight.value.set(palette.high);
  uniforms.uShade.value.set(palette.low);
  return palette;
}

/** The frame clock only advances visible transport while actual audio is audible. */
export function flowDriver(uniforms: FlowUniforms) {
  let level = 0,
    palette: EffectPalette | undefined,
    last = -1,
    beat = -1;
  return (
    motion: SceneMotion,
    config: SpectrumSettings,
    reduced: boolean,
    speed = 1,
  ) => {
    const frame = motion.frame;
    // Camera changes and offscreen passes may draw the same analysis frame again.
    // Transport and smoothing belong to that frame, not to the number of draws.
    const dt = frame && motion.stepIndex !== last ? motion.stepSeconds : 0;
    const profile = effectDefinitions[config.effect].motion;
    const phase = motion.flowPhase(
      config.effect,
      speed,
      profile.sustainFlow,
      reduced,
    );
    const tau = 0.06;
    level += (motion.volume - level) * (1 - Math.exp(-dt / tau));
    const damp = (
      value: number,
      target: number,
      attack: number,
      release: number,
    ) =>
      value +
      (target - value) *
        (1 - Math.exp(-dt / (target > value ? attack : release)));
    uniforms.uSlowBass.value = damp(
      uniforms.uSlowBass.value,
      motion.musicalBands[0],
      0.08,
      profile.bassRelease,
    );
    uniforms.uBassFast.value = damp(
      uniforms.uBassFast.value,
      Math.max(motion.musicalBands[0], motion.accents[0]),
      0.02,
      0.16,
    );
    uniforms.uSlowMid.value = damp(
      uniforms.uSlowMid.value,
      motion.musicalBands[1],
      profile.middleAttack,
      profile.middleAttack,
    );
    uniforms.uFastHigh.value = damp(
      uniforms.uFastHigh.value,
      Math.max(motion.musicalBands[2], motion.accents[2]),
      0.03,
      profile.highRelease,
    );
    uniforms.uSustain.value = damp(
      uniforms.uSustain.value,
      frame?.audible ? frame.sustain : 0,
      0.3,
      0.22,
    );
    uniforms.uOnsetAge.value = Number.isFinite(frame?.beatAge)
      ? Math.min(10, Math.max(0, frame!.beatAge / 1000))
      : 10;
    uniforms.uOnsetStrength.value = motion.onsetStrength;
    uniforms.uOnsetOrigin.value =
      ((((frame?.beatIndex ?? 0) * 0.61803398875) % 1) + 1) % 1;
    uniforms.uBeatGlow.value *= Math.exp(
      -dt / Math.min(0.25, profile.onsetLife),
    );
    if (!reduced && frame?.audible) {
      uniforms.uBeatGlow.value = Math.max(
        uniforms.uBeatGlow.value,
        motion.accents[0],
        motion.accents[1] * 0.65,
      );
      if (frame.onset && frame.beatIndex !== beat) beat = frame.beatIndex;
    }
    if (reduced) uniforms.uBeatGlow.value = 0;
    uniforms.uPhase.value = phase;
    uniforms.uVolume.value = level;
    uniforms.uBass.value = motion.bass;
    uniforms.uMiddle.value = motion.middle;
    uniforms.uTreble.value = motion.treble;
    uniforms.uPulse.value = reduced ? 0 : Math.max(0, frame?.pulse ?? 0);
    uniforms.uAccents.value.fromArray(motion.accents);
    if (frame) uniforms.uSpectrum.value.set(frame.spectrum);
    else uniforms.uSpectrum.value.fill(0);
    uniforms.uTouch.value = motion.ripples.reduce(
      (value, ripple) =>
        ripple.source === "pointer"
          ? Math.max(value, Math.exp(-ripple.lifetime * 1.3))
          : value,
      0,
    );
    const nextPalette = resolveEffectPalette(config);
    if (palette !== nextPalette) {
      palette = applyFlowPalette(uniforms, config);
    }
    uniforms.uThreshold.value = 0;
    last = motion.stepIndex;
    return dt;
  };
}

export const uniformSource = `
uniform float uPhase,uVolume,uBass,uMiddle,uTreble,uPulse,uTouch;
uniform float uWidth,uTrail,uRange,uCount,uTwist,uDepth,uThreshold,uPixelRatio;
uniform float uSustain,uOnsetAge,uOnsetStrength,uOnsetOrigin;
uniform vec3 uColor,uAccent,uHighlight,uShade;
uniform vec3 uAccents;
uniform float uSpectrum[48];
`;

/** UV coordinates describe a 3D tube/surface, never a texture billboard. */
export function surfaceGeometry(segments: number, sides: number, lanes = 1) {
  const plane = new T.PlaneGeometry(1, 1, segments, sides);
  const geometry = new T.InstancedBufferGeometry();
  geometry.setIndex(plane.getIndex());
  geometry.setAttribute("position", plane.getAttribute("position"));
  geometry.setAttribute("uv", plane.getAttribute("uv"));
  geometry.setAttribute(
    "aLane",
    new T.InstancedBufferAttribute(
      Float32Array.from({ length: lanes }, (_, i) => i),
      1,
    ),
  );
  geometry.instanceCount = lanes;
  plane.dispose();
  return geometry;
}

export const surfaceVertex = (body: string, helpers = "") => `${uniformSource}
attribute float aLane;
varying vec3 vWorld;
varying vec2 vUv;
varying float vLane,vAlpha,vLight;
const float PI=3.14159265, TAU=6.2831853;
${helpers}
void main(){
  float t=uv.x, a=uv.y*TAU, lane=aLane;
  vec3 p=vec3(0.); vAlpha=1.; vLight=0.;
  ${body}
  vWorld=(modelMatrix*vec4(p,1.)).xyz; vUv=uv; vLane=lane;
  gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
}`;

export const surfaceFragment = `${uniformSource}
varying vec3 vWorld;
varying vec2 vUv;
varying float vLane,vAlpha,vLight;
void main(){
  if(vAlpha<.008)discard;
  vec3 n=cross(dFdx(vWorld),dFdy(vWorld));n/=max(length(n),.00001);
  if(!gl_FrontFacing)n=-n;
  vec3 view=cameraPosition-vWorld;view/=max(length(view),.00001);
  vec3 light=normalize(vec3(-.5,.8,.7));
  float diffuse=.2+.8*abs(dot(n,light));
  // Unit-vector dot products can round above one at face-on fragments. A
  // negative base with a fractional exponent produces NaN and poisons bloom.
  float rim=pow(clamp(1.-abs(dot(n,view)),0.,1.),3.2);
  float shine=pow(max(0.,dot(reflect(-light,n),view)),52.);
  float tint=.5+.5*sin(vUv.x*6.2831853+vLane*1.4-uPhase*.12);
  vec3 lightColor=mix(uColor,uAccent,tint*.55);
  // Dark structural volume is distinct from its crisp emissive contour.
  vec3 color=lightColor*(.035+diffuse*.09+rim*.7+vLight*.85)
    +mix(lightColor,vec3(1.),.65)*shine*.25;
  float alpha=clamp(vAlpha,0.,.96);
  if(max(max(color.r,color.g),color.b)*alpha<uThreshold*.35)discard;
  gl_FragColor=vec4(color,alpha);
}`;

export function material(
  uniforms: FlowUniforms,
  vertexShader: string,
  fragmentShader = surfaceFragment,
  additive = false,
) {
  return new T.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: T.DoubleSide,
    transparent: true,
    depthWrite: !additive,
    depthTest: true,
    blending: additive ? T.AdditiveBlending : T.NormalBlending,
    toneMapped: false,
  });
}

export function mesh(
  group: T.Group,
  geometry: T.BufferGeometry,
  shader: T.ShaderMaterial,
) {
  const object = new T.Mesh(geometry, shader);
  object.frustumCulled = false;
  group.add(object);
  return object;
}

export function randomStream(seed = 17291) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** A stable local normal frame around a differentiable 3D curve. */
export const tubeFrame = `
vec3 tangent=normalize(curve(min(1.,t+.002),lane)-curve(max(0.,t-.002),lane));
vec3 side=normalize(cross(tangent,vec3(0,1,0)));
vec3 up=normalize(cross(side,tangent));
`;

export const silkFragment = `${uniformSource}
varying vec3 vWorld;
varying vec2 vUv;
varying float vLane,vAlpha,vLight;
void main(){
  if(vAlpha<.008)discard;
  vec3 n=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
  vec3 view=normalize(cameraPosition-vWorld);
  float across=cos(vUv.y*6.2831853);
  float edge=pow(abs(across),38.);
  float filament=pow(.5+.5*cos(across*27.+sin(vUv.x*16.-uPhase*.7)*.8),35.);
  float travel=pow(.5+.5*sin(vUv.x*22.-uPhase*2.+vLane*2.),6.);
  float rim=pow(1.-abs(dot(n,view)),3.);
  vec3 tint=mix(uColor,uAccent,.5+.45*sin(vUv.x*5.+vLane*1.7));
  vec3 color=tint*(.055+rim*.2+edge*.9+filament*(.08+travel*.45)+vLight*.12);
  gl_FragColor=vec4(color,clamp(vAlpha,0.,.94));
}`;
