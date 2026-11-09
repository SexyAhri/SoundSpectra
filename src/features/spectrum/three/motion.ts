import type { MusicAnalysis } from "../music-analysis";
import type { MusicSettings } from "../music-engine/catalog";
import {
  createMusicDriver,
  type MusicDriverFrame,
} from "../music-engine/effects/musicDriver";
import { createMusicEnvelope } from "../music-engine/effects/musicEnvelope";
import { MUSIC_GATE_CLOSE_RMS } from "../music-engine/effects/musicGate";

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
  /** Local ridges settle faster than the land mass, without following packet edges. */
  readonly terrainSpectrum = new Float32Array(48);
  readonly terrainPeaks = new Float32Array(2);
  frame: MusicDriverFrame | null = null;
  presence = 0;
  /** Only current PCM above the noise floor can transport or display music. */
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
  private elapsed = 0;
  private sequence = 0;
  private rain = 0;
  private cooldown = 0;
  private sharedBeat = -1;
  /** Accepted simulation steps, independent of audio timestamps and GPU passes. */
  stepIndex = 0;
  stepSeconds = 0;
  /** Accepted simulation time, including steps when a particular layer is absent. */
  simulationTime = 0;
  /** Event caches must follow source resets even when the new clock is later. */
  resetRevision = 0;
  private readonly flows = new Map<
    string,
    { phase: number; speed: number; target: number; step: number }
  >();

  /** Layer recreation and effect changes reuse their last path instead of replaying it. */
  flowPhase(key: string, speed: number, sustainFlow: number, reduced: boolean) {
    let state = this.flows.get(key);
    if (!state) {
      state = { phase: 0, speed: 0, target: 0, step: -1 };
      this.flows.set(key, state);
    }
    if (state.step !== this.stepIndex) {
      state.step = this.stepIndex;
      if (!reduced && this.transporting && this.frame) {
        // Travel uses the short audio envelope, not the square-root display
        // brightness. No baseline speed: a quiet note must travel less than a
        // loud one, and captured attacks must change movement as well as light.
        const level = Math.min(2, Math.max(0, this.frame.intensity) * 10);
        const accentWeight = Math.sqrt(
          unit(this.frame.intensitySample.current / 0.18) *
            this.frame.sensitivity,
        );
        const attack =
          Math.max(
            0,
            this.frame.transients[0] * 1.25 +
              this.frame.transients[1] * 0.65 +
              this.frame.transients[2] * 0.25,
          ) * accentWeight;
        const target =
          (level + attack) *
          speed *
          (1 + this.frame.sustain * sustainFlow * 0.15);
        const dt = this.stepSeconds,
          tau = 0.06;
        if (dt > 0) {
          // Integrate the line between accepted audio samples analytically.
          // Holding the new endpoint for the whole frame overcounts each attack
          // at 30Hz compared with 120Hz.
          const slope = (target - state.target) / dt,
            decay = Math.exp(-dt / tau);
          const next =
            target -
            slope * tau +
            (state.speed - state.target + slope * tau) * decay;
          state.phase += Math.max(
            0,
            (state.target + target) * 0.5 * dt - tau * (next - state.speed),
          );
          state.speed = Math.max(0, next);
        }
        state.target = target;
      } else state.speed = state.target = 0;
    }
    return state.phase;
  }

  reset(preservePath = false) {
    this.resetRevision++;
    this.driver.reset();
    this.envelope.reset();
    this.ripples.length = 0;
    this.spectralShape.fill(0);
    this.terrainMass.fill(0);
    this.terrainSpectrum.fill(0);
    this.terrainPeaks.fill(0);
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
    this.musicalBands.fill(0);
    this.accents.fill(0);
    if (!preservePath) {
      this.phase = 0;
      this.auroraPhase = 0;
      this.flows.clear();
    } else
      for (const state of this.flows.values()) state.speed = state.target = 0;
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
    this.simulationTime += elapsed;
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
    // The gate's 100ms hold stabilizes detection; it must not let digital
    // silence or sub-threshold noise keep moving the last audible frame.
    this.transporting = audible && unit(audio.rms) >= MUSIC_GATE_CLOSE_RMS;
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
    this.energy = Math.sqrt(
      unit((frame.displayIntensity ?? frame.intensity) / 0.25),
    );
    const weight = Math.sqrt(unit(frame.intensitySample.current / 0.18));
    const participation = Math.sqrt(settings.sensitivity);
    for (let i = 0; i < 3; i++) {
      this.musicalBands[i] =
        unit((frame.levels[i * 2] + frame.levels[i * 2 + 1]) / 2) * weight;
      const target =
        !reduced && audible
          ? unit((frame.transients[i] ?? 0) * weight * participation)
          : 0;
      const tau = target > this.accents[i] ? 0.018 : 0.1;
      this.accents[i] +=
        (target - this.accents[i]) * (1 - Math.exp(-elapsed / tau));
      if (reduced) this.accents[i] = 0;
    }
    this.onsetStrength =
      !reduced && audible
        ? unit(frame.beatStrength * weight * participation)
        : 0;
    [this.volume, this.bass].forEach((target, i) => {
      const value = this.terrainMass[i],
        tau = target > value ? 0.22 : 0.65;
      this.terrainMass[i] += (target - value) * (1 - Math.exp(-elapsed / tau));
    });
    for (let i = 0; i < 48; i++) {
      const target = audible ? unit(frame.spectrum[i]) : 0,
        value = this.terrainSpectrum[i];
      this.terrainSpectrum[i] +=
        (target - value) *
        (1 - Math.exp(-elapsed / (target > value ? 0.085 : 0.3)));
    }
    [this.middle, this.treble].forEach((target, i) => {
      const value = this.terrainPeaks[i];
      this.terrainPeaks[i] +=
        (target - value) *
        (1 - Math.exp(-elapsed / (target > value ? 0.1 : 0.38)));
    });
    this.phase = this.flowPhase(
      "terrain-transport",
      0.8 + settings.speed * 0.5,
      0,
      reduced,
    );
    this.auroraPhase = this.flowPhase(
      "aurora-transport",
      0.45 + settings.speed * 0.2,
      0.2,
      reduced,
    );
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
    const energyVisibility =
      0.2 +
      0.8 * Math.sqrt(unit(Math.max(visible.intensity, fastEnergy) / 0.12));
    // One final transparent presentation lets every canvas sleep immediately.
    // Pointer feedback remains an explicit interaction, not background music.
    this.presence = Math.max(
      this.transporting ? visible.presence * energyVisibility : 0,
      touch,
    );
    return frame;
  }

  /** CPU reference for the GPU height pass; also used to verify its numeric output. */
  sample(x: number, z: number, seed: number, settings: MusicSettings) {
    const frame = this.frame;
    const { volume, phase } = this;
    const position = Math.max(
      0,
      Math.min(
        47,
        ((x + FIELD_SIZE / 2) / FIELD_SIZE) * 39 +
          Math.sin(z * 0.09 - phase * 0.3) * 4 +
          3,
      ),
    );
    const bin = Math.min(46, Math.floor(position)),
      f = position - bin;
    const spectrum = frame
      ? unit(
          this.terrainSpectrum[bin] * (1 - f) +
            this.terrainSpectrum[bin + 1] * f,
        ) * volume
      : 0;
    const footprint = Math.exp(
      -(
        ((x + 2 - Math.sin(phase * 0.1) * 0.8) / 23) ** 2 +
        ((z + 5) / 17) ** 2
      ) * 1.4,
    );
    const ridgeAxis = x * 0.23 + z * 0.17 - phase + Math.sin(z * 0.15) * 0.38;
    const ridges = 1 - Math.abs(Math.sin((ridgeAxis - Math.PI / 2) * 0.5));
    const crossing = 0.5 + 0.5 * Math.sin(z * 0.3 - x * 0.12 - phase * 0.65);
    const relief =
      0.14 + ridges ** 2.4 * 1.85 + crossing ** 4 * 0.2 + (seed - 0.5) * 0.008;
    // The footprint distributes the captured spectrum across an uneven terrain;
    // volume controls its scale, while individual bins lift connected ridges.
    const shoulders = Math.exp(-((x / 27) ** 2 + ((z + 1) / 25) ** 2));
    let height =
      footprint *
        (this.terrainMass[0] * 2.5 +
          spectrum * 5.2 +
          this.terrainMass[1] * 3.8) *
        relief *
        1.8 +
      shoulders *
        (this.terrainPeaks[0] * 3.8 + this.terrainPeaks[1] * 4) *
        (ridges * crossing) ** 3;
    let crest = 0;
    const speed = (2.9 + settings.speed * 0.35) * settings.fieldSpread;
    for (const ripple of this.ripples) {
      const distance = Math.hypot(x - ripple.x, z - ripple.z);
      const front = distance - ripple.age * speed;
      const width = 1.1 + ripple.age * 0.22;
      if (Math.abs(front) > width * 4) continue;
      const attack =
        ripple.source === "music"
          ? (1 - Math.exp(-ripple.lifetime * 10)) ** 2
          : 1;
      const falloff =
        Math.exp(-ripple.lifetime * 0.36) * ripple.strength * attack;
      // A damped wave train gives a main crest and smaller following rings.
      const wave =
        Math.cos(front * 1.45) *
        Math.exp((-front * front) / (width * width * 4)) *
        falloff;
      height += wave * (ripple.source === "pointer" ? 0.8 : 0.24);
      crest += Math.max(0, wave);
    }
    height =
      Math.max(footprint * volume * 0.65, height) * settings.fieldHeight * 2.2;
    // Leave headroom for individual peaks instead of flattening a whole ridge
    // against the ceiling. Warmth follows height, so low cells remain cool.
    height = 16 * Math.tanh(height / 16);
    const layerWarp = Math.sin(x * 0.15 + z * 0.19) * 0.11;
    const layer = height / 3 + layerWarp;
    const fraction = layer - Math.floor(layer);
    const transition = unit((fraction - 0.2) / 0.6);
    const terraced =
      (Math.floor(layer) + transition ** 2 * (3 - 2 * transition) - layerWarp) *
      3;
    const exposed = unit((height - 1.2) / 3.8);
    const ledge = 0.32 * exposed ** 2 * (3 - 2 * exposed);
    height = Math.max(0, height * (1 - ledge) + terraced * ledge);
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
