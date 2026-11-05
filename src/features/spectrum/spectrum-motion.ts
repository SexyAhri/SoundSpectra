import { BAND_COUNT } from "./model";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Audio-driven motion shared by the preview and transparent desktop canvas. */
export class SpectrumMotion {
  readonly levels = new Float32Array(BAND_COUNT * 2);
  energy = 0;
  private readonly velocity = new Float32Array(BAND_COUNT);
  private readonly envelope = new Float32Array(BAND_COUNT);
  private readonly peakAge = new Float32Array(BAND_COUNT);
  private readonly input = new Float32Array(BAND_COUNT);

  step(source: Float32Array, elapsed: number, sensitivity: number, decay: number, reducedMotion: boolean) {
    const dt = clamp(Number.isFinite(elapsed) ? elapsed : 1 / 60, 0, 0.1);
    const gain = clamp(sensitivity, 25, 200) / 100;
    const softness = clamp(decay, 0, 100) / 100;
    let energy = 0;
    for (let i = 0; i < BAND_COUNT; i++) {
      this.input[i] = Number.isFinite(source[i]) ? clamp(source[i], 0, 1) : 0;
    }
    for (let i = 0; i < BAND_COUNT; i++) {
      const signal = this.input[i] * 0.8
        + (this.input[Math.max(0, i - 1)] + this.input[Math.min(BAND_COUNT - 1, i + 1)]) * 0.1;
      this.envelope[i] += (signal - this.envelope[i]) * (1 - Math.exp(-dt / 0.22));
      const onset = reducedMotion ? 0 : Math.max(0, signal - this.envelope[i]);
      const shaped = (Math.pow(signal, 2.05) * 1.65 + onset * 0.5) * gain;
      const target = shaped <= 0.82 ? shaped : 0.82 + 0.16 * (1 - Math.exp(-(shaped - 0.82) / 0.16));
      const offset = i * 2;
      const height = this.levels[offset];
      // Exact critically damped spring step: no frame-rate-dependent lerp or
      // unstable Euler overshoot after resize, backgrounding or a slow frame.
      const omega = reducedMotion ? 16 : target > height ? 46 + i / BAND_COUNT * 18 : 12 + (1 - softness) * 22;
      const displacement = height - target;
      const impulse = this.velocity[i] + omega * displacement;
      const attenuation = Math.exp(-omega * dt);
      let next = clamp(target + (displacement + impulse * dt) * attenuation, 0, 1);
      this.velocity[i] = (this.velocity[i] - omega * impulse * dt) * attenuation;
      if (next < 0.0001 && target === 0) { next = 0; this.velocity[i] = 0; }
      this.levels[offset] = next;
      this.peakAge[i] += dt;
      let peak = this.levels[offset + 1];
      if (next >= peak || reducedMotion) { peak = next; this.peakAge[i] = 0; }
      else if (this.peakAge[i] > 0.055) peak = Math.max(next, peak - dt * (0.35 + this.peakAge[i] * 2.8));
      this.levels[offset + 1] = next === 0 ? 0 : peak;
      energy += next * next;
    }
    this.energy = Math.sqrt(energy / BAND_COUNT);
  }
}

/** Preview-only rhythm; the live path never generates synthetic movement. */
export function demoSpectrum(target: Float32Array, seconds: number) {
  const beat = seconds * 1.8;
  const kick = Math.exp(-(beat % 1) * 9);
  const snare = Math.exp(-((beat + 0.5) % 1) * 13);
  const phrase = 0.72 + Math.sin(seconds * 0.7) * 0.16;
  for (let i = 0; i < BAND_COUNT; i++) {
    const bass = Math.exp(-Math.pow((i - 10) / 13, 2)) * (0.25 + kick * 0.65);
    const vocal = Math.exp(-Math.pow((i - 40 - Math.sin(seconds * 0.8) * 9) / 20, 2))
      * (0.24 + 0.3 * Math.pow((Math.sin(i * 0.32 + seconds * 3) + 1) * 0.5, 2));
    const treble = Math.exp(-Math.pow((i - 73) / 20, 2))
      * (snare * 0.42 + 0.13 * Math.pow((Math.sin(i * 1.3 - seconds * 8) + 1) * 0.5, 4));
    target[i] = Math.min(1, (bass + vocal + treble) * phrase);
  }
}
