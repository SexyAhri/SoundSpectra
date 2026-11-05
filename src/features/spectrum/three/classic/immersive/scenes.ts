import type { ClassicEffect } from '../../../music-engine/catalog'
import { createMoltenTide } from './molten-tide'
import { createLightCorridor } from './light-corridor'
import { createNeonRain } from './neon-rain'
import { createSunlitSeeds } from './sunlit-seeds'
import { createNightLake } from './night-lake'
import { createWindSilk } from './wind-silk'
import { createIonStorm } from './ion-storm'
import { createDriftingSnow } from './drifting-snow'
import { createDeepSpace } from './deep-space'
import { createGravitySea } from './gravity-sea'
import { createSpectrumWorld } from './spectrum-worlds'

export const createImmersiveScene = (effect:ClassicEffect,detail:number) => {
  switch(effect){
    case 'rhythm_balls':return createGravitySea(detail)
    case 'rhythm_rain':return createNeonRain(detail)
    case 'rhythm_fluid':return createMoltenTide(detail)
    case 'rhythm_skin':return createWindSilk(detail)
    case 'spectrum_bars':return createSpectrumWorld()
    case 'ripple':return createDriftingSnow(detail)
    case 'pulse_ring':return createLightCorridor()
    case 'volume_rain':return createSunlitSeeds(detail)
    case 'dream_stars':return createDeepSpace(detail)
    case 'vortex':return createIonStorm(detail)
    case 'water_ripple':return createNightLake(detail)
    case 'rhythm_bars':return createSpectrumWorld(true)
  }
}
