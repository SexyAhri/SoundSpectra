import { expect, test } from '@playwright/test'
import { RailItemPhysics } from '../src/features/rail/physics'
import { getRailSkinTheme } from '../src/features/rail/skin-theme'
import { railWheel } from '../src/features/rail/rail-wheel'

const physics = getRailSkinTheme('floral').physics

test('card springs agree at 30, 60 and 144 Hz, including interaction braking', () => {
  const run = (fps: number) => {
    const spring = new RailItemPhysics('sample')
    for (let frame = 0; frame < fps * 8; frame++) spring.update(1 / fps, frame >= fps * 7, physics)
    return [spring.angle, spring.angularVelocity]
  }
  const baseline = run(60)
  for (const fps of [30, 144]) run(fps).forEach((value, index) => expect(value).toBeCloseTo(baseline[index], 10))
  expect(Math.abs(baseline[0])).toBeLessThan(.00001)
})

test('sway remains bounded after stalls and invalid delta times', () => {
  const spring = new RailItemPhysics('stall')
  for (let frame = 0; frame < 600; frame++) {
    spring.update(frame % 30 ? 1 / 60 : 90, false, { ...physics, windResponsiveness: 100 })
    expect(Math.abs(spring.angle)).toBeLessThanOrEqual(physics.maxAngle)
    expect(Number.isFinite(spring.angularVelocity)).toBe(true)
  }
  const before = [spring.angle, spring.angularVelocity]
  for (const delta of [NaN, Infinity, -1, 0]) spring.update(delta, false, physics)
  expect([spring.angle, spring.angularVelocity]).toEqual(before)
  spring.reset()
  expect([spring.angle, spring.angularVelocity]).toEqual([0, 0])
})

test('sagged paths and attachment samples share one curve across sizes', () => {
  for (const width of [300, 880, 2560]) for (const unit of [.65, 1, 1.35]) {
    const geometry = railWheel(width, 104 * unit, unit, 12, .9)
    for (let index = 0; index <= 100; index++) {
      const point = geometry.point(-geometry.half + geometry.half * 2 * index / 100)
      expect(geometry.atX(point.x).y).toBeCloseTo(point.y, 9)
    }
  }
})
