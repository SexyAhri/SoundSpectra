import { expect, test } from '@playwright/test'
import { SceneMotion } from '../src/features/spectrum/three/motion'
import { reactiveMotion } from '../src/features/spectrum/three/reactive-motion'
import { jellyfishMotion } from '../src/features/spectrum/three/classic/immersive/jellyfish-motion'
import { compositionAudio } from '../src/features/spectrum/three/compositions/audio'
import { defaultMusicSettings } from '../src/features/spectrum/music-engine/catalog'

test('returning to a scene ages cached attacks across the time spent in another effect', () => {
  const motion = new SceneMotion()
  const audio = { rms: .12, bands: Array(6).fill(.4), spectrum: Array(48).fill(.4), skin: [] }
  motion.step(audio, 1 / 60, defaultMusicSettings, false)
  const frame = motion.frame!
  const step = (onset: boolean) => motion.step(audio, 1 / 60, defaultMusicSettings, false, {
    ...frame, beatIndex: 0, beatAge: onset ? 0 : 5000, beatStrength: .8,
    transients: onset ? [.8,0,0] : [0,0,0], bandOnsets: [true,false,false],
  })
  const sample = () => ({ reactive: reactiveMotion(motion, 'rhythm_rain', false), jelly: jellyfishMotion(motion, false), composition: compositionAudio(motion, false) })
  step(true)
  const first = sample()
  expect(first.reactive.waves).toHaveLength(1)
  expect(first.jelly.events).toHaveLength(1)
  expect(first.composition.waves[1]).toBeGreaterThan(0)
  // Motion keeps following the shared capture while these layers are unmounted.
  for (let i = 0; i < 12; i++) step(false)
  const recent = sample()
  expect(recent.reactive.waves[0].age).toBeCloseTo(.2)
  expect(recent.jelly.events[0].age).toBeCloseTo(.2 + 1 / 60)
  expect(recent.composition.waves[0]).toBeCloseTo(.2)
  for (let i = 0; i < 240; i++) step(false)
  const returned = sample()
  expect(returned.reactive.waves).toHaveLength(0)
  expect(returned.jelly.events).toHaveLength(0)
  expect([1,3,5,7].map(i => returned.composition.waves[i])).toEqual([0,0,0,0])
  const unchanged = JSON.stringify(returned)
  sample()
  expect(JSON.stringify(returned)).toBe(unchanged)
})

test('a replacement stream clears old attacks even when its sample clock moves forward', () => {
  const motion = new SceneMotion()
  const audio = { rms: .12, bands: Array(6).fill(.4), spectrum: Array(48).fill(.4), skin: [] }
  motion.step(audio, 1 / 60, defaultMusicSettings, false)
  const frame = motion.frame!
  const step = (now: number, beatAge: number) => {
    motion.step(audio, 1 / 60, defaultMusicSettings, false, {
      ...frame, now, beatIndex: 0, beatStrength: .8, beatAge,
      transients: beatAge === 0 ? [.8,0,0] : [0,0,0], bandOnsets: [true,false,false],
    })
    return { reactive: reactiveMotion(motion, 'rhythm_rain', false), jelly: jellyfishMotion(motion, false), composition: compositionAudio(motion, false) }
  }
  const previous = step(1000, 0)
  expect(previous.reactive.waves).toHaveLength(1)
  expect(previous.jelly.events).toHaveLength(1)
  expect(previous.composition.waves[1]).toBeGreaterThan(0)
  const drift = [...previous.reactive.drift], travel = [...previous.jelly.travel], phase = motion.phase

  // A source can change without an intervening silent render, and its clock
  // need not restart at zero. Old events must not become this stream's beats.
  motion.reset(true)
  const replaced = step(100000, 1000)
  expect(replaced.reactive.waves).toHaveLength(0)
  expect(replaced.jelly.events).toHaveLength(0)
  expect([1,3,5,7].map(i => replaced.composition.waves[i])).toEqual([0,0,0,0])
  replaced.reactive.drift.forEach((v,i) => expect(v).toBeGreaterThanOrEqual(drift[i]))
  replaced.jelly.travel.forEach((v,i) => expect(v).toBeGreaterThanOrEqual(travel[i]))
  expect(motion.phase).toBeGreaterThanOrEqual(phase)

  // Another immediate switch reuses beat index zero for a fresh first attack.
  motion.reset(true)
  const fresh = step(200000, 0)
  expect(fresh.reactive.waves).toHaveLength(1)
  expect(fresh.reactive.waves[0].age).toBe(0)
  expect(fresh.jelly.events).toHaveLength(1)
  expect(fresh.composition.waves[1]).toBeGreaterThan(0)
  expect([3,5,7].map(i => fresh.composition.waves[i])).toEqual([0,0,0])
})
