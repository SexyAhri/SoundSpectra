import { AudioFeatureTimeline } from "../spectrum/audio-feature-timeline";
import type { MusicAnalysis } from "../spectrum/music-analysis";

export interface RailMusicFrame {
  generation: number;
  beatIndex: number;
  beatAge: number;
  beatStrength: number;
  bass: number;
  level: number;
  time: number;
}
const unit = (value: number) => Math.max(0, Math.min(1, value));

/** Capture-clock onset detection shared by every rail in this WebView. */
export class RailAudioSource {
  private timeline = new AudioFeatureTimeline();
  private epoch = 0;
  clear() {
    this.timeline = new AudioFeatureTimeline();
    this.epoch++;
  }
  push(audio: MusicAnalysis, now: number) {
    if (
      !audio ||
      !Number.isFinite(audio.rms) ||
      audio.rms < 0 ||
      ![audio.bands, audio.spectrum].every(
        (values) =>
          Array.isArray(values) &&
          values.length > 0 &&
          values.every((value) => Number.isFinite(value) && value >= 0),
      )
    )
      return false;
    return this.timeline.push(audio, now);
  }
  sample(now: number): RailMusicFrame | null {
    const frame = this.timeline.sample(now, {
      sensitivity: 1,
      response: "balanced",
    });
    if (!frame?.audible) return null;
    return {
      generation: this.epoch * 1_000_000 + this.timeline.generation,
      beatIndex: frame.beatIndex,
      beatAge: frame.beatAge,
      beatStrength: unit(frame.beatStrength),
      bass: unit(frame.levels[0] ?? 0),
      level: unit(frame.displayIntensity ?? frame.intensity),
      time: frame.now / 1000,
    };
  }
}
