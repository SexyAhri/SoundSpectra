import type { ClassicEffect } from '../../../music-engine/catalog'
import { createNeonRain } from './neon-rain'
import { createSunlitSeeds } from './sunlit-seeds'
import { createWindSilk } from './wind-silk'
import { createIonStorm } from './ion-storm'
import { createDriftingSnow } from './drifting-snow'
import { createGalaxy } from './galaxy'
import { createJellyfishGarden } from './jellyfish-garden'

export const createImmersiveScene = (effect:ClassicEffect,detail:number) => {
  switch(effect){
    case 'rhythm_balls':return createJellyfishGarden()
    case 'rhythm_rain':return createNeonRain(detail)
    case 'rhythm_skin':return createWindSilk(detail)
    case 'ripple':return createDriftingSnow(detail)
    case 'volume_rain':return createSunlitSeeds(detail)
    case 'dream_stars':return createGalaxy(detail)
    case 'vortex':return createIonStorm(detail)
  }
}
