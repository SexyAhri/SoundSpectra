import { test, expect } from '@playwright/test'
import { SceneMotion } from '../src/features/spectrum/three/motion'
import { jellyfishMotion } from '../src/features/spectrum/three/classic/immersive/jellyfish-motion'

const source = () => {
  const motion = new SceneMotion()
  motion.transporting = true
  motion.frame = { onset: false } as any
  return motion
}

test('a captured bass attack contracts the bell before its trailing arms, and never retracts gained travel', () => {
  const motion = source()
  let strokePeak = 0, wakePeak = 0, tipPeak = 0, strokeTime = 0, wakeTime = 0, tipTime = 0, previousTravel = 0
  for (let frame = 0; frame < 180; frame++) {
    motion.stepIndex++; motion.stepSeconds = 1 / 120
    motion.frame!.onset = frame === 0
    motion.onsetStrength = .9
    motion.accents[0] = frame < 6 ? .8 : 0
    const state = jellyfishMotion(motion, false)
    if (state.stroke[0] > strokePeak) { strokePeak = state.stroke[0]; strokeTime = frame }
    if (state.wake[0] > wakePeak) { wakePeak = state.wake[0]; wakeTime = frame }
    if (state.tip[0] > tipPeak) { tipPeak = state.tip[0]; tipTime = frame }
    expect(state.travel[0]).toBeGreaterThanOrEqual(previousTravel)
    previousTravel = state.travel[0]
    const repeat = jellyfishMotion(motion, false)
    expect(repeat.travel[0]).toBe(previousTravel)
  }
  expect(strokePeak).toBeGreaterThan(.45)
  expect(wakePeak).toBeGreaterThan(.25)
  expect(wakeTime).toBeGreaterThan(strokeTime)
  expect(tipPeak).toBeGreaterThan(.15)
  expect(tipTime).toBeGreaterThan(wakeTime)
  expect(previousTravel).toBeGreaterThan(.08)
})

test('a second onset preserves an unfinished contraction and the animals respond at different times', () => {
  const single = source(), repeated = source()
  let delayed = false
  for (let frame = 0; frame < 80; frame++) {
    for (const motion of [single, repeated]) {
      motion.stepIndex++; motion.stepSeconds = 1 / 120
      motion.onsetStrength = frame === 15 ? .2 : .9
      motion.frame!.onset = frame === 0 || (motion === repeated && frame === 15)
    }
    const a = jellyfishMotion(single, false), b = jellyfishMotion(repeated, false)
    expect(b.stroke[0]).toBeGreaterThanOrEqual(a.stroke[0] - 1e-6)
    if (a.stroke[0] > .2 && a.stroke[1] < .1) delayed = true
  }
  expect(delayed).toBe(true)
})

test('linked bell and tentacle inertia stays consistent at 30, 60 and 120Hz', () => {
  const sample = (fps: number) => {
    const motion = source()
    for (let frame = 0; frame < fps * 2; frame++) {
      motion.stepIndex++; motion.stepSeconds = 1 / fps
      motion.frame!.onset = frame === 0 || frame === fps
      motion.onsetStrength = .9
      jellyfishMotion(motion, false)
    }
    const state = jellyfishMotion(motion, false)
    return [...state.stroke, ...state.wake, ...state.tip, ...state.travel]
  }
  const fast = sample(120)
  for (const fps of [30, 60]) sample(fps).forEach((value, i) => expect(Math.abs(value - fast[i])).toBeLessThan(1e-5))
})

test('treble does not pump the entire bell and reduced motion or silence stops propulsion', () => {
  const motion = source()
  motion.accents[2] = .9; motion.musicalBands[2] = .8
  for (let i = 0; i < 30; i++) { motion.stepIndex++; motion.stepSeconds = 1 / 60; jellyfishMotion(motion, false) }
  expect(Array.from(jellyfishMotion(motion, false).stroke)).toEqual(Array(7).fill(0))
  motion.accents[0] = .8
  for (let i = 0; i < 12; i++) { motion.stepIndex++; jellyfishMotion(motion, false) }
  const before = Array.from(jellyfishMotion(motion, false).travel)
  for (let i = 0; i < 120; i++) { motion.stepIndex++; jellyfishMotion(motion, true) }
  expect(Array.from(jellyfishMotion(motion, true).travel)).toEqual(before)
  expect(Math.max(...jellyfishMotion(motion, true).stroke)).toBeLessThan(.01)
  motion.transporting = false
  for (let i = 0; i < 30; i++) { motion.stepIndex++; jellyfishMotion(motion, false) }
  expect(Array.from(jellyfishMotion(motion, false).travel)).toEqual(before)
})
