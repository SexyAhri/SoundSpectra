import { memo } from 'react'
import type { railWheel } from './rail-wheel'
import type { RailSkinTheme } from './skin-theme'

interface Props { unit: number; geometry: ReturnType<typeof railWheel>; attachments: number[]; theme: RailSkinTheme }

/** Three continuous vines weave over and under each other along the card curve. */
export const RailFloralCord = memo(function RailFloralCord({ unit, geometry, attachments, theme }: Props) {
  const left = geometry.point(-geometry.half), right = geometry.point(geometry.half)
  const span = right.x - left.x
  const at = geometry.atX, braid = theme.ropeStyle.braid!
  const samples = Math.ceil(span / (1.8 * unit))
  const strands = [0, 1, 2].map(strand => {
    let back = '', front = '', light = '', drawing = false
    for (let index = 0; index <= samples; index++) {
      const x = left.x + span * index / samples, curve = at(x)
      const phase = (x - left.x) / (braid.pitch * unit) * Math.PI * 2 + strand * Math.PI * 2 / 3
      const normal = Math.sqrt(1 + curve.slope ** 2), offset = Math.sin(phase) * braid.amplitude * unit
      const px = x - curve.slope / normal * offset, py = curve.y + offset / normal
      const point = `${px.toFixed(2)} ${py.toFixed(2)}`
      back += `${index ? 'L' : 'M'}${point}`
      // Opposite halves cross at different depths. Compound paths keep this
      // static braid small even on a wide desktop.
      if (Math.cos(phase) >= 0) {
        front += `${drawing ? 'L' : 'M'}${point}`
        light += `${drawing ? 'L' : 'M'}${(px + curve.slope / normal * braid.lightOffset * unit).toFixed(2)} ${(py - braid.lightOffset * unit / normal).toFixed(2)}`
        drawing = true
      } else drawing = false
    }
    return { back, front, light }
  })
  const anchors = [left.x, ...attachments.filter(x => x > left.x && x < right.x).sort((a, b) => a - b), right.x]
  const flowers = anchors.slice(1).flatMap((end, index) => {
    const start = anchors[index], length = end - start
    if (length < theme.decoration.minGap * unit) return []
    const count = Math.max(1, Math.floor(length / (theme.decoration.spacing * unit)))
    return Array.from({ length: count }, (_, part) => start + length * (part + .5) / count)
  })
  const leaves = Array.from({ length: Math.floor(span / (theme.decoration.leafSpacing * unit)) }, (_, index) => left.x + (index + .5) * theme.decoration.leafSpacing * unit)
    .filter(x => x > left.x + 15 * unit && x < right.x - 15 * unit && attachments.every(anchor => Math.abs(anchor - x) > 17 * unit) && flowers.every(flower => Math.abs(flower - x) > 25 * unit))

  return <g className="rail-floral-cord" aria-hidden="true">
    <path className="rail-vine-shadow" data-rail-rope-path={geometry.path} d={geometry.path} transform={`translate(0 ${unit})`} />
    <g className="rail-floral-braid">
      {strands.map(({ back }, index) => <path key={index} className={`rail-braid-strand rail-braid-${index}`} data-rail-rope-path={back} d={back} />)}
      {strands.map(({ front, light }, index) => <g key={index}>
        <path className="rail-braid-edge" data-rail-rope-path={front} d={front} />
        <path className={`rail-braid-strand rail-braid-${index}`} data-rail-rope-path={front} d={front} />
        <path className="rail-braid-light" data-rail-rope-path={light} d={light} />
      </g>)}
    </g>
    {leaves.map((x, index) => <g className="rail-floral-sprig" data-rail-decoration-x={x} key={`leaf-${index}`} transform={`translate(${x} ${at(x).y}) rotate(${at(x).angle}) scale(${unit})`}>
      <g transform={`scale(1 ${index % 2 ? -1 : 1})`}>
        <path className="rail-vine-leaf rail-vine-leaf-light" d="M-7 0Q-3-11 7-8Q5-1-7 0Z" />
        <path className="rail-vine-vein" d="M-5 0 4-6" />
      </g>
    </g>)}
    {flowers.map((x, index) => <g className="rail-floral-sprig" data-rail-decoration-x={x} key={`flower-${index}`} transform={`translate(${x} ${at(x).y}) rotate(${at(x).angle}) scale(${unit})`}>
      <g className="rail-vine-leaves" transform={`scale(${index % 2 ? -1 : 1} 1)`}>
        <path className="rail-vine-leaf" d="M-5-1Q-13-12-21-7Q-19 0-5-1Z" />
        <path className="rail-vine-leaf rail-vine-leaf-light" d="M8 1Q16-6 23-2Q19 5 8 1Z" />
        <path className="rail-vine-leaf" d="M12 3Q19 1 24 8Q16 10 12 3Z" />
        <path className="rail-vine-vein" d="M-7-1-18-6 M10 1 20-1 M15 5 21 7" />
      </g>
      <g className="rail-vine-flower" transform={`translate(-1 -1) rotate(${index % 2 ? 22 : -8})`}>
        {[0, 72, 144, 216, 288].map(rotation => <ellipse key={rotation} className="rail-vine-petal" cy="-3.5" rx="2.5" ry="3.8" transform={`rotate(${rotation})`} />)}
        <circle className="rail-vine-heart" r="1.9" />
        <circle className="rail-vine-pollen" cx="-.5" cy="-.5" r=".55" />
      </g>
      {index % 3 !== 1 && <g className="rail-vine-blush" transform={`translate(${index % 2 ? -20 : 20} 1) rotate(${index % 2 ? -22 : 22})`}>
        {[-38, 0, 38].map(rotation => <ellipse key={rotation} className="rail-vine-pink-petal" cy="-2.2" rx="2.1" ry="3.3" transform={`rotate(${rotation})`} />)}
        <path className="rail-vine-leaf" d="M-2 1Q0 4 2 1L0 2Z" />
      </g>}
    </g>)}
  </g>
})
