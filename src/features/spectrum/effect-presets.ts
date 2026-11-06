import { defaultMusicSettings, type MusicEffect, type MusicSettings } from './music-engine/catalog'

const profiles: Record<MusicEffect, Partial<MusicSettings>> = {
  rhythm_balls: { speed: 1, sensitivity: 1, jellyCount: 5, jellySize: 2.4, driftSpeed: 1.5, tentacleLength: .5 },
  rhythm_rain: { speed: 1, sensitivity: .8, rainSpeedMultiplier: 1.2, rainRadiusMultiplier: .8, rainCount: 8, response: 'soft' },
  rhythm_skin: { speed: 1, sensitivity: .8, skinFlowSpeedMultiplier: 1.3, dragonTrail: 2, response: 'soft' },
  ripple: { speed: 1, sensitivity: .65, rippleLights: 2, rippleTwist: .3, response: 'soft' },
  volume_rain: { speed: 1, sensitivity: .65, meteorDensity: 48, meteorTrail: .8, response: 'soft' },
  dream_stars: { speed: 1, sensitivity: .8, starDensity: 2400, nebulaScale: 1, dustOpacity: .65, spinSpeed: .55, response: 'soft' },
  vortex: { speed: 1, sensitivity: .85, vortexArms: 3, vortexWidth: .85, response: 'soft' },
  sound_field: { speed: 1, sensitivity: .9, fieldHeight: .8, fieldBrightness: 42 },
  petal_bloom: { speed: 1, sensitivity: .7, ambientDensity: .8, fieldBrightness: 42, response: 'soft' },
  aurora_flow: { speed: 1, sensitivity: .8, fieldBrightness: 48, response: 'soft' },
  star_flight: { speed: 2, sensitivity: .9, fieldBrightness: 55, ambientDensity: .85 },
}
export const recommendedMusic = (effect: MusicEffect): MusicSettings => ({ ...defaultMusicSettings, ...profiles[effect] })
export const effectGroups: { label: string; effects: MusicEffect[] }[] = [
  { label: '轻柔陪伴', effects: ['rhythm_balls', 'volume_rain', 'ripple', 'rhythm_rain', 'dream_stars'] },
  { label: '材质质感', effects: ['rhythm_skin', 'petal_bloom'] },
  { label: '节奏光影', effects: ['sound_field'] },
  { label: '空间氛围', effects: ['aurora_flow', 'star_flight', 'vortex'] },
]
