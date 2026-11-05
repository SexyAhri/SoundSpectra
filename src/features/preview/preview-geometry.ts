import type { SpectrumSettings } from '../spectrum/model'
export type Bounds = SpectrumSettings['bounds']
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
export function moveBounds(start: Bounds, dx: number, dy: number): Bounds {
  return { ...start, x: clamp(start.x + dx, 0, 1 - start.width), y: clamp(start.y + dy, 0, 1 - start.height) }
}
export function resizeBounds(start: Bounds, dx: number, dy: number): Bounds {
  const cx = start.x + start.width / 2, cy = start.y + start.height / 2
  const width = clamp(start.width + dx * 2, .2, Math.min(1, 2 * Math.min(cx, 1 - cx)))
  const height = clamp(start.height + dy * 2, .08, Math.min(1, 2 * Math.min(cy, 1 - cy)))
  return { x: Math.max(0, cx - width / 2), y: Math.max(0, cy - height / 2), width, height }
}
