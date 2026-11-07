import type { SceneMotion } from '../motion'

type CompositionAudio = {
  step: number
  bands: Float32Array
  accents: Float32Array
  /** Four causal onset fronts: age in seconds and captured strength. */
  waves: Float32Array
}
const states = new WeakMap<SceneMotion, CompositionAudio>()

export function compositionAudio(motion: SceneMotion, reduced: boolean) {
  let state = states.get(motion)
  if (!state) {
    state = { step: -1, bands: new Float32Array(3), accents: new Float32Array(3), waves: new Float32Array(8) }
    states.set(motion, state)
  }
  if (state.step === motion.stepIndex) return state
  state.step = motion.stepIndex
  // A short attack and a non-oscillating release shape the sustained surface.
  // Keep onsets/bright accents on their own fast path: the old .65s low-pass
  // erased articulation, whereas direct transients in geometry snapped it back.
  for (let i = 0; i < 3; i++) {
    const target = motion.musicalBands[i] * (reduced ? .12 : 1)
    const tau = target > state.bands[i] ? .045 : .24
    state.bands[i] += (target - state.bands[i]) * (1 - Math.exp(-motion.stepSeconds / tau))
    state.accents[i] = !reduced && motion.transporting ? motion.accents[i] : 0
  }
  if (reduced || !motion.transporting) state.waves.fill(0)
  else {
    for (let i = 0; i < 8; i += 2) {
      state.waves[i] += motion.stepSeconds
      if (state.waves[i] > 2.8) state.waves[i + 1] = 0
    }
    if (motion.frame?.onset && motion.onsetStrength > 0) {
      state.waves.copyWithin(2, 0, 6)
      state.waves[0] = 0
      state.waves[1] = motion.onsetStrength
    }
  }
  return state
}

export const audioShader = /* glsl */`
uniform vec3 uAccents;
uniform vec2 uWaves[4];
// Each wave begins at a detected audio onset, never at a repeating timer.
float onsetWave(float distance,float speed,float width){
  float wave=0.;
  for(int i=0;i<4;i++){
    float age=uWaves[i].x, strength=uWaves[i].y;
    float front=(distance-age*speed)/width;
    wave+=exp(-front*front)*strength*(1.-exp(-age*24.))*exp(-age*.65);
  }
  return min(wave,1.4);
}
`
