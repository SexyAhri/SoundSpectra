import type { WebGLRenderer } from 'three'
import type { SpectrumSettings } from '../model'
import type { SceneMotion } from './motion'
import { SoundFieldRenderer } from './terrain/terrain-renderer'
import { AmbientSceneRenderer } from './ambient/ambient-renderer'
import { ClassicSceneRenderer } from './classic/classic-renderer'
import { isClassicEffect } from '../music-engine/catalog'

export interface ThreeSceneRenderer {
  readonly renderer: WebGLRenderer
  resize(config: SpectrumSettings, regionCount: number): void
  hover?(clientX: number, clientY: number): void
  hit(clientX: number, clientY: number): { x: number; z: number } | null
  draw(motion: SceneMotion, config: SpectrumSettings, reduced: boolean): void
  clear(): void
  dispose(): void
}

export const createThreeSceneRenderer = (canvas: HTMLCanvasElement, effect: SpectrumSettings['effect']): ThreeSceneRenderer =>
  effect === 'sound_field' ? new SoundFieldRenderer(canvas) : isClassicEffect(effect) ? new ClassicSceneRenderer(canvas) : new AmbientSceneRenderer(canvas)
