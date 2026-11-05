import type { MusicEffect } from '../../../music-engine/catalog'
import { createPathEffect } from './apparatus-paths'
import { createRipple, createPulse } from './waves'
import { createDreamStars } from './stars'
export type { FlowEffect } from './shared'

export function createFlowEffect(effect: MusicEffect, detail: number) {
  if (effect === 'ripple') return createRipple(detail)
  if (effect === 'pulse_ring') return createPulse()
  if (effect === 'dream_stars') return createDreamStars(detail)
  if (effect === 'rhythm_fluid' || effect === 'rhythm_skin' || effect === 'vortex') return createPathEffect(effect, detail)
  throw new Error(`Unsupported spatial flow effect: ${effect}`)
}
