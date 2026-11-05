import { useEffect, useRef, useState } from 'react'
import type { LyricLine } from './model'
import { KineticComposition, type CompositionMode } from './kinetic-composition'

export function KineticLyrics({ lines, index, time, fontSize, regionWidth, mode, reduced, backgroundOpacity = 30 }: {
  lines: LyricLine[]; index: number; time: number; fontSize: number; regionWidth: number; mode: CompositionMode; reduced: boolean;
  backgroundOpacity?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null), engine = useRef(new KineticComposition())
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const node = canvas.current!, measure = () => setSize({ width: node.clientWidth, height: node.clientHeight })
    const observer = new ResizeObserver(measure); observer.observe(node); measure()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const node = canvas.current!, context = node.getContext('2d'), { width, height } = size
    if (!context || !width || !height) return
    const scale = Math.min(devicePixelRatio || 1, 2, Math.sqrt(2_400_000 / (width * height)))
    const pixelWidth = Math.max(1, Math.round(width * scale)), pixelHeight = Math.max(1, Math.round(height * scale))
    if (node.width !== pixelWidth || node.height !== pixelHeight) { node.width = pixelWidth; node.height = pixelHeight }
    context.setTransform(scale, 0, 0, scale, 0, 0)
    engine.current.draw(context, { lines, index, time, width, height, fontSize, regionWidth, mode, reduced, backgroundOpacity })
    node.dataset.time = String(Math.round(time)); node.dataset.composition = mode; node.dataset.line = String(index)
    node.dataset.backgroundOpacity = String(backgroundOpacity)
  }, [lines, index, time, fontSize, regionWidth, mode, reduced, size, backgroundOpacity])
  return <canvas ref={canvas} className="kinetic-lyrics-canvas" aria-hidden="true" />
}
