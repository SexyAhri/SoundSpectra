import { test, expect } from '@playwright/test'
import { SpectrumMotion } from '../src/features/spectrum/spectrum-motion'
import { BAND_COUNT } from '../src/features/spectrum/model'

test('silent input stays transparent, and a loud transient settles back to silence', () => {
  const motion = new SpectrumMotion()
  const source = new Float32Array(BAND_COUNT)
  for (let i = 0; i < 60; i++) motion.step(source, 1 / 60, 100, 100, false)
  expect([...motion.levels].every(value => value === 0)).toBe(true)
  source.fill(0.85)
  for (let i = 0; i < 12; i++) motion.step(source, 1 / 60, 100, 100, false)
  expect(motion.energy).toBeGreaterThan(0.5)
  source.fill(0)
  for (let i = 0; i < 300; i++) motion.step(source, 1 / 60, 100, 100, false)
  expect([...motion.levels].every(value => value === 0)).toBe(true)
  expect(motion.energy).toBe(0)
})

test('motion remains consistent across refresh rates', () => {
  const sample = (fps: number) => {
    const motion = new SpectrumMotion()
    const input = new Float32Array(BAND_COUNT).fill(0.7)
    for (let i = 0; i < fps / 2; i++) motion.step(input, 1 / fps, 100, 65, false)
    return motion.levels[40]
  }
  expect(Math.abs(sample(30) - sample(144))).toBeLessThan(0.025)
})

test('bad samples and delayed frames cannot produce invalid or out-of-range geometry', () => {
  const motion = new SpectrumMotion()
  const source = Float32Array.from({ length: BAND_COUNT }, (_, i) => [NaN, Infinity, -1, 20][i % 4])
  for (let i = 0; i < 100; i++) motion.step(source, i % 2 ? 10 : 1 / 240, 200, 100, false)
  expect([...motion.levels].every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
  for (let i = 0; i < BAND_COUNT; i++) expect(motion.levels[i * 2 + 1]).toBeGreaterThanOrEqual(motion.levels[i * 2])
})

test('reduced motion removes detached peaks and still responds to audio', () => {
  const motion = new SpectrumMotion()
  const source = new Float32Array(BAND_COUNT).fill(0.8)
  for (let i = 0; i < 60; i++) motion.step(source, 1 / 60, 100, 65, true)
  expect(motion.energy).toBeGreaterThan(0.1)
  source.fill(0.1)
  for (let i = 0; i < 20; i++) motion.step(source, 1 / 60, 100, 65, true)
  for (let i = 0; i < BAND_COUNT; i++) expect(motion.levels[i * 2 + 1]).toBe(motion.levels[i * 2])
})
