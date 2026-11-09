export interface MusicAnalysis {
  /** Capture identity and sample clock; optional for old scene fixtures/imports. */
  sourceRevision?: number;
  streamId?: number;
  sequence?: number;
  samplePosition?: number;
  sampleRate?: number;
  rms: number;
  bands: number[];
  spectrum: number[];
  /** Native integrated RMS before artistic display compression. */
  bandRms?: number[];
  spectrumRms?: number[];
  skin: number[];
}
export const silentAnalysis = (): MusicAnalysis => ({
  rms: 0,
  bands: Array(6).fill(0),
  spectrum: Array(48).fill(0),
  skin: Array(256).fill(0),
});

// Synthetic input belongs exclusively to the explicitly labelled demo preview.
export function demoAnalysis(seconds: number): MusicAnalysis {
  const beat = Math.exp(-((seconds * 1.8) % 1) * 9);
  const rms = 0.08 + beat * 0.22 + (Math.sin(seconds * 2.3) + 1) * 0.035;
  return {
    rms,
    // Explicit synthetic physical bands for mapping previews; never used for live capture.
    bandRms: Array.from(
      { length: 6 },
      (_, i) =>
        rms *
        (0.68 - i * 0.075) *
        (0.72 + 0.28 * Math.sin(seconds * 2.3 + i) ** 2),
    ),
    sourceRevision: 0,
    streamId: 0,
    sequence: Math.floor((seconds * 48000) / 1024),
    samplePosition: Math.floor((seconds * 48000) / 1024) * 1024,
    sampleRate: 48000,
    bands: Array.from(
      { length: 6 },
      (_, i) =>
        0.2 +
        beat * 0.35 * Math.exp(-i / 2) +
        (Math.sin(seconds * 3 + i) + 1) * 0.08,
    ),
    spectrum: Array.from(
      { length: 48 },
      (_, i) =>
        0.12 +
        0.4 * Math.exp(-(((i - 15 - Math.sin(seconds) * 8) / 16) ** 2)) +
        beat * 0.2,
    ),
    skin: Array.from({ length: 256 }, (_, i) =>
      Math.round(
        30 +
          90 * Math.exp(-i / 90) * (1 + beat) +
          35 * Math.sin(seconds * 4 + i / 15) ** 2,
      ),
    ),
  };
}
