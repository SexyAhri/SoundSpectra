import { AudioFeatureTimeline } from './audio-feature-timeline'
import { defaults, type SpectrumSettings } from './model'
import type { MusicAnalysis } from './music-analysis'
import { recommendedMusic } from './effect-presets'
import type { MusicEffect } from './music-engine/catalog'
import { FiberSceneRenderer } from './three/r3f/fiber-renderer'
import { SceneMotion } from './three/motion'

export const studyVersion = 'synthetic-features-v1'
export const studyPoints = [
  { id: 'drums', label: '低频鼓点', time: 2.4 },
  { id: 'sustain', label: '中频持续音', time: 5.2 },
  { id: 'high', label: '高频细节', time: 7.5 },
  { id: 'quiet', label: '安静段', time: 9.8 },
  { id: 'stop', label: '骤停后 0.1 秒', time: 12.1 },
  { id: 'release', label: '骤停后 1.2 秒', time: 13.2 },
  { id: 'silence', label: '完全静音', time: 15.8 },
] as const

/** Authored analysis fixtures, not recorded music, PCM analysis or a live input.
 * Packet times match the real capture hop. No browser clock creates onsets.
 */
export function studyAnalysis(sequence: number): MusicAnalysis {
  const t = sequence * 1024 / 48000
  let rms = 0, bands = Array<number>(6).fill(0)
  if (t >= .8 && t < 3.2) {
    const age = (t - .8) % .5, hit = Math.exp(-age * 24)
    rms = .023 + hit * .22
    bands = [.08 + hit * .8, .06 + hit * .55, .08, .06, .02, .01]
  } else if (t >= 3.2 && t < 6.2) {
    rms = .13; bands = [.06, .1, .5, .55, .09, .025]
  } else if (t >= 6.2 && t < 8.6) {
    rms = .11; bands = [.025, .03, .06, .12, .6, .75]
  } else if (t >= 8.6 && t < 10.6) {
    rms = .018; bands = [.02, .025, .04, .04, .015, .01]
  } else if (t >= 10.6 && t < 12) {
    const rise = (t - 10.6) / 1.4
    rms = .05 + rise * .16; bands = [.1, .16, .3, .4, .2, .1].map(v => v * (.4 + rise))
  }
  return { rms, bands, spectrum: Array.from({ length: 48 }, (_, i) => {
    const band = bands[Math.min(5, Math.floor(i / 8))]
    return band * (.6 + .4 * Math.exp(-(((i % 8 - 3) / 2.8) ** 2)))
  }), skin: [], sourceRevision: 1, streamId: 1, sequence, samplePosition: sequence * 1024, sampleRate: 48000 }
}

export function studySettings(effect: MusicEffect, sceneMode: SpectrumSettings['sceneMode']): SpectrumSettings {
  return { ...structuredClone(defaults), effect, sceneMode, opacity: 100, quality: 'balanced',
    music: recommendedMusic(effect), bounds: { x: 0, y: 0, width: 1, height: 1 }, masks: [] }
}

export interface StudyFrame { id: string; time: number; image: string; hash: number; coverage: number; centerCoverage: number; meanLight: number }
export async function renderVisualStudy(host: HTMLElement, settings: SpectrumSettings, options: {
  points?: readonly { id: string; time: number }[]; width?: number; height?: number; reduced?: boolean
} = {}) {
  const points = options.points ?? studyPoints, fps = 30, reduced = options.reduced ?? false
  const canvas = document.createElement('canvas')
  const width = options.width ?? 960, height = options.height ?? 540
  canvas.style.cssText = `display:block;width:${width}px;height:${height}px`
  host.append(canvas)
  const errors: string[] = [], world = new FiberSceneRenderer(canvas, error => { errors.push(String(error)) })
  const timeline = new AudioFeatureTimeline(), motion = new SceneMotion(), frames: StudyFrame[] = []
  let sequence = 0, audio = studyAnalysis(0), disposed = false
  try {
    await world.resize(settings, 1)
    const gl = world.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info')
    const gpu = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : gl.getParameter(gl.RENDERER)
    const end = Math.round(Math.max(...points.map(p => p.time)) * fps)
    for (let frame = 0; frame <= end; frame++) {
      const time = frame / fps
      while (sequence * 1024 / 48000 <= time + 1e-9) {
        audio = studyAnalysis(sequence++)
        timeline.push(audio, audio.samplePosition! / 48000 * 1000)
      }
      motion.step(audio, 1 / fps, settings.music, reduced, timeline.sample(time * 1000, settings.music))
      world.draw(motion, settings, reduced, 1 / fps)
      for (const point of points.filter(p => Math.round(p.time * fps) === frame)) {
        const pixels = new Uint8Array(canvas.width * canvas.height * 4)
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        let visible = 0, center = 0, centerCount = 0, light = 0, hash = 2166136261
        for (let i = 0; i < pixels.length; i += 4) {
          const x = (i / 4 % canvas.width) / canvas.width, y = Math.floor(i / 4 / canvas.width) / canvas.height
          const inCenter = x > .3 && x < .7 && y > .25 && y < .75
          if (inCenter) centerCount++
          if (pixels[i + 3] > 8) { visible++; if (inCenter) center++ }
          light += Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) / 255
          hash = Math.imul(hash ^ pixels[i] ^ pixels[i + 1] ^ pixels[i + 2] ^ pixels[i + 3], 16777619)
        }
        frames.push({ id: point.id, time, image: canvas.toDataURL('image/png'), hash,
          coverage: visible / (canvas.width * canvas.height), centerCoverage: center / Math.max(1, centerCount), meanLight: light / (canvas.width * canvas.height) })
      }
      if (frame % 30 === 0) await new Promise(resolve => setTimeout(resolve, 0))
    }
    if (gl.getError()) errors.push('WebGL error')
    const output = { width: canvas.width, height: canvas.height }
    world.dispose(); disposed = true
    const remaining = { ...world.renderer.info.memory }
    return { version: studyVersion, fps, seed: 'authored fixed geometry seeds',
      representativeSeeds:{rhythm_balls:{dust:83127},rhythm_skin:'analytic surface; no random sampling',sound_field:{grid:9351}},
      input:{sampleRate:48000,hop:1024,sequence:'studyAnalysis in visual-study.ts',capture:'none'},
      gpu, settings, reduced, output, frames, errors, remaining }
  } finally {
    if (!disposed) world.dispose()
    world.renderer.forceContextLoss(); canvas.remove()
  }
}
