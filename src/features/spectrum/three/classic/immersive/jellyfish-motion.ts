import type { SceneMotion } from '../../motion'

interface JellyfishMotion {
  step: number
  time: number
  revision: number
  events: { age: number; strength: number }[]
  stroke: Float32Array
  wake: Float32Array
  tip: Float32Array
  travel: Float32Array
}
const states = new WeakMap<SceneMotion, JellyfishMotion>()

/** One causal contraction per animal; its arms follow later and its swimming
 * path keeps the distance gained by the stroke instead of springing backwards. */
export function jellyfishMotion(motion: SceneMotion, reduced: boolean) {
  let state = states.get(motion)
  if (!state) {
    state = { step: -1, time: motion.simulationTime, revision: motion.resetRevision, events: [], stroke: new Float32Array(7), wake: new Float32Array(7), tip: new Float32Array(7), travel: new Float32Array(7) }
    states.set(motion, state)
  }
  if (state.revision !== motion.resetRevision) {
    state.revision = motion.resetRevision; state.events.length = 0; state.step = -1
    state.time = motion.simulationTime
  }
  if (state.step === motion.stepIndex) return state
  state.step = motion.stepIndex
  const dt = Math.max(0, Math.min(.1, motion.stepSeconds)), active = !reduced && motion.transporting
  // Age existing attacks across absent layers; only this step adds swim travel.
  const missed = Math.max(0, motion.simulationTime - state.time - dt)
  state.time = motion.simulationTime
  for (const event of state.events) event.age += missed
  if (!active) state.events.length = 0
  else if (motion.frame?.onset && motion.onsetStrength > 0) {
    if (state.events.length === 4) state.events.shift()
    state.events.push({ age: 0, strength: motion.onsetStrength })
  }
  // Integrate the three linked responses at the same small interval at 30/120Hz.
  // Retain earlier attacks so another drum hit never resets an unfinished stroke.
  const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps
  for (let step = 0; step < steps; step++) {
    for (const event of state.events) event.age += h
    for (let id = 0; id < 7; id++) {
      const delay = id === 0 ? 0 : .035 + (id * .037) % .14
      let impulse = 0
      for (const event of state.events) {
        const age = event.age - delay
        if (age > 0 && age < 1.8) impulse = Math.max(impulse, event.strength * (1 - Math.exp(-age / .045)) * Math.exp(-age / .29) * 2)
      }
      const accent = motion.accents[0] * (id === 0 ? .65 : .28 + (id * .071) % .14)
      const target = active ? Math.min(.95, Math.max(impulse, accent) + motion.musicalBands[0] * .12) : 0
      const old = state.stroke[id], oldWake = state.wake[id]
      const tau = target > old ? .05 + id * .005 : .34 + id * .015
      state.stroke[id] += (target - old) * (1 - Math.exp(-h / tau))
      state.wake[id] += (old - oldWake) * (1 - Math.exp(-h / (.13 + id * .012)))
      state.tip[id] += (oldWake - state.tip[id]) * (1 - Math.exp(-h / (.20 + id * .014)))
      if (active) state.travel[id] += (old + state.stroke[id]) * .5 * h * (.65 + id * .045)
    }
  }
  state.events = state.events.filter(event => event.age < 2)
  return state
}

export const jellyfishMotionSource = /* glsl */`
uniform float uJellyStroke[7],uJellyWake[7],uJellyTip[7],uJellyTravel[7];
float bellStroke(float id){return uJellyStroke[int(clamp(id,0.,6.))];}
float armWake(float id){return uJellyWake[int(clamp(id,0.,6.))];}
float tipWake(float id){return uJellyTip[int(clamp(id,0.,6.))];}
float swimTravel(float id){return uJellyTravel[int(clamp(id,0.,6.))];}
`
