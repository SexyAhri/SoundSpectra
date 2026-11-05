export interface MusicAnalysis {
  rms: number
  bands: number[]
  spectrum: number[]
  skin: number[]
}
export const silentAnalysis = (): MusicAnalysis => ({ rms: 0, bands: Array(6).fill(0), spectrum: Array(48).fill(0), skin: Array(256).fill(0) })

// Synthetic input belongs exclusively to the explicitly labelled demo preview.
export function demoAnalysis(seconds: number): MusicAnalysis {
  const beat = Math.exp(-(seconds * 1.8 % 1) * 9)
  const rms = .08 + beat * .22 + (Math.sin(seconds * 2.3) + 1) * .035
  return { rms,
    bands: Array.from({ length: 6 }, (_, i) => .2 + beat * .35 * Math.exp(-i / 2) + (Math.sin(seconds * 3 + i) + 1) * .08),
    spectrum: Array.from({ length: 48 }, (_, i) => .12 + .4 * Math.exp(-(((i - 15 - Math.sin(seconds) * 8) / 16) ** 2)) + beat * .2),
    skin: Array.from({ length: 256 }, (_, i) => Math.round(30 + 90 * Math.exp(-i / 90) * (1 + beat) + 35 * Math.sin(seconds * 4 + i / 15) ** 2)) }
}
