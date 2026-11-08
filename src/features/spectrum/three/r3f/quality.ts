import type { RenderQuality } from "../../model";
import { effectDefinitions } from "../../effect-definitions";
import type { MusicEffect } from "../../music-engine/catalog";

/** Spend quality on resolution, geometry and light separately; retain the same composition. */
export function visualQuality(
  quality: RenderQuality,
  regions: number,
  density = 1,
  effect?: MusicEffect,
) {
  const count = Math.max(1, regions),
    eco = quality === "eco",
    balanced = quality === "balanced";
  return {
    detail:
      (density *
        (effect
          ? effectDefinitions[effect].quality[quality]
          : eco
            ? 0.65
            : balanced
              ? 1
              : 1.2)) /
      Math.sqrt(count),
    terrainGrid: Math.max(
      32,
      Math.floor((eco ? 64 : balanced ? 96 : 128) / Math.sqrt(count)),
    ),
    bloomLevels: eco ? 1 : balanced ? 2 : 3,
    samples: eco ? 0 : 4,
  };
}
