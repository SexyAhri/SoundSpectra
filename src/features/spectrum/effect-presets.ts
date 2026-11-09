import { type MusicEffect, type MusicSettings } from "./music-engine/catalog";
import { effectDefinitions } from "./effect-definitions";

export const recommendedMusic = (effect: MusicEffect): MusicSettings => ({
  ...effectDefinitions[effect].defaults,
});
export const effectGroups: { label: string; effects: MusicEffect[] }[] = [
  {
    label: "自然意象",
    effects: [
      "rhythm_balls",
      "volume_rain",
      "ripple",
      "rhythm_rain",
      "window_rain",
      "butterfly_flock",
      "ginkgo_leaves",
    ],
  },
  {
    label: "流动造型",
    effects: [
      "tidal_knot",
      "layered_tides",
      "rhythm_skin",
      "sound_field",
      "petal_bloom",
      "caustic_light",
    ],
  },
  {
    label: "星空与穿行",
    effects: [
      "dream_stars",
      "aurora_flow",
      "vortex",
      "echo_corridor",
      "star_flight",
      "cosmic_web",
    ],
  },
];
