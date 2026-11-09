import { expect, test } from '@playwright/test'
import { defaultRailAudio, railAudioConfig } from '../src/features/rail/audio-config'
import { RailAudioMotion, railAudioTravel } from '../src/features/rail/audio-motion'
import { RailAudioSource, type RailMusicFrame } from '../src/features/rail/audio-source'
import { RailItemPhysics } from '../src/features/rail/physics'
import { getRailSkinTheme } from '../src/features/rail/skin-theme'
import { changeRail, railDefaults } from '../src/features/rail/model'

const config = { enabled: true, profile: 'bounce' as const, amount: 100 }
const frame = (patch: Partial<RailMusicFrame> = {}): RailMusicFrame => ({ generation: 1, beatIndex: 0, beatAge: 0, beatStrength: .8, bass: .8, level: .6, time: 0, ...patch })
const packet = (sequence: number, rms = .15, sourceRevision = 1) => ({
  sourceRevision, streamId: 1, sequence, samplePosition: 4096 + sequence * 1024, sampleRate: 48000,
  rms, bands: Array(6).fill(.45), spectrum: Array(48).fill(.5), skin: [],
})

test('legacy groups default to off and music updates preserve content and other groups', () => {
  expect(railAudioConfig()).toEqual(defaultRailAudio)
  const before = changeRail(changeRail(railDefaults, { type: 'addNote', groupId: 'apps', text: '保留文字' }), { type: 'addGroup' })
  const next = changeRail(before, { type: 'group', id: 'apps', audioSync: config })
  expect(next.groups[0]).toEqual({ ...before.groups[0], audioSync: config })
  expect(next.groups[1]).toEqual(before.groups[1])
  expect(before.groups[0].audioSync).toBeUndefined()
  for (const patch of [{ amount: -1 }, { amount: 101 }, { amount: NaN }, { profile: 'bad' }, { enabled: 'true' }]) {
    expect(() => changeRail(before, { type: 'group', id: 'apps', audioSync: { ...config, ...patch } as any })).toThrow('音乐联动设置无效')
  }
})

test('each captured beat triggers once, suppressed or stale beats never replay', () => {
  const motion = new RailAudioMotion()
  expect(motion.update(1 / 60, frame(), config, false)).toBe(0)
  expect(motion.update(1 / 60, frame({ beatIndex: 1 }), config, false)).toBe(.8)
  for (let i = 0; i < 30; i++) expect(motion.update(1 / 60, frame({ beatIndex: 1 }), config, false)).toBe(0)
  expect(motion.update(1 / 60, frame({ beatIndex: 2 }), config, true)).toBe(0)
  expect(motion.update(1 / 60, frame({ beatIndex: 2 }), config, false)).toBe(0)
  expect(motion.update(1 / 60, frame({ beatIndex: 3, beatAge: 200 }), config, false)).toBe(0)
  expect(motion.update(1 / 60, frame({ generation: 2, beatIndex: 20 }), config, false)).toBe(0)
  expect(motion.update(1 / 60, frame({ generation: 2, beatIndex: 21 }), config, false)).toBe(.8)
})

test('all profiles keep fixed endpoints, bounded motion and decay after silence or interaction', () => {
  for (const profile of ['gentle', 'bounce', 'string'] as const) {
    const motion = new RailAudioMotion(), settings = { ...config, profile }
    for (let i = 0; i < 600; i++) {
      motion.update(1 / 60, frame({ beatIndex: Math.floor(i / 6) }), settings, false)
      expect(motion.offset(0, settings, 1.35)).toBe(0)
      expect(motion.offset(1, settings, 1.35)).toBe(0)
      for (let t = .01; t < 1; t += .07) expect(Math.abs(motion.offset(t, settings, 1.35))).toBeLessThanOrEqual(railAudioTravel * 1.35)
    }
    if (profile === 'gentle') expect(motion.pulse).toBe(0)
    for (let i = 0; i < 180; i++) motion.update(1 / 60, null, settings, false)
    expect(motion.level + motion.bass + motion.pulse).toBeLessThan(.00001)
    for (let i = 0; i < 60; i++) motion.update(1 / 60, frame({ beatIndex: 101 }), settings, false)
    for (let i = 0; i < 60; i++) motion.update(1 / 60, frame({ beatIndex: 102 }), settings, true)
    expect(Math.abs(motion.offset(.5, settings, 1))).toBeLessThan(.00001)
    const before = [motion.level, motion.bass, motion.pulse, motion.time]
    for (const dt of [NaN, Infinity, -1, 0]) motion.update(dt, frame(), settings, false)
    expect([motion.level, motion.bass, motion.pulse, motion.time]).toEqual(before)
  }
})

test('capture-clock beats agree at 30, 60 and 144 Hz without duplicate impulses', () => {
  const run = (fps: number) => {
    const source = new RailAudioSource(), motion = new RailAudioMotion(), beats: number[] = []
    let next = 0
    for (let render = 0; render < fps * 4; render++) {
      const now = render / fps * 1000
      while (next * 1024 / 48 <= now) {
        source.push(packet(next, next % 23 < 3 ? .32 : .035), next * 1024 / 48)
        next++
      }
      const audio = source.sample(now)
      if (motion.update(1 / fps, audio, config, false)) beats.push(audio!.beatIndex)
    }
    return { beats, level: motion.level }
  }
  const baseline = run(60)
  expect(baseline.beats.length).toBeGreaterThan(3)
  expect(new Set(baseline.beats).size).toBe(baseline.beats.length)
  for (const fps of [30, 144]) {
    const result = run(fps)
    expect(result.beats).toEqual(baseline.beats)
    expect(Math.abs(result.level - baseline.level)).toBeLessThan(.04)
  }
})

test('silence settles in real time after slow or irregular render frames', () => {
  const motion = new RailAudioMotion()
  for (let i = 0; i < 60; i++) motion.update(1 / 60, frame({ beatIndex: i }), config, false)
  for (const elapsed of [.4, .6, 1, 1]) motion.update(elapsed, null, config, false)
  expect(motion.level + motion.bass + motion.pulse).toBeLessThan(.00001)
})

test('audio source rejects bad, duplicate and old packets; stale capture returns silence', () => {
  const source = new RailAudioSource()
  expect(source.sample(0)).toBeNull()
  expect(source.push({ ...packet(0), rms: NaN }, 0)).toBe(false)
  expect(source.push({ ...packet(0), bands: [Infinity] }, 0)).toBe(false)
  expect(source.push(packet(0), 0)).toBe(true)
  expect(source.push(packet(0), 1)).toBe(false)
  for (let i = 1; i < 10; i++) source.push(packet(i), i * 1024 / 48)
  const first = source.sample(200)!
  expect(first).not.toBeNull()
  expect(source.sample(600)).toBeNull()
  expect(source.push(packet(0, .15, 2), 610)).toBe(true)
  expect(source.push(packet(100, .3, 1), 620)).toBe(false)
  expect(source.sample(620)!.generation).toBeGreaterThan(first.generation)
  source.clear()
  expect(source.sample(620)).toBeNull()
  source.push(packet(0), 630)
  expect(source.sample(630)!.generation).not.toBe(first.generation)
})

test('music impulses stay bounded and springs brake during interaction', () => {
  const physics = getRailSkinTheme('floral').physics, spring = new RailItemPhysics('music')
  for (let i = 0; i < 1000; i++) {
    spring.kick(100)
    spring.update(1 / 60, false, physics, 1)
    expect(Math.abs(spring.angle)).toBeLessThanOrEqual(physics.maxAngle)
  }
  for (let i = 0; i < 120; i++) spring.update(1 / 60, true, physics, 1)
  expect(spring.angle).toBe(0)
  expect(spring.angularVelocity).toBe(0)
})
