import { expect, test } from '@playwright/test'
import { createMusicDriver } from '../src/features/spectrum/music-engine/effects/musicDriver'
import { musicEffects, classicMusicEffects, normalizeMusicSettings } from '../src/features/spectrum/music-engine/catalog'
import { normalizeSettings, defaults } from '../src/features/spectrum/model'
import { regionPatch, settingsForRegion } from '../src/features/spectrum/regions'
import { importScene, sceneDocument, layout } from '../src/features/preview/scene-library'
import { analyzeWallpaper, composeSuggestion } from '../src/features/preview/scene-suggestions'

test('live audio driver consumes true RMS without deriving volume from frequency magnitude', () => {
  const driver = createMusicDriver()
  const bands = Array(6).fill(.8), spectrum = Array(48).fill(.9)
  let frame = driver.updateAudio({ rms: 0, audible: false, bands: bands.map(() => 0), spectrum: spectrum.map(() => 0) }, 0, 1)
  expect(frame.intensitySample.current).toBe(0)
  frame = driver.updateAudio({ rms: .037, audible: true, bands, spectrum }, 25, 1)
  expect(frame.intensitySample.current).toBe(.037)
  expect(frame.intensity).toBe(.037)
  frame = driver.updateAudio({ rms: .37, audible: true, bands, spectrum }, 50, 1)
  expect(frame.intensity).toBe(.37)
})

test('classic and ambient 3D scenes persist with independent region parameters and scene export', () => {
  expect(classicMusicEffects).toHaveLength(7)
  for (const effect of musicEffects) {
    const settings = normalizeSettings({ ...defaults, effect: effect.value, music: { rainCount: 20, ballSpeedMultiplier: 1.7 } })
    const saved = importScene(sceneDocument({ name: effect.label, scene: layout(settings) }))
    expect(saved.scene.effect).toBe(effect.value)
    expect(saved.scene.music.ballSpeedMultiplier).toBe(1.7)
  }
  const normalized = normalizeMusicSettings({ rainCount: 99, jellyCount: 1, ballSpeedMultiplier: NaN })
  expect(normalized).toMatchObject({ rainCount: 20, jellyCount: 3, ballSpeedMultiplier: 1.5 })
  const settings = normalizeSettings({ regions: [{ ...defaults, id: 'second', name: '第二层', music: { rainCount: 20 } }] })
  const patch = regionPatch(settings, 'second', { music: { ...settings.music, rainCount: 5 } })
  const next = { ...settings, ...patch }
  expect(settingsForRegion(next, 'second').music.rainCount).toBe(5)
  expect(next.music.rainCount).toBe(10)
  expect(normalizeSettings({ effect: 'ribbon' }).effect).toBe('ripple')
  const legacy = JSON.parse(JSON.stringify(layout(defaults)))
  legacy.effect = 'ribbon'; delete legacy.music
  const migrated = importScene(JSON.stringify({ format: 'SoundSpectra.scene', version: 1, name: '旧收藏', scene: legacy }))
  expect(migrated.scene.effect).toBe('ripple')
  expect(migrated.scene.music.ballSpeedMultiplier).toBe(1.5)
  legacy.effect = 'unknown'
  expect(() => importScene(JSON.stringify({ format: 'SoundSpectra.scene', version: 1, name: '无效', scene: legacy }))).toThrow('场景参数无效')
  for (const effect of ['constructor', 'toString', '__proto__']) {
    expect(normalizeSettings({ effect }).effect).toBe(defaults.effect)
    legacy.effect = effect
    expect(() => importScene(JSON.stringify({ format: 'SoundSpectra.scene', version: 1, name: '无效', scene: legacy }))).toThrow('场景参数无效')
  }
})

test('automatic scene intensity adjusts the spatial effect controls', () => {
  const image = new Uint8ClampedArray(32 * 18 * 4).fill(120)
  const { suggestions } = analyzeWallpaper(image, 32, 18)
  for (const suggestion of suggestions) {
    const soft = composeSuggestion(suggestion, 10), strong = composeSuggestion(suggestion, 90)
    expect(strong.music.sensitivity).toBeGreaterThan(soft.music.sensitivity)
    expect(strong.music.speed).toBeGreaterThan(soft.music.speed)
    expect(strong.music.driftSpeed).toBeGreaterThan(soft.music.driftSpeed)
    expect(strong.music.skinFlowSpeedMultiplier).toBeGreaterThan(soft.music.skinFlowSpeedMultiplier)
    expect(musicEffects.some(effect => effect.value === strong.effect)).toBe(true)
  }
})
