import type { MusicAnalysis } from "../music-analysis";
import type { MusicSettings } from "../music-engine/catalog";
import {
  createMusicDriver,
  type MusicDriverFrame,
} from "../music-engine/effects/musicDriver";
import { createMusicEnvelope } from "../music-engine/effects/musicEnvelope";

export interface FieldRipple {
  x: number;
  z: number;
  /** Spatial propagation time pauses with reduced motion; lifetime always expires. */
  age: number;
  lifetime: number;
  strength: number;
  source: "music" | "pointer";
}
export const FIELD_SIZE = 64;
export const MAX_RIPPLES = 12;
const unit = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const halton = (index: number, base: number) => {
  let value = 0,
    factor = 1 / base;
  for (let n = index; n > 0; n = Math.floor(n / base)) {
    value += (n % base) * factor;
    factor /= base;
  }
  return value;
};

/** Existing music-engine audio drives energy and transport; a clock never creates a beat. */
export class SceneMotion {
  private readonly driver = createMusicDriver();
  private readonly envelope = createMusicEnvelope();
  readonly ripples: FieldRipple[] = [];
  /** Relative captured band shape, preserved separately from per-band adaptive gain. */
  readonly spectralShape = new Float32Array(48);
  /** Slow land mass, separate from the local spectral crests and travelling waves. */
  readonly terrainMass = new Float32Array(2);
  frame: MusicDriverFrame | null = null;
  presence = 0;
  /** Display release can remain visible after the source has stopped transporting. */
  transporting = false;
  musicDropCount = 0;
  volume = 0;
  bass = 0;
  middle = 0;
  treble = 0;
  /** Fixed perceptual display scale; capture RMS and onset detection stay unchanged. */
  energy = 0;
  readonly musicalBands = new Float32Array(3);
  readonly accents = new Float32Array(3);
  onsetStrength = 0;
  phase = 0;
  /** Aurora transport is perceptually scaled; amplitude still comes from the captured audio. */
  auroraPhase = 0;
  private auroraSpeed = 0;
  private elapsed = 0;
  private sequence = 0;
  private rain = 0;
  private cooldown = 0;
  private sharedBeat = -1;
  /** Accepted simulation steps, independent of audio timestamps and GPU passes. */
  stepIndex = 0;
  stepSeconds = 0;
  private transportSpeed = 0;
  private readonly flows = new Map<string, { phase: number; speed: number; step: number }>();

  /** Layer recreation and effect changes reuse their last path instead of replaying it. */
  flowPhase(key: string, speed: number, sustainFlow: number, reduced: boolean) {
    let state = this.flows.get(key);
    if (!state) { state = { phase: 0, speed: 0, step: -1 }; this.flows.set(key, state); }
    if (state.step !== this.stepIndex) {
      state.step = this.stepIndex;
      if (!reduced && this.transporting && this.frame) {
        const target = (.04 + this.energy * (1.25 + this.frame.sustain * sustainFlow)) * speed;
        const tau = .16, decay = Math.exp(-this.stepSeconds / tau);
        state.phase += target * this.stepSeconds + (state.speed - target) * tau * (1 - decay);
        state.speed = target + (state.speed - target) * decay;
      } else state.speed = 0;
    }
    return state.phase;
  }

  reset(preservePath = false) {
    this.driver.reset();
    this.envelope.reset();
    this.ripples.length = 0;
    this.spectralShape.fill(0);
    this.terrainMass.fill(0);
    this.frame = null;
    this.presence = 0;
    this.transporting = false;
    this.elapsed = 0;
    this.sequence = 0;
    this.rain = 0;
    this.cooldown = 0;
    this.musicDropCount = 0;
    this.volume = 0;
    this.bass = 0;
    this.middle = 0;
    this.treble = 0;
    this.energy = this.onsetStrength = 0;
    this.musicalBands.fill(0); this.accents.fill(0);
    if (!preservePath) {
      this.phase = 0;
      this.auroraPhase = 0;
      this.flows.clear();
    } else for (const state of this.flows.values()) state.speed = 0;
    this.transportSpeed = 0;
    this.auroraSpeed = 0;
    this.sharedBeat = -1;
  }

  touch(x: number, z: number, extent = FIELD_SIZE / 2) {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      !Number.isFinite(extent) ||
      extent <= 0 ||
      extent > 256 ||
      Math.abs(x) > extent ||
      Math.abs(z) > extent
    )
      return;
    this.add({ x, z, age: 0, lifetime: 0, strength: 1.6, source: "pointer" });
  }

  private add(ripple: FieldRipple) {
    if (this.ripples.length === MAX_RIPPLES) this.ripples.shift();
    this.ripples.push(ripple);
  }

  step(
    audio: MusicAnalysis,
    dt: number,
    settings: MusicSettings,
    reduced: boolean,
    sharedFrame?: MusicDriverFrame | null,
  ) {
    const elapsed = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
    this.stepIndex++;
    this.stepSeconds = elapsed;
    this.elapsed += elapsed * 1000;
    const frame = sharedFrame
      ? {
          ...sharedFrame,
          dt: elapsed * 1000,
          onset:
            sharedFrame.beatIndex > this.sharedBeat &&
            sharedFrame.beatAge <= Math.max(65, elapsed * 1000),
        }
      : this.driver.updateAudio(
          audio,
          this.elapsed,
          settings.sensitivity,
          undefined,
          true,
          settings.response,
        );
    if (sharedFrame) this.sharedBeat = sharedFrame.beatIndex;
    const audible = frame.audible;
    this.transporting = audible && unit(audio.rms) > 0;
    const shape = audio.spectrumRms ?? audio.spectrum;
    let peak = 0.000001;
    for (const value of shape)
      if (Number.isFinite(value)) peak = Math.max(peak, value);
    for (let i = 0; i < this.spectralShape.length; i++) {
      const target = audible ? unit(shape[i] / peak) : 0;
      this.spectralShape[i] +=
        (target - this.spectralShape[i]) *
        (1 - Math.exp(-elapsed * (target > this.spectralShape[i] ? 20 : 8)));
    }
    this.frame = frame;
    this.volume = Math.sqrt(unit(frame.displayIntensity ?? frame.intensity));
    this.bass = unit((frame.levels[0] + frame.levels[1]) / 2) * this.volume;
    this.middle = unit((frame.levels[2] + frame.levels[3]) / 2) * this.volume;
    this.treble = unit((frame.levels[4] + frame.levels[5]) / 2) * this.volume;
    // Bands already carry the captured absolute energy. Multiplying every
    // response by the small raw RMS again made local musical gestures vanish.
    this.energy = Math.sqrt(unit((frame.displayIntensity ?? frame.intensity) / .25));
    const weight = Math.sqrt(unit(frame.intensitySample.current / .18));
    const participation = Math.sqrt(settings.sensitivity);
    for (let i = 0; i < 3; i++) {
      this.musicalBands[i] = unit((frame.levels[i*2] + frame.levels[i*2+1]) / 2) * weight;
      const target = !reduced && audible ? unit((frame.transients[i] ?? 0) * weight * participation) : 0;
      const tau = target > this.accents[i] ? .018 : .10;
      this.accents[i] += (target - this.accents[i]) * (1 - Math.exp(-elapsed / tau));
      if (reduced) this.accents[i] = 0;
    }
    this.onsetStrength = !reduced && audible ? unit(frame.beatStrength * weight * participation) : 0;
    [this.volume, this.bass].forEach((target, i) => {
      const value = this.terrainMass[i], tau = target > value ? .22 : .65;
      this.terrainMass[i] += (target - value) * (1 - Math.exp(-elapsed / tau));
    });
    if (!reduced && this.transporting) {
      const target = this.energy * (.8 + settings.speed * .5);
      const tau = .24, decay = Math.exp(-elapsed / tau);
      this.phase += target * elapsed + (this.transportSpeed - target) * tau * (1 - decay);
      this.transportSpeed = target + (this.transportSpeed - target) * decay;
    } else this.transportSpeed = 0;
    if (!reduced && this.transporting) {
      // Keep the light curtains visibly travelling during sustained music, including
      // quiet passages. This floor is audio-gated transport, never a synthesized beat.
      const target =
        (0.35 + Math.sqrt(unit(frame.intensity)) * 0.9 + this.middle * 0.2) *
        (0.45 + settings.speed * 0.2);
      const tau = 0.32,
        decay = Math.exp(-elapsed / tau);
      // Integrate the exponential response analytically so travel matches at 30/120 Hz.
      this.auroraPhase +=
        target * elapsed + (this.auroraSpeed - target) * tau * (1 - decay);
      this.auroraSpeed = target + (this.auroraSpeed - target) * decay;
    } else this.auroraSpeed = 0;
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].lifetime += elapsed;
      if (!reduced) this.ripples[i].age += elapsed;
      if (this.ripples[i].lifetime >= 6.5) this.ripples.splice(i, 1);
    }
    this.cooldown = Math.max(0, this.cooldown - elapsed);
    if (!reduced && this.transporting) {
      // A sustained note can shed small drops. Their rate is integrated current volume,
      // not a periodic clock or an extrapolated beat; silence clears the accumulator.
      this.rain +=
        elapsed * unit(frame.intensity * 5) * settings.fieldDrops * 0.9;
      if (this.cooldown === 0 && (frame.onset || this.rain >= 1)) {
        const peak = frame.spectrum.indexOf(Math.max(...frame.spectrum));
        const index = ++this.sequence;
        const x =
          settings.fieldRippleMode === "center"
            ? 0
            : (halton(index, 2) - 0.5) * 40 + (peak / 47 - 0.5) * 5;
        const z =
          settings.fieldRippleMode === "center"
            ? -2
            : (halton(index, 3) - 0.5) * 36 - 3;
        this.add({
          x,
          z,
          age: 0,
          lifetime: 0,
          strength:
            0.45 +
            unit(frame.intensity * 5) * 0.8 +
            (frame.onset ? unit(frame.beatStrength) * 0.7 : 0),
          source: "music",
        });
        this.musicDropCount++;
        this.cooldown = 0.12;
        this.rain = 0;
      }
    } else this.rain = 0;
    const visible = this.envelope.step(
      unit(audio.rms),
      audible,
      elapsed,
      settings.response,
    );
    const touch = this.ripples.reduce(
      (value, ripple) =>
        ripple.source === "pointer"
          ? Math.max(value, Math.exp(-ripple.lifetime * 0.7))
          : value,
      0,
    );
    // Binary presence alone made quiet music render the same bright background
    // as a loud passage. Reuse this envelope's absolute RMS channel (no new
    // smoothing stage), retaining a restrained floor for audible quiet detail.
    // Causal attacks may use current absolute RMS immediately; sustained shape
    // keeps the existing envelope. The pulse cannot increase energy past PCM RMS.
    const fastEnergy = unit(audio.rms) * unit(frame.pulse * 4);
    const energyVisibility = .2 + .8 * Math.sqrt(unit(Math.max(visible.intensity, fastEnergy) / .12));
    this.presence = Math.max(visible.presence * energyVisibility, touch);
    return frame;
  }

  /** CPU reference for the GPU height pass; also used to verify its numeric output. */
  sample(x: number, z: number, seed: number, settings: MusicSettings) {
    const frame = this.frame;
    const { volume, middle, treble, phase } = this;
    const position = Math.max(0, Math.min(47,
      ((x + FIELD_SIZE / 2) / FIELD_SIZE) * 39 + Math.sin(z * .09 - phase * .3) * 4 + 3));
    const bin = Math.min(46, Math.floor(position)),
      f = position - bin;
    const spectrum = frame
      ? unit(frame.spectrum[bin] * (1 - f) + frame.spectrum[bin + 1] * f) *
        volume
      : 0;
    const footprint = Math.exp(
      -(
        ((x + 2 - Math.sin(phase * 0.1) * .8) / 23) ** 2 +
        ((z + 5) / 17) ** 2
      ) * 1.4,
    );
    const ridges = 0.5 + 0.5 * Math.sin(x * 0.23 + z * 0.17 - phase);
    const crossing = 0.5 + 0.5 * Math.sin(z * 0.3 - x * 0.12 - phase * 0.65);
    const relief = .55 + ridges ** 2 * .55 + crossing ** 3 * .2 + (seed - .5) * .1;
    // The footprint distributes the captured spectrum across an uneven terrain;
    // volume controls its scale, while bass and individual bins lift separate columns.
    const shoulders = Math.exp(-((x / 27) ** 2 + ((z + 1) / 25) ** 2));
    let height =
      footprint * (this.terrainMass[0] * 2.5 + spectrum * 5.2 + this.terrainMass[1] * 3.8) * relief * 1.25 +
      shoulders * (middle * 3.8 + treble * 4) * seed ** 7;
    let crest = 0;
    const speed = (2.9 + settings.speed * 0.35) * settings.fieldSpread;
    for (const ripple of this.ripples) {
      const distance = Math.hypot(x - ripple.x, z - ripple.z);
      const front = distance - ripple.age * speed;
      const width = 1.1 + ripple.age * 0.22;
      if (Math.abs(front) > width * 4) continue;
      const attack = ripple.source === 'music' ? (1 - Math.exp(-ripple.lifetime * 10)) ** 2 : 1;
      const falloff = Math.exp(-ripple.lifetime * 0.36) * ripple.strength * attack;
      // A damped wave train gives a main crest and smaller following rings.
      const wave =
        Math.cos(front * 1.45) *
        Math.exp((-front * front) / (width * width * 4)) *
        falloff;
      height += wave * (ripple.source === "pointer" ? 0.8 : 0.55);
      crest += Math.max(0, wave);
    }
    height = Math.max(0, height) * settings.fieldHeight;
    // Leave headroom for individual peaks instead of flattening a whole ridge
    // against the ceiling. Warmth follows height, so low cells remain cool.
    height = 16 * Math.tanh(height / 16);
    const heat = unit(
      ((height / 10) * 0.8 + footprint * volume * 0.32 + spectrum * 0.15) *
        (0.36 + footprint * 0.64),
    );
    return {
      height,
      heat,
      crest: Math.min(1, crest * 0.65),
      spectrum,
      spike: seed > 0.991 ? spectrum * (0.5 + seed) * settings.fieldHeight : 0,
    };
  }
}
