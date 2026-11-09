import type { SceneMotion } from "../spectrum/three/motion";
import { mappingCapabilities, type Mapping } from "./model";
import type { SpectrumSettings } from "../spectrum/model";

export interface MappingValues {
  bend: number;
  unfold: number;
}
/** Fixed display range over captured physical bands; no FFT, normalization, gain history or integration. */
export function mappingValues(
  effect: SpectrumSettings["effect"],
  mapping: Mapping | undefined,
  motion: SceneMotion,
  reduced: boolean,
): MappingValues {
  if (
    !mappingCapabilities[effect] ||
    !mapping ||
    mapping.preset === "original" ||
    reduced ||
    !motion.transporting ||
    !motion.frame?.audible
  )
    return { bend: 0, unfold: 0 };
  const f = motion.frame,
    band = mapping.source === "bass" ? 0 : mapping.source === "middle" ? 1 : 2;
  const rms = f.bandRms;
  const raw =
    mapping.source === "transient"
      ? Math.max(0, ...f.transients)
      : rms?.length === 3
        ? rms[band]
        : rms && rms.length >= 6
          ? (rms[band * 2] + rms[band * 2 + 1]) / 2
          : 0;
  const x = Math.max(
    0,
    Math.min(
      1,
      Number.isFinite(raw)
        ? raw / (mapping.source === "transient" ? 1 : 0.22)
        : 0,
    ),
  );
  const value = (mapping.curve === "square" ? x * x : x) * mapping.amount;
  return {
    bend: mapping.target === "bend" ? value : 0,
    unfold: mapping.target === "unfold" ? value : 0,
  };
}
