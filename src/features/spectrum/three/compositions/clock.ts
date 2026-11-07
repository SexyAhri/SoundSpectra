import type { SceneMotion } from '../motion'

// Owned by the accepted simulation, not React lifetime or GPU render count.
// Switching compositions retains the path. Silence/reduced motion freezes travel.
const clocks = new WeakMap<SceneMotion, { step: number; time: number; speed: number }>()
export function compositionTime(motion: SceneMotion, reduced: boolean, restrained = false, speed = 1, restraint = .3) {
  let state = clocks.get(motion)
  if (!state) { state = { step: -1, time: 0, speed: 0 }; clocks.set(motion, state) }
  if (state.step !== motion.stepIndex) {
    state.step = motion.stepIndex
    if (!reduced && motion.transporting) {
      const dt = motion.stepSeconds, target = (.28 + motion.energy * .95 + motion.musicalBands[0] * .35) * (.45 + speed * .55) * (restrained ? restraint : 1)
      const decay = Math.exp(-dt / .24)
      state.time += target * dt + (state.speed - target) * .24 * (1 - decay)
      state.speed = target + (state.speed - target) * decay
    } else state.speed = 0
  }
  return state.time
}
