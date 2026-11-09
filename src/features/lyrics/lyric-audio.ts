import { demoFeatures } from "../spectrum/audio-feature-timeline";
import {
  defaultMusicSettings,
  type MusicSettings,
} from "../spectrum/music-engine/catalog";
import type { MusicDriverFrame } from "../spectrum/music-engine/effects/musicDriver";
import type { AnalysisSnapshot } from "../spectrum/spectrum-canvas";

export interface LyricAudio {
  bass: number;
  body: number;
  treble: number;
  impact: number;
  energy: number;
  /** Captured onset metadata; absence never blocks a lyric transition. */
  onset?: boolean;
  beatAge?: number;
  beatStrength?: number;
  sustain?: number;
}
export const quietLyricAudio: Readonly<LyricAudio> = Object.freeze({
  bass: 0,
  body: 0,
  treble: 0,
  impact: 0,
  energy: 0,
});
const unit = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/** Envelope of an observed event, never an extrapolated beat or BPM clock. */
export function lyricAccent(audio: Readonly<LyricAudio> | undefined) {
  if (!audio) return 0;
  const age = audio.beatAge ?? Infinity;
  return unit(
    Math.max(
      audio.impact,
      age >= 0 ? (audio.beatStrength ?? 0) * Math.exp(-age / 140) : 0,
    ),
  );
}

/** Read the scene's existing capture timeline. This never generates a beat or a song position. */
export function lyricAudio(
  frame: MusicDriverFrame | null | undefined,
): Readonly<LyricAudio> {
  if (!frame?.audible) return quietLyricAudio;
  const transient = (index: number) => unit(frame.transients[index] ?? 0);
  return {
    bass: transient(0),
    body: transient(1),
    treble: transient(2),
    impact: unit(
      Math.max(transient(0), transient(1) * 0.72, transient(2) * 0.32),
    ),
    energy: unit(frame.displayIntensity ?? frame.intensity),
    onset: frame.onset,
    beatAge: Math.max(0, frame.beatAge),
    beatStrength: unit(frame.beatStrength),
    sustain: unit(frame.sustain),
  };
}

export function readLyricAudio(
  analysis: AnalysisSnapshot | undefined,
  now: number,
  settings: Pick<
    MusicSettings,
    "sensitivity" | "response"
  > = defaultMusicSettings,
  enabled = true,
  demo = false,
): Readonly<LyricAudio> {
  if (!enabled) return quietLyricAudio;
  const frame = demo
    ? demoFeatures(now, { ...defaultMusicSettings, ...settings })
    : analysis?.timeline?.sample(now, settings);
  return lyricAudio(frame);
}
