import { expect, test } from '@playwright/test'
import { SceneMotion } from '../src/features/spectrum/three/motion'
import { reactiveMotion } from '../src/features/spectrum/three/reactive-motion'
import type { MusicEffect } from '../src/features/spectrum/music-engine/catalog'

const effects: MusicEffect[] = ['rhythm_rain', 'window_rain', 'rhythm_skin', 'ripple', 'volume_rain', 'dream_stars', 'vortex', 'petal_bloom', 'aurora_flow', 'star_flight', 'butterfly_flock', 'caustic_light', 'ginkgo_leaves', 'cosmic_web']
function source() {
  const motion = new SceneMotion()
  motion.transporting = true
  motion.frame = { audible: true, onset: false, beatIndex: 0, now: 0, bandOnsets: [true, false, false] } as any
  return motion
}

test('all refined shapes follow the source before their trailing parts, with bounded recovery and no draw-dependent movement', () => {
  for (const effect of effects) {
    const motion = source()
    let bodyPeak = 0, dragPeak = 0, bodyAt = 0, dragAt = 0, rotation = 0
    for (let step = 0; step < 600; step++) {
      motion.stepIndex++; motion.stepSeconds = 1 / 120
      motion.musicalBands.fill(step < 24 ? .8 : 0)
      motion.accents.fill(step < 9 ? .9 : 0)
      const state = reactiveMotion(motion, effect, false)
      if (state.body[1] > bodyPeak) { bodyPeak = state.body[1]; bodyAt = step }
      if (state.drag[1] > dragPeak) { dragPeak = state.drag[1]; dragAt = step }
      expect(Math.min(...state.body, ...state.drag, ...state.gesture)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...state.body, ...state.drag, ...state.gesture)).toBeLessThanOrEqual(.900001)
      expect(state.drift[2]).toBeGreaterThanOrEqual(rotation)
      rotation = state.drift[2]
      const before = JSON.stringify(state)
      reactiveMotion(motion, effect, false)
      expect(JSON.stringify(state)).toBe(before)
    }
    expect(bodyPeak, effect).toBeGreaterThan(.3)
    expect(dragPeak, effect).toBeGreaterThan(.12)
    expect(dragAt, effect).toBeGreaterThan(bodyAt)
    expect(Math.max(...reactiveMotion(motion, effect, false).body), effect).toBeLessThan(.005)
  }
})

test('captured onsets overlap, survive repeated draws and expire; steady tones never create extra beats', () => {
  const motion = source()
  let firstAge = 0
  for (let step = 0; step < 100; step++) {
    motion.stepIndex++; motion.stepSeconds = .01
    motion.frame!.onset = step === 0 || step === 15
    motion.frame!.beatIndex = step < 15 ? 1 : 2
    motion.onsetStrength = step === 15 ? .2 : .9
    const state = reactiveMotion(motion, 'rhythm_rain', false)
    if (step === 14) firstAge = state.waves[0].age
    if (step === 15) {
      expect(state.waves).toHaveLength(2)
      expect(state.waves[0].age).toBeGreaterThan(firstAge)
      expect(state.waves.map(w => w.strength)).toEqual([.9, .2])
    }
    const count = state.waves.length
    expect(reactiveMotion(motion, 'rhythm_rain', false).waves).toHaveLength(count)
  }
  expect(reactiveMotion(motion, 'rhythm_rain', false).waves).toHaveLength(2)
  motion.frame!.onset = false
  for (let i = 0; i < 400; i++) { motion.stepIndex++; reactiveMotion(motion, 'rhythm_rain', false) }
  expect(reactiveMotion(motion, 'rhythm_rain', false).waves).toHaveLength(0)
})

test('shape, drag and accumulated rotations agree at 30, 60 and 120Hz; silence and reduced motion freeze rotation', () => {
  for (const effect of effects) {
    const sample = (fps: number) => {
      const motion = source()
      for (let i = 0; i < fps * 2; i++) {
        motion.stepIndex++; motion.stepSeconds = 1 / fps
        motion.musicalBands.fill(i < fps / 2 ? .8 : .2)
        motion.accents.fill(i < fps / 10 ? .8 : 0)
        reactiveMotion(motion, effect, false)
      }
      const state = reactiveMotion(motion, effect, false)
      const values = [...state.body, ...state.drag, ...state.drift]
      const before = Array.from(state.drift)
      motion.transporting = false
      for (let i = 0; i < 30; i++) { motion.stepIndex++; reactiveMotion(motion, effect, false) }
      expect(Array.from(state.drift)).toEqual(before)
      motion.transporting = true
      for (let i = 0; i < 30; i++) { motion.stepIndex++; reactiveMotion(motion, effect, true) }
      expect(Array.from(state.drift)).toEqual(before)
      expect(state.waves).toHaveLength(0)
      return values
    }
    const fast = sample(120)
    for (const fps of [30, 60]) sample(fps).forEach((value, i) => expect(Math.abs(value - fast[i]), effect).toBeLessThan(.005))
  }
})

test('a new capture clock accepts its first attack while preserving the visual path', () => {
  const motion = source()
  motion.onsetStrength = .8; motion.accents[2] = .6
  motion.frame!.onset = true; motion.frame!.beatIndex = 1; motion.frame!.now = 1000
  motion.stepIndex++; motion.stepSeconds = .02
  const state = reactiveMotion(motion, 'ripple', false), rotation = state.drift[2]
  motion.frame!.now = 0; motion.onsetStrength = .4; motion.stepIndex++
  reactiveMotion(motion, 'ripple', false)
  expect(state.waves).toHaveLength(1)
  expect(state.waves[0].strength).toBe(.4)
  expect(state.drift[2]).toBeGreaterThanOrEqual(rotation)
})
