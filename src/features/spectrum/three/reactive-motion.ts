import * as T from 'three'
import type { MusicEffect } from '../music-engine/catalog'
import type { SceneMotion } from './motion'

interface Gesture { age: number; strength: number; origin: number; band: number }
interface Response {
  step: number; beat: number; clock: number; body: Float64Array; drag: Float64Array
  gesture: Float64Array; drift: Float64Array; waves: Gesture[]
}
const states = new WeakMap<SceneMotion, Map<MusicEffect, Response>>()
const profiles: Partial<Record<MusicEffect, readonly [number, number, number]>> = {
  butterfly_flock: [.16, .7, .28], caustic_light: [.3,.8,.4],
  ginkgo_leaves: [.22, .9, .38], cosmic_web: [.3, 1.1, .45],
  rhythm_rain: [.09, .32, .13], ripple: [.28, .65, .32], volume_rain: [.20, .60, .26],
  rhythm_skin: [.18, .62, .24], dream_stars: [.36, .9, .38], vortex: [.15, .48, .22],
  petal_bloom: [.22, .72, .30], aurora_flow: [.30, .85, .38], star_flight: [.12, .40, .18],
}

/** Shape, trailing shape and local gestures have separate response times.
 * State belongs to the accepted analysis step, surviving layer recreation and
 * extra GPU draws. Captured onsets overlap instead of restarting one impulse.
 */
export function reactiveMotion(motion: SceneMotion, effect: MusicEffect, reduced: boolean) {
  let effects = states.get(motion)
  if (!effects) { effects = new Map(); states.set(motion, effects) }
  let state = effects.get(effect)
  if (!state) {
    state = { step: -1, beat: -1, clock: -1, body: new Float64Array(3), drag: new Float64Array(3),
      gesture: new Float64Array(3), drift: new Float64Array(3), waves: [] }
    effects.set(effect, state)
  }
  if (state.step === motion.stepIndex) return state
  state.step = motion.stepIndex
  const dt = motion.stepSeconds, frame = motion.frame
  if (frame && frame.now < state.clock) {
    state.waves.length = 0; state.beat = -1
  }
  if (frame) state.clock = frame.now
  const [attack, release, lag] = profiles[effect] ?? [.2, .6, .25]
  for (const wave of state.waves) wave.age += dt
  state.waves = state.waves.filter(wave => wave.age < 3)
  if (reduced) state.waves.length = 0
  if (!reduced && motion.transporting && frame?.onset && frame.beatIndex !== state.beat) {
    state.beat = frame.beatIndex
    if (state.waves.length === 8) state.waves.shift()
    const band = frame.bandOnsets[0] ? 0 : frame.bandOnsets[1] ? 1 : 2
    state.waves.push({ age: 0, strength: motion.onsetStrength,
      origin: ((frame.beatIndex * .61803398875) % 1 + 1) % 1, band })
  }
  // Substeps keep the trailing response and integrated rotations consistent
  // across display rates. No oscillator can overshoot or reverse the transport.
  const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps
  for (let step = 0; step < steps; step++) for (let band = 0; band < 3; band++) {
    const target = frame?.audible ? motion.musicalBands[band] : 0
    const body = state.body[band], gesture = state.gesture[band]
    state.body[band] += (target - body) * (1 - Math.exp(-h / (target > body ? attack : release)))
    state.drag[band] += (body - state.drag[band]) * (1 - Math.exp(-h / lag))
    const accent = reduced ? 0 : motion.accents[band]
    state.gesture[band] += (accent - gesture) * (1 - Math.exp(-h / (accent > gesture ? .045 : .24)))
    if (!reduced && motion.transporting) state.drift[band] += (gesture + state.gesture[band]) * .5 * h
  }
  return state
}

export const reactiveUniforms = () => ({
  uBodyBands: { value: new T.Vector3() }, uDragBands: { value: new T.Vector3() },
  uGesture: { value: new T.Vector3() }, uDrift: { value: new T.Vector3() },
  uMusicWaveCount: { value: 0 },
  uMusicWaves: { value: Array.from({ length: 8 }, () => new T.Vector4(10, 0, 0, 0)) },
})
export function updateReactiveUniforms(u: ReturnType<typeof reactiveUniforms>, motion: SceneMotion, effect: MusicEffect, reduced: boolean) {
  const state = reactiveMotion(motion, effect, reduced)
  u.uBodyBands.value.fromArray(state.body); u.uDragBands.value.fromArray(state.drag)
  u.uGesture.value.fromArray(state.gesture); u.uDrift.value.fromArray(state.drift)
  u.uMusicWaveCount.value = state.waves.length
  u.uMusicWaves.value.forEach((value, i) => {
    const wave = state.waves[i]
    value.set(wave?.age ?? 10, wave?.strength ?? 0, wave?.origin ?? 0, wave?.band ?? 0)
  })
}
export const reactiveSource = `
uniform vec3 uBodyBands,uDragBands,uGesture,uDrift;
uniform int uMusicWaveCount;
uniform vec4 uMusicWaves[8];
float musicFront(float position,float speed,float width,vec3 weights){
  float value=0.;
  for(int i=0;i<8;i++){
    if(i>=uMusicWaveCount)break;
    vec4 wave=uMusicWaves[i];
    float front=abs(position-wave.z)-wave.x*speed;
    if(abs(front)>width*4.)continue;
    float attack=1.-exp(-wave.x*28.);
    float weight=wave.w<.5?weights.x:wave.w<1.5?weights.y:weights.z;
    value+=exp(-front*front/max(.0001,width*width))*attack*attack*exp(-wave.x*2.1)*wave.y*weight;
  }
  return min(1.5,value);
}
float musicFront(float position,float speed,float width){return musicFront(position,speed,width,vec3(1.));}
`
