import { demoFeatures } from '../spectrum/audio-feature-timeline'
import { defaultMusicSettings, type MusicSettings } from '../spectrum/music-engine/catalog'
import type { MusicDriverFrame } from '../spectrum/music-engine/effects/musicDriver'
import type { AnalysisSnapshot } from '../spectrum/spectrum-canvas'

export interface LyricAudio {
  bass: number;
  body: number;
  treble: number;
  impact: number;
  energy: number;
}
export const quietLyricAudio: Readonly<LyricAudio> = Object.freeze({ bass: 0, body: 0, treble: 0, impact: 0, energy: 0 })
const unit = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0

/** Read the scene's existing capture timeline. This never generates a beat or a song position. */
export function lyricAudio(frame: MusicDriverFrame | null | undefined): Readonly<LyricAudio> {
  if (!frame?.audible) return quietLyricAudio
  const transient = (index: number) => unit(frame.transients[index] ?? 0)
  return {
    bass: transient(0), body: transient(1), treble: transient(2),
    impact: unit(Math.max(transient(0), transient(1) * .72, transient(2) * .32)),
    energy: unit(frame.displayIntensity ?? frame.intensity),
  }
}

export function readLyricAudio(analysis: AnalysisSnapshot | undefined, now: number,
  settings: Pick<MusicSettings, 'sensitivity' | 'response'> = defaultMusicSettings,
  enabled = true, demo = false): Readonly<LyricAudio> {
  if (!enabled) return quietLyricAudio
  const frame = demo ? demoFeatures(now, { ...defaultMusicSettings, ...settings }) : analysis?.timeline?.sample(now, settings)
  return lyricAudio(frame)
}
