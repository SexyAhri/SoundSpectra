import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createMusicGate } from '../src/features/spectrum/music-engine/effects/musicGate'
import { createMusicDriver } from '../src/features/spectrum/music-engine/effects/musicDriver'
import { AudioFeatureTimeline } from '../src/features/spectrum/audio-feature-timeline'
import { defaultMusicSettings } from '../src/features/spectrum/music-engine/catalog'
import type { MusicAnalysis } from '../src/features/spectrum/music-analysis'
import { SceneMotion } from '../src/features/spectrum/three/motion'

type NativeAudio = MusicAnalysis & { bandRms: number[]; spectrumRms: number[] }
type NativeCase = { name: string; frames: { audio: NativeAudio; bars: number[] }[] }
let cases: NativeCase[]
test.beforeAll(() => {
  test.setTimeout(180_000)
  execFileSync(process.execPath, ['scripts/probe-music-analysis.mjs'], { windowsHide: true, timeout: 180_000 })
  cases = JSON.parse(readFileSync('artifacts/music-analysis/native.json', 'utf8')).cases
})
const fixture = (name: string) => cases.find(item => item.name === name)!
const last = (name: string) => fixture(name).frames.at(-1)!.audio
const power = (values: number[]) => values.reduce((sum, value) => sum + value ** 2, 0)

test('native equal-RMS tones have comparable integrated energy independent of band width', () => {
  const tones = ['bass', 'mid', 'high'].map(name => last(`${name}-0.14142136`))
  tones.forEach((audio, index) => {
    expect(audio.rms).toBeCloseTo(Math.SQRT1_2 * .2, 5)
    expect(Math.max(...audio.bandRms)).toBeCloseTo(audio.rms, 4)
    expect(audio.bandRms.indexOf(Math.max(...audio.bandRms))).toBe([0, 3, 5][index])
    expect(power(audio.spectrumRms)).toBeCloseTo(audio.rms ** 2, 4)
  })
  expect(Math.max(...tones.map(audio => Math.max(...audio.bands))) - Math.min(...tones.map(audio => Math.max(...audio.bands)))).toBeLessThan(.002)
  const mix = last('two-tones')
  expect(mix.rms).toBeCloseTo(.14142136, 4)
  expect(mix.bandRms[0]).toBeCloseTo(.1, 4)
  expect(mix.bandRms[5]).toBeCloseTo(.1, 4)
})

test('native wideband power follows bandwidth; stereo phase and single-sided inputs preserve features', () => {
  const noise = fixture('white-noise').frames.slice(5)
  const coverage = noise.reduce((sum, { audio }) => sum + power(audio.spectrumRms) / audio.rms ** 2, 0) / noise.length
  expect(coverage).toBeGreaterThan(.69)
  expect(coverage).toBeLessThan(.81) // 48 detailed ranges cover 0–18kHz at 48kHz.
  for (const name of ['anti-phase', 'left-only']) {
    const expected = last('stereo'), actual = last(name)
    expect(actual.rms).toBeCloseTo(expected.rms, 6)
    actual.bandRms.forEach((value, i) => expect(value).toBeCloseTo(expected.bandRms[i], 6))
  }
  for (const { audio, bars } of fixture('silence').frames) {
    expect([...audio.bands, ...audio.spectrum, ...audio.bandRms, ...audio.spectrumRms, ...bars].every(value => value === 0)).toBe(true)
  }
})

test('hysteresis preserves quiet tails and closes after a bounded gap without adaptive amplification', () => {
  const gate = createMusicGate()
  expect(gate.update(.001, 20)).toBe(false)
  expect(gate.update(.004, 20)).toBe(true)
  for (let i = 0; i < 8; i++) expect(gate.update(i % 2 ? .0013 : .0016, 20)).toBe(true)
  expect(gate.update(0, 60)).toBe(true)
  expect(gate.update(0, 40)).toBe(false)
  for (let i = 0; i < 500; i++) expect(gate.update(.0007, 20)).toBe(false)
  gate.reset(); expect(gate.update(.001, 20)).toBe(false)
})

test('Rust quiet features reach the actual driver, while silence and floor noise cannot create onsets', () => {
  for (const rms of [.002, .004, .0059, .0061]) {
    const driver = createMusicDriver()
    let frame = null
    for (const { audio } of fixture(`mid-${rms}`).frames) {
      expect(Math.max(...audio.bands)).toBeGreaterThan(0)
      frame = driver.updateAudio(audio, audio.samplePosition! / 48, 1, undefined, true)
    }
    expect(frame!.audible).toBe(true)
    expect(frame!.displayPresence!).toBeGreaterThan(.99)
    expect(frame!.intensitySample.current).toBeCloseTo(rms, 5)
    // Existing smooth-motion sensitivity=1 maps RMS with gain/2; raw RMS is unchanged.
    expect(frame!.displayIntensity!).toBeGreaterThan(rms * .45)
  }
  for (const name of ['silence', 'noise-floor', 'mid-0.0001']) {
    const driver = createMusicDriver()
    for (const { audio } of fixture(name).frames) {
      const frame = driver.updateAudio(audio, audio.samplePosition! / 48, 2, undefined, true)
      expect(frame.audible).toBe(false); expect(frame.onset).toBe(false)
      expect(frame.displayIntensity).toBe(0); expect(frame.displayPresence).toBe(0)
    }
  }
  const gaps = createMusicDriver()
  let tail = null
  for (const { audio } of fixture('weak-gaps').frames) {
    const time = audio.samplePosition! / 48
    tail = gaps.updateAudio(audio, time, 1, undefined, true)
    if (time > 1050 && time < 1100) expect(tail.audible).toBe(true)
    if (time > 1950) { expect(tail.audible).toBe(false); expect(tail.onset).toBe(false) }
  }
  expect(tail!.intensitySample.current).toBe(0)
})

test('absolute strength and spectral differences survive constant input and long normalization history', () => {
  const run = (rms: number, bands: number[]) => {
    const driver = createMusicDriver()
    let frame = driver.updateAudio({ rms, bands, spectrum: Array(48).fill(bands[0]) }, 0, 1, undefined, true)
    for (let i = 1; i <= 300; i++) frame = driver.updateAudio({ rms, bands, spectrum: Array(48).fill(bands[0]) }, i * 21.333, 1, undefined, true)
    return frame
  }
  const frame = run(.1, [.2, .4, .8, .2, .4, .8])
  expect(frame.levels[2]).toBeGreaterThan(frame.levels[0] * 3)
  const quiet = run(.004, last('mid-0.004').bands), loud = run(.14142136, last('mid-0.14142136').bands)
  expect(loud.levels[3]).toBeGreaterThan(quiet.levels[3] * 3)
  expect(loud.displayIntensity!).toBeGreaterThan(quiet.displayIntensity! * 30)
})

test('scene visibility expresses weak versus strong PCM without erasing quiet detail or creating silent motion', () => {
  const run = (name: string) => {
    const motion = new SceneMotion()
    for (const { audio } of fixture(name).frames) motion.step(audio, 1024 / 48000, defaultMusicSettings, false)
    return motion
  }
  const quiet = run('mid-0.004'), loud = run('mid-0.14142136')
  expect(quiet.presence).toBeGreaterThan(.2)
  expect(quiet.presence).toBeLessThan(loud.presence * .5)
  expect(loud.volume).toBeGreaterThan(quiet.volume * 5)
  for (const name of ['bass-0.14142136', 'high-0.14142136']) {
    const other = run(name)
    expect(other.presence).toBeCloseTo(loud.presence, 3)
    expect(other.volume).toBeCloseTo(loud.volume, 3)
  }
  const silence = last('silence')
  for (let i = 0; i < 150; i++) {
    loud.step(silence, 1024 / 48000, defaultMusicSettings, false)
    expect(loud.frame!.onset).toBe(false)
  }
  expect(loud.presence).toBe(0)
  expect(loud.volume).toBe(0)
})

test('native attacks remain distinct at 30/60/120 FPS and source interruptions expire', () => {
  const run = (fps: number) => {
    const timeline = new AudioFeatureTimeline(), frames = fixture('mid-attacks').frames
    let next = 0, beat = -1
    const indices: number[] = []
    for (let now = 0; now < 2600; now += 1000 / fps) {
      while (next < frames.length && frames[next].audio.samplePosition! / 48 <= now) {
        const audio = frames[next++].audio; timeline.push(audio, audio.samplePosition! / 48)
      }
      const frame = timeline.sample(now, defaultMusicSettings)
      if (frame && frame.beatIndex > beat) { indices.push(frame.beatIndex); beat = frame.beatIndex }
    }
    expect(timeline.sample(4000, defaultMusicSettings)).toBeNull()
    return indices
  }
  expect(run(30)).toEqual(run(120)); expect(run(60)).toEqual(run(120))
  expect(run(60)).toHaveLength(5)
})

test('regional attacks separate impact from high detail and reject note endings, vibrato and a slow crescendo', () => {
  const analyze = (name: string) => {
    const driver = createMusicDriver(), events: { time: number; frame: ReturnType<typeof driver.updateAudio> }[] = []
    for (const { audio } of fixture(name).frames) {
      const time = audio.samplePosition! / 48
      const frame = driver.updateAudio(audio, time, 1, undefined, true)
      if (frame.onset) events.push({ time, frame })
    }
    return events
  }
  for (const [group, name] of ['low-attacks', 'mid-attacks', 'high-attacks'].entries()) {
    const events = analyze(name)
    expect(events).toHaveLength(5)
    events.forEach(({ time, frame }, i) => {
      const delay = time - (400 + i * 500)
      expect(delay).toBeGreaterThanOrEqual(0); expect(delay).toBeLessThanOrEqual(1024 / 48)
      expect(frame.transients.indexOf(Math.max(...frame.transients))).toBe(group)
    })
  }
  expect(analyze('high-attacks')[0].frame.pulse).toBeLessThan(analyze('low-attacks')[0].frame.pulse * .5)
  expect(analyze('sustain-vibrato')).toHaveLength(1)
  expect(analyze('crescendo')).toHaveLength(1)
  const overlay = analyze('high-over-bass').filter(event => event.time >= 400)
  expect(overlay).toHaveLength(5)
  overlay.forEach(event => expect(event.frame.bandOnsets[2]).toBe(true))
  expect(analyze('same-band-switch')).toHaveLength(2)
})

test('timeline rejects invalid clocks without consuming sequence and keeps gate and events shared across controls', () => {
  const timeline = new AudioFeatureTimeline(), audio = last('mid-0.004')
  expect(timeline.push({ ...audio, sequence: 1, samplePosition: 4096 }, 100)).toBe(true)
  const generation = timeline.generation
  expect(timeline.push({ ...audio, sequence: 2, samplePosition: NaN }, 120)).toBe(false)
  expect(timeline.push({ ...audio, sequence: 2, samplePosition: 5120, sampleRate: 0 }, 120)).toBe(false)
  expect(timeline.push({ ...audio, sequence: 2, samplePosition: 5120 }, 120)).toBe(true)
  expect(timeline.generation).toBe(generation)
  const low = timeline.sample(130, { sensitivity: .5, response: 'soft' })!
  const high = timeline.sample(130, { sensitivity: 2, response: 'responsive' })!
  expect(low.audible).toBe(true); expect(high.audible).toBe(true)
  expect(high.beatIndex).toBe(low.beatIndex); expect(high.transients).toEqual(low.transients)
  expect(timeline.sample(500, defaultMusicSettings)).toBeNull()
  expect(timeline.push({ ...audio, sequence: 3, samplePosition: 48000 }, 1000)).toBe(true)
  expect(timeline.generation).toBeGreaterThan(generation)
  expect(timeline.sample(1000, defaultMusicSettings)!.beatIndex).toBe(0)
})
