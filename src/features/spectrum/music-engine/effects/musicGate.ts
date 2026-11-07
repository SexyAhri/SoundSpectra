/** Absolute PCM RMS thresholds, independent of appearance sensitivity.
 * The lower closing threshold and 100ms hold preserve quiet tails and brief gaps.
 * No adaptive gain: stationary noise cannot acquire a growing visual multiplier.
 */
export const MUSIC_GATE_OPEN_RMS = 0.0015;
export const MUSIC_GATE_CLOSE_RMS = 0.0008;
export const MUSIC_GATE_HOLD_MS = 100;

export function createMusicGate() {
  let open = false;
  let belowMs = 0;
  return {
    reset() {
      open = false;
      belowMs = 0;
    },
    update(rms: number, dtMs: number) {
      const value = Number.isFinite(rms) ? Math.max(0, rms) : 0;
      if (value >= MUSIC_GATE_OPEN_RMS) {
        open = true;
        belowMs = 0;
      } else if (value < MUSIC_GATE_CLOSE_RMS) {
        belowMs += Math.max(0, Number.isFinite(dtMs) ? dtMs : 0);
        if (belowMs >= MUSIC_GATE_HOLD_MS) open = false;
      } else belowMs = 0;
      return open;
    },
  };
}
