import type { RailAudioConfig } from './audio-config'
import type { RailMusicFrame } from './audio-source'

export const railAudioTravel = 3
const clamp = (value: number) => Math.max(0, Math.min(1, value))

/** Bounded displacement, sampled identically by cord paths and attachments. */
export class RailAudioMotion {
  level = 0
  bass = 0
  pulse = 0
  time = 0
  private generation = -1
  private beat = -1
  update(dt: number, frame: RailMusicFrame | null, config: RailAudioConfig, paused: boolean) {
    if (!Number.isFinite(dt) || dt <= 0) return 0
    dt = Math.max(0, Math.min(.05, dt))
    const amount = config.enabled && !paused ? config.amount / 100 : 0
    const mix = 1 - Math.exp(-dt / (paused ? .06 : .18))
    this.level += ((frame?.level ?? 0) * amount - this.level) * mix
    this.bass += ((frame?.bass ?? 0) * amount - this.bass) * mix
    this.pulse *= Math.exp(-dt / .22)
    this.time += dt
    let impulse = 0
    if (frame) {
      if (frame.generation !== this.generation) {
        this.generation = frame.generation
        this.beat = frame.beatIndex
        this.pulse = 0
      } else if (frame.beatIndex !== this.beat) {
        this.beat = frame.beatIndex
        // Consume suppressed beats too; interaction/reconnection never replays them.
        if (frame.beatAge >= 0 && frame.beatAge < 140 && config.profile !== 'gentle') {
          impulse = clamp(frame.beatStrength) * amount
          this.pulse = Math.max(this.pulse, impulse)
        }
      }
    }
    if (paused || !config.enabled) this.pulse *= Math.exp(-dt / .04)
    return impulse
  }
  offset(t: number, config: RailAudioConfig, unit: number) {
    if (t <= 0 || t >= 1) return 0
    const envelope = Math.sin(Math.PI * t)
    const breathing = -this.level * .75
    const bounce = this.pulse * Math.cos(this.time * 17) * 1.8
    const wave = config.profile === 'string'
      ? Math.sin(Math.PI * 3 * t) * Math.cos(this.time * 8) * this.bass * 1.8 : 0
    const y = envelope * (breathing + bounce + wave)
    return Math.max(-railAudioTravel, Math.min(railAudioTravel, y)) * unit
  }
}
