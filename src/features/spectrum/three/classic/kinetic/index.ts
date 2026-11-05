import type { MusicEffect } from '../../../music-engine/catalog'
import { bouncingSpheres } from './balls'
import { fallingRain, volumeFountain } from './rain'
import { spectrumArchitecture, spectrumCrown } from './spectrum'
import { waterSurface } from './water'
import type { KineticEffect } from './common'

export const kineticEffects = ['rhythm_balls','rhythm_rain','volume_rain','spectrum_bars','rhythm_bars','water_ripple'] as const
export function createKineticEffect(effect: MusicEffect, detail: number): KineticEffect {
  switch(effect) {
    case 'rhythm_balls': return bouncingSpheres(detail)
    case 'rhythm_rain': return fallingRain(detail)
    case 'volume_rain': return volumeFountain(detail)
    case 'spectrum_bars': return spectrumArchitecture()
    case 'rhythm_bars': return spectrumCrown()
    case 'water_ripple': return waterSurface(detail)
    default: throw new Error(`Unsupported kinetic scene: ${effect}`)
  }
}
