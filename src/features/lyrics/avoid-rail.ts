import type { SceneBounds } from '../spectrum/model'
import type { RailSettings } from '../rail/model'

export const overlapArea = (a: SceneBounds, b: SceneBounds) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

export function railObstacles(rail: RailSettings | undefined, screen: { width: number; height: number }): SceneBounds[] {
  if (!rail?.enabled || screen.width <= 0 || screen.height <= 0) return []
  const padding = 12
  return rail.groups.map(group => {
    // Match the rail's logical window size, including its wheel and header.
    const unit = Math.max(.65, Math.min(1.35, screen.width * group.width / 880))
    const height = group.collapsed ? 36 : 300 * unit + 28
    const x = Math.max(0, group.x - padding / screen.width), y = Math.max(0, group.y - padding / screen.height)
    return { x, y, width: Math.min(1, group.x + group.width + padding / screen.width) - x,
      height: Math.min(1, group.y + (height + padding) / screen.height) - y }
  })
}

export function avoidRail(bounds: SceneBounds, obstacles: SceneBounds[]): { bounds: SceneBounds; crowded: boolean } {
  if (!obstacles.some(obstacle => overlapArea(bounds, obstacle) > 1e-8)) return { bounds, crowded: false }
  const xs = [...new Set([0, 1, ...obstacles.flatMap(o => [o.x, o.x + o.width])])].sort((a, b) => a - b)
  const ys = [...new Set([0, 1, ...obstacles.flatMap(o => [o.y, o.y + o.height])])].sort((a, b) => a - b)
  let best: SceneBounds | null = null, score = Infinity
  for (const x of xs) for (const right of xs) for (const y of ys) for (const bottom of ys) {
    const width = Math.min(bounds.width, right - x), height = Math.min(bounds.height, bottom - y)
    if (width < .25 || height < .1) continue
    const candidate = { x: Math.max(x, Math.min(right - width, bounds.x)), y: Math.max(y, Math.min(bottom - height, bounds.y)), width, height }
    if (obstacles.some(o => overlapArea(candidate, o) > 1e-8)) continue
    // Preserve size first; otherwise keep the largest readable area nearby.
    const loss = 1 - width * height / (bounds.width * bounds.height)
    const cost = loss * 10 + Math.hypot(candidate.x - bounds.x, candidate.y - bounds.y)
    if (cost < score) { best = candidate; score = cost }
  }
  // Never squeeze text into an unreadable strip. The caller can show a placement hint.
  return { bounds: best ?? bounds, crowded: !best }
}
