import { MUSIC_GATE_CLOSE_RMS } from "./musicGate";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const region = (hz: number) => (hz < 300 ? 0 : hz < 1800 ? 1 : 2);

/** Positive spectral differences with a neighbouring-bin maximum reference.
 * This tolerates small pitch movements. Each frequency region has its own
 * causal threshold and re-arm state; no future frame or predicted beat is used.
 */
export function createMusicTransientDetector() {
  let previous: readonly number[] = [];
  let previousRms = 0;
  let previousPower = [0, 0, 0];
  const average = [0, 0, 0],
    pulses = [0, 0, 0],
    armed = [true, true, true];
  let sinceOnset = Infinity;
  let activeGroups = [false, false, false];
  return {
    reset() {
      previous = [];
      previousRms = 0;
      sinceOnset = Infinity;
      previousPower = [0, 0, 0];
      average.fill(0);
      pulses.fill(0);
      armed.fill(true);
      activeGroups.fill(false);
    },
    update(
      dtMs: number,
      rms: number,
      audible: boolean,
      spectrum: readonly number[],
      sensitivity: number,
      spectrumRms?: readonly number[],
    ) {
      const dt = Math.max(1, Math.min(100, dtMs));
      const gain = Math.max(0.5, Math.min(2, sensitivity));
      const flux = [0, 0, 0],
        power = [0, 0, 0];
      for (let i = 0; i < spectrum.length; i++) {
        const value = Number.isFinite(spectrum[i])
          ? Math.max(0, spectrum[i])
          : 0;
        const hz = ((i + 0.5) / spectrum.length) ** 1.9 * 18000;
        const group = region(hz);
        const reference = Math.max(
          previous[i - 1] ?? 0,
          previous[i] ?? 0,
          previous[i + 1] ?? 0,
        );
        flux[group] = Math.max(flux[group], value - reference);
        const rmsValue = spectrumRms?.[i];
        power[group] +=
          rmsValue !== undefined && Number.isFinite(rmsValue)
            ? rmsValue ** 2
            : value ** 5;
      }
      // Rectangular PCM RMS provides the fast attack path before a Hann-window
      // spectrum has filled. Distribute it by actual spectral activity.
      const volumeFlux =
        (Math.max(0, rms - previousRms) / Math.max(0.02, previousRms)) * 0.25;
      // Compare against newly arriving power, so a steady loud bass does not
      // mask a quiet high-frequency attack. Existing power can still support a
      // timbre change at constant RMS within the same region.
      const peak = Math.max(
        1e-16,
        ...power.map((value, i) => Math.max(0, value - previousPower[i])),
      );
      const shares = power.map((value) => Math.min(1, value / peak));
      const totalPower = Math.max(
        1e-16,
        power.reduce((sum, value) => sum + value, 0),
      );
      const events = [false, false, false];
      sinceOnset += dt;
      for (let group = 0; group < 3; group++) {
        flux[group] =
          audible && rms >= MUSIC_GATE_CLOSE_RMS
            ? Math.max(flux[group], volumeFlux) *
              shares[group] *
              Math.min(2, 1024 / 48 / dt)
            : 0;
        const threshold = Math.max(0.018 / gain, average[group] * 2 + 0.004);
        pulses[group] *= Math.exp(-dt / 80);
        if (flux[group] < threshold * 0.65) armed[group] = true;
        // A note ending also spreads energy. A falling overall signal needs
        // substantial new regional energy before it can qualify as an onset.
        const supported = rms >= previousRms * 0.98 ||
          power[group] > previousPower[group] * 1.1 && power[group] / totalPower > 0.15;
        if (armed[group] && supported && sinceOnset >= 65 && flux[group] > threshold)
          events[group] = true;
        average[group] +=
          (flux[group] - average[group]) * (1 - Math.exp(-dt / 400));
      }
      const onset = events.some(Boolean);
      if (onset) {
        sinceOnset = 0;
        activeGroups = [...events];
        for (let group = 0; group < 3; group++)
          if (events[group]) {
            armed[group] = false;
          }
      }
      for (let group = 0; group < 3; group++) {
        if (activeGroups[group] && sinceOnset < 65) {
          // The same event can reach its strength as the window fills, without
          // emitting another onset. Absolute RMS bounds the visual impulse.
          const groupRms = rms * Math.sqrt(power[group] / totalPower);
          pulses[group] = Math.max(pulses[group],
            clamp((groupRms / 0.18) ** 0.4) * clamp(flux[group] / 0.12));
        }
      }
      previous = spectrum.map(value => Number.isFinite(value) ? Math.max(0, value) : 0);
      previousRms = rms;
      previousPower = power;
      if (!audible) pulses.fill(0);
      return { onset, transients: [...pulses], bandOnsets: events };
    },
  };
}
