import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { RailCord } from '../../src/features/rail/rail-cord'
import { railWheel } from '../../src/features/rail/rail-wheel'
import { bindRailCordMotion } from '../../src/features/rail/rail-cord-motion'
import { RailAudioMotion } from '../../src/features/rail/audio-motion'
import { railAudioProfiles } from '../../src/features/rail/audio-config'
import { railSkins } from '../../src/features/rail/model'

const host = document.getElementById('root')!
const root = createRoot(host)
;(window as any).cordWork = () => {
  const rows = []
  for (const skin of railSkins) for (const { value: profile } of railAudioProfiles) {
    const unit = 1, geometry = railWheel(960, 120, unit, 5)
    flushSync(() => root.render(<svg key={`${skin}-${profile}`}><RailCord skin={skin} unit={unit} geometry={geometry} attachments={[240, 480, 720]} /><path className="rail-cord-hit" d={geometry.path} data-rail-rope-path={geometry.path} /></svg>))
    const nodes = [...host.querySelectorAll<SVGPathElement>('[data-rail-rope-path]')]
    const rest = nodes.map(node => node.dataset.railRopePath!)
    const left = geometry.point(-geometry.half).x
    const span = geometry.point(geometry.half).x - left
    const segments = Math.ceil(span / (8 * unit))
    const points = (path: string) => path.includes('Q')
      ? Array.from({ length: segments + 1 }, (_, i) => { const x = left + span * i / segments; return { command: i ? 'L' : 'M', x, y: geometry.atX(x).y } })
      : [...path.matchAll(/([ML])\s*([-\d.]+)[,\s]+([-\d.]+)/g)].map(match => ({ command: match[1], x: Number(match[2]), y: Number(match[3]) }))
    const motion = new RailAudioMotion()
    Object.assign(motion, { level: .65, bass: .8, pulse: .45, time: 1.3 })
    const config = { enabled: true, amount: 80, profile }
    const offset = motion.offset.bind(motion)
    const expected = rest.map(path => points(path).map(({ command, x, y }) => `${command}${x.toFixed(2)} ${(y + offset((x - left) / span, config, unit)).toFixed(2)}`).join(''))
    const decorations = host.querySelectorAll('[data-rail-decoration-x]').length
    const before = rest.reduce((sum, path) => sum + points(path).length, decorations)
    const unique = [...new Set(rest)].reduce((sum, path) => sum + points(path).length, decorations)
    let calls = 0
    motion.offset = (...args) => { calls++; return offset(...args) }
    const binding = bindRailCordMotion(host, geometry, unit)
    binding.apply(motion, config)
    const activeCalls = calls
    const exact = nodes.every((node, i) => node.getAttribute('d') === expected[i])
    Object.assign(motion, { level: 0, bass: 0, pulse: 0 })
    binding.apply(motion, config)
    const quiet = nodes.every((node, i) => node.getAttribute('d') === rest[i])
    // An old effect may clean up after React has already committed new paths.
    nodes[0].dataset.railRopePath = railWheel(1280, 120, unit, 5).path
    binding.reset()
    const reset = nodes.every(node => node.getAttribute('d') === node.dataset.railRopePath)
    rows.push({ skin, profile, before, calls: activeCalls, unique, exact, quiet, reset, paths: nodes.length })
  }
  return rows
}
