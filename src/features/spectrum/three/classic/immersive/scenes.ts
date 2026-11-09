import type { ClassicEffect } from "../../../music-engine/catalog";
import { createNightRain } from "./night-rain";
import { createWindowRain } from "./window-rain";
import { createSunlitSeeds } from "./sunlit-seeds";
import { createWindSilk } from "./wind-silk";
import { createIonStorm } from "./ion-storm";
import { createDriftingSnow } from "./drifting-snow";
import { createGalaxy } from "./galaxy";
import { createJellyfishGarden } from "./jellyfish-garden";
import { createButterflyFlock } from "./butterfly-flock";
import { createCausticLight } from "./caustic-light";
import { createGinkgoLeaves } from "./ginkgo-leaves";
import { createCosmicWeb } from "./cosmic-web";

export const createImmersiveScene = (effect: ClassicEffect, detail: number) => {
  switch (effect) {
    case "window_rain":
      return createWindowRain(detail);
    case "butterfly_flock":
      return createButterflyFlock(detail);
    case "caustic_light":
      return createCausticLight(detail);
    case "ginkgo_leaves":
      return createGinkgoLeaves(detail);
    case "cosmic_web":
      return createCosmicWeb(detail);
    case "rhythm_balls":
      return createJellyfishGarden(detail);
    case "rhythm_rain":
      return createNightRain(detail);
    case "rhythm_skin":
      return createWindSilk(detail);
    case "ripple":
      return createDriftingSnow(detail);
    case "volume_rain":
      return createSunlitSeeds(detail);
    case "dream_stars":
      return createGalaxy(detail);
    case "vortex":
      return createIonStorm(detail);
  }
};
