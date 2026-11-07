import { type MusicEffect, type MusicSettings } from './music-engine/catalog'
import { effectDefinitions } from './effect-definitions'

export const recommendedMusic = (effect: MusicEffect): MusicSettings => ({ ...effectDefinitions[effect].defaults })
export const effectGroups: { label: string; effects: MusicEffect[] }[] = [
  { label: '轻柔陪伴', effects: ['rhythm_balls', 'volume_rain', 'ripple', 'rhythm_rain', 'dream_stars'] },
  { label: '材质质感', effects: ['rhythm_skin', 'petal_bloom'] },
  { label: '节奏光影', effects: ['sound_field'] },
  { label: '空间氛围', effects: ['aurora_flow', 'star_flight', 'vortex'] },
]
