import { expect, test } from '@playwright/test'
import { lyricAudio, quietLyricAudio, readLyricAudio } from '../src/features/lyrics/lyric-audio'
import { AudioFeatureTimeline } from '../src/features/spectrum/audio-feature-timeline'
import { silentAnalysis } from '../src/features/spectrum/music-analysis'
import { defaultMusicSettings } from '../src/features/spectrum/music-engine/catalog'

test('lyrics share capture onsets without advancing the source or inventing stale beats', () => {
  const timeline = new AudioFeatureTimeline()
  const analysis = { ...silentAnalysis(), receivedAt: 0, timeline }
  expect(readLyricAudio(analysis, 0)).toBe(quietLyricAudio)
  for (let i = 0; i < 50; i++) {
    const hit = i % 20 < 2
    timeline.push({ sourceRevision: 1, streamId: 1, sequence: i, samplePosition: i * 1024, sampleRate: 48000,
      rms: hit ? .3 : .025, bands: Array(6).fill(hit ? .8 : .08), spectrum: Array(48).fill(.4), skin: [] }, i * 22)
  }
  const frame = timeline.sample(1080, defaultMusicSettings)!
  const processed = timeline.processed
  expect(frame.audible).toBe(true)
  expect(readLyricAudio(analysis, 1080)).toEqual(lyricAudio(frame))
  expect(readLyricAudio(analysis, 1080)).toEqual(readLyricAudio(analysis, 1080))
  expect(timeline.processed).toBe(processed)
  expect(readLyricAudio(analysis, 1080, defaultMusicSettings, false)).toBe(quietLyricAudio)
  expect(readLyricAudio(analysis, 10000)).toBe(quietLyricAudio)
  expect(readLyricAudio(undefined, 1080)).toBe(quietLyricAudio)
  const accents = lyricAudio({ ...frame, transients: [.8, .4, .2], displayIntensity: .6 })
  expect(accents).toEqual({ bass: .8, body: .4, treble: .2, impact: .8, energy: .6 })
  expect(lyricAudio({ ...frame, audible: false })).toBe(quietLyricAudio)
})

test('folded lighting responds to audio while lyric time stays fixed, and pauses cleanly', async ({ page }) => {
  await page.goto('/tests/fixtures/folded-lyrics.html')
  const set = (patch: object) => page.evaluate(patch => (window as any).foldedProbe.set(patch), patch)
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-time', '2600')
  await set({ playing: true, advance: false })
  await expect(canvas).toHaveAttribute('data-audio-impact', '0.000')
  const silent = await canvas.screenshot()
  // Explicit synthetic accents exercise the production renderer without playing audio.
  await set({ audio: { bass: .9, body: .6, treble: .7, impact: .9, energy: .65 } })
  await expect(canvas).toHaveAttribute('data-audio-bands', '0.900,0.600,0.700')
  await expect(canvas).toHaveAttribute('data-time', '2600')
  expect((await canvas.screenshot({ path: 'artifacts/folded-curtain/audio-accent.png' })).equals(silent)).toBe(false)
  await expect(canvas).toHaveAttribute('data-echoes', '0')
  await set({ reduced: true })
  await expect(canvas).toHaveAttribute('data-audio-impact', '0.000')
  await set({ reduced: false, playing: false })
  await expect(canvas).toHaveAttribute('data-audio-impact', '0.000')
  const frames = await canvas.getAttribute('data-frames')
  await page.waitForTimeout(150)
  expect(await canvas.getAttribute('data-frames')).toBe(frames)
})

test('folded read ahead releases pending textures when changing song or seeking', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('/tests/fixtures/folded-lyrics.html')
  const set = (patch: object) => page.evaluate(patch => (window as any).foldedProbe.set(patch), patch)
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-time', '2600')
  const lines = Array.from({ length: 8 }, (_, i) => ({ text: ('长句纹理分段准备 '.repeat(25)) + i, start: i * 10000, end: i * 10000 + 9000, words: [] }))
  await set({ lines, time: 2000, playing: true, advance: false })
  await expect(canvas).toHaveAttribute('data-preparing', '1')
  await set({ time: 42000 })
  await expect(canvas).toHaveAttribute('data-line', '4')
  await expect(canvas).toHaveAttribute('data-preparing', '5')
  await set({ lines: [{ text: '新歌曲', start: 0, end: 10000, words: [] }], time: 2600, playing: false })
  await expect(canvas).toHaveAttribute('data-resources', '1')
  await expect(canvas).toHaveAttribute('data-preparing', '')
  await page.waitForTimeout(250)
  await expect(canvas).toHaveAttribute('data-resources', '1')
  await expect(canvas).toHaveAttribute('data-line', '0')
  expect(errors).toEqual([])
})
