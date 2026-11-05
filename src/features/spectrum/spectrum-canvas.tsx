import { lazy, Suspense, type RefObject } from 'react'
import type { SpectrumSettings } from './model'
import type { MusicAnalysis } from './music-analysis'
import type { SceneView } from './three/view'

export interface AnalysisSnapshot extends MusicAnalysis { receivedAt: number }
export interface SpectrumCanvasProps {
  settings: SpectrumSettings
  bands: RefObject<Float32Array>
  receivedAt: RefObject<number>
  analysis?: RefObject<AnalysisSnapshot>
  demo: boolean
  className?: string
  desktop?: boolean
  active?: boolean
  regionCount?: number
  interactive?: boolean
  onViewChange?: (view: SceneView) => void
}

const ThreeSceneCanvas = lazy(() => import('./three/scene-canvas').then(module => ({ default: module.ThreeSceneCanvas })))
export function SpectrumCanvas(props: SpectrumCanvasProps) {
  return <Suspense fallback={<div className="spectrum-surface" role="status" aria-label="正在载入三维声场" />}><ThreeSceneCanvas key={props.settings.effect} {...props} /></Suspense>
}
