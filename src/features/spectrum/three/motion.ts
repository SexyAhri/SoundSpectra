import type { MusicAnalysis } from '../music-analysis'
import type { MusicSettings } from '../music-engine/catalog'
import { createMusicDriver, type MusicDriverFrame } from '../music-engine/effects/musicDriver'
import { createMusicEnvelope } from '../music-engine/effects/musicEnvelope'

export interface FieldRipple {
  x: number; z: number
  /** Spatial propagation time pauses with reduced motion; lifetime always expires. */
  age: number; lifetime: number
  strength: number; source: 'music' | 'pointer'
}
export const FIELD_SIZE = 64
export const MAX_RIPPLES = 12
const unit = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
const halton = (index: number, base: number) => {
  let value = 0, factor = 1 / base
  for (let n = index; n > 0; n = Math.floor(n / base)) { value += n % base * factor; factor /= base }
  return value
}

/** Existing music-engine audio drives energy and transport; a clock never creates a beat. */
export class SceneMotion {
  private readonly driver = createMusicDriver()
  private readonly envelope = createMusicEnvelope()
  readonly ripples: FieldRipple[] = []
  /** Relative captured band shape, preserved separately from per-band adaptive gain. */
  readonly spectralShape = new Float32Array(48)
  frame: MusicDriverFrame | null = null
  presence = 0
  musicDropCount = 0
  volume = 0
  bass = 0
  middle = 0
  treble = 0
  phase = 0
  /** Aurora transport is perceptually scaled; amplitude still comes from the captured audio. */
  auroraPhase = 0
  private auroraSpeed = 0
  private elapsed = 0
  private sequence = 0
  private rain = 0
  private cooldown = 0

  reset() {
    this.driver.reset(); this.envelope.reset(); this.ripples.length = 0
    this.spectralShape.fill(0)
    this.frame = null; this.presence = 0; this.elapsed = 0; this.sequence = 0
    this.rain = 0; this.cooldown = 0; this.musicDropCount = 0
    this.volume = 0; this.bass = 0; this.middle = 0; this.treble = 0; this.phase = 0
    this.auroraPhase = 0; this.auroraSpeed = 0
  }

  touch(x: number, z: number, extent = FIELD_SIZE / 2) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(extent) || extent <= 0 || extent > 256 || Math.abs(x) > extent || Math.abs(z) > extent) return
    this.add({ x, z, age: 0, lifetime: 0, strength: 1.6, source: 'pointer' })
  }

  private add(ripple: FieldRipple) {
    if (this.ripples.length === MAX_RIPPLES) this.ripples.shift()
    this.ripples.push(ripple)
  }

  step(audio: MusicAnalysis, dt: number, settings: MusicSettings, reduced: boolean) {
    const elapsed = Math.max(0, Math.min(.1, Number.isFinite(dt) ? dt : 0))
    this.elapsed += elapsed * 1000
    const audible = Number.isFinite(audio.rms) && audio.rms > .006
    let peak = .0001
    for (const value of audio.spectrum) if (Number.isFinite(value)) peak = Math.max(peak, value)
    for (let i = 0; i < this.spectralShape.length; i++) {
      const target = audible ? unit(audio.spectrum[i] / peak) : 0
      this.spectralShape[i] += (target - this.spectralShape[i]) * (1 - Math.exp(-elapsed * (target > this.spectralShape[i] ? 20 : 8)))
    }
    const frame = this.driver.updateAudio({ ...audio, audible }, this.elapsed, settings.sensitivity, undefined, true, settings.response)
    this.frame = frame
    this.volume = Math.sqrt(unit(frame.displayIntensity ?? frame.intensity))
    this.bass = unit((frame.levels[0] + frame.levels[1]) / 2) * this.volume
    this.middle = unit((frame.levels[2] + frame.levels[3]) / 2) * this.volume
    this.treble = unit((frame.levels[4] + frame.levels[5]) / 2) * this.volume
    if (!reduced) this.phase += elapsed * frame.intensity * (2 + settings.speed * .75)
    if (!reduced && audible) {
      // Keep the light curtains visibly travelling during sustained music, including
      // quiet passages. This floor is audio-gated transport, never a synthesized beat.
      const target = (.35 + Math.sqrt(unit(frame.intensity)) * .9 + this.middle * .2)
        * (.45 + settings.speed * .2)
      const tau = .32, decay = Math.exp(-elapsed / tau)
      // Integrate the exponential response analytically so travel matches at 30/120 Hz.
      this.auroraPhase += target * elapsed + (this.auroraSpeed - target) * tau * (1 - decay)
      this.auroraSpeed = target + (this.auroraSpeed - target) * decay
    } else this.auroraSpeed = 0
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].lifetime += elapsed
      if (!reduced) this.ripples[i].age += elapsed
      if (this.ripples[i].lifetime >= 6.5) this.ripples.splice(i, 1)
    }
    this.cooldown = Math.max(0, this.cooldown - elapsed)
    if (!reduced && audible) {
      // A sustained note can shed small drops. Their rate is integrated current volume,
      // not a periodic clock or an extrapolated beat; silence clears the accumulator.
      this.rain += elapsed * unit(frame.intensity * 5) * settings.fieldDrops * .9
      if (this.cooldown === 0 && (frame.onset || this.rain >= 1)) {
        const peak = frame.spectrum.indexOf(Math.max(...frame.spectrum))
        const index = ++this.sequence
        const x = settings.fieldRippleMode === 'center' ? 0 : (halton(index, 2) - .5) * 40 + (peak / 47 - .5) * 5
        const z = settings.fieldRippleMode === 'center' ? -2 : (halton(index, 3) - .5) * 36 - 3
        this.add({ x, z, age: 0, lifetime: 0, strength: (.45 + unit(frame.intensity * 5) * .8 + (frame.onset ? unit(frame.beatStrength) * .7 : 0)), source: 'music' })
        this.musicDropCount++; this.cooldown = .12; this.rain = 0
      }
    } else this.rain = 0
    const visible = this.envelope.step(unit(audio.rms), audible, elapsed, settings.response).presence
    const touch = this.ripples.reduce((value, ripple) => ripple.source === 'pointer' ? Math.max(value, Math.exp(-ripple.lifetime * .7)) : value, 0)
    this.presence = Math.max(visible, touch)
    return frame
  }

  /** CPU reference for the GPU height pass; also used to verify its numeric output. */
  sample(x: number, z: number, seed: number, settings: MusicSettings) {
    const frame = this.frame
    const { volume, bass, middle, treble, phase } = this
    const position = ((x + FIELD_SIZE / 2) / FIELD_SIZE * 30 + (z + FIELD_SIZE / 2) / FIELD_SIZE * 17) % 47
    const bin = Math.floor(position), f = position - bin
    const spectrum = frame ? unit(frame.spectrum[bin] * (1 - f) + frame.spectrum[bin + 1] * f) * volume : 0
    const footprint = Math.exp(-(((x + 2 - Math.sin(phase * .27) * 3) / 23) ** 2 + ((z + 5) / 17) ** 2) * 1.4)
    const ridges = .5 + .5 * Math.sin(x * .23 + z * .17 - phase)
    const crossing = .5 + .5 * Math.sin(z * .3 - x * .12 + phase * .65)
    const relief = .4 + ridges * .55 + crossing * .25 + (seed - .5) * .18
    // The footprint distributes the captured spectrum across an uneven terrain;
    // volume controls its scale, while bass and individual bins lift separate columns.
    const shoulders = Math.exp(-((x / 27) ** 2 + ((z + 1) / 25) ** 2))
    let height = footprint * (volume * 1.4 + spectrum * 8 + bass * 6) * relief * 1.1
      + shoulders * (middle * 2.5 + treble * 4) * seed ** 7
    let crest = 0
    const speed = (2.9 + settings.speed * .35) * settings.fieldSpread
    for (const ripple of this.ripples) {
      const distance = Math.hypot(x - ripple.x, z - ripple.z)
      const front = distance - ripple.age * speed
      const width = 1.1 + ripple.age * .22
      if (Math.abs(front) > width * 4) continue
      const falloff = Math.exp(-ripple.lifetime * .36) * ripple.strength
      // A damped wave train gives a main crest and smaller following rings.
      const wave = Math.cos(front * 1.45) * Math.exp(-front * front / (width * width * 4)) * falloff
      height += wave * (ripple.source === 'pointer' ? .65 : .3)
      crest += Math.max(0, wave)
    }
    height = Math.max(0, height) * settings.fieldHeight
    // Leave headroom for individual peaks instead of flattening a whole ridge
    // against the ceiling. Warmth follows height, so low cells remain cool.
    height = 16 * Math.tanh(height / 16)
    const heat = unit((height / 10 * .8 + footprint * volume * .32 + spectrum * .15) * (.36 + footprint * .64))
    return { height, heat, crest: Math.min(1, crest * .65), spectrum,
      spike: seed > .991 ? spectrum * (.5 + seed) * settings.fieldHeight : 0 }
  }
}
