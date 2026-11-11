import { Profiler } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { useCoverColors } from '../../src/features/desktop-card/use-cover-colors'
import { defaults, type SpectrumSettings } from '../../src/features/spectrum/model'
import { regionStyle } from '../../src/features/spectrum/regions'
import { emptyNowPlaying } from '../../src/features/desktop-card/use-now-playing'

let settings: SpectrumSettings = { ...structuredClone(defaults), color: '#556677', followCover: false,
  regions: [{ ...regionStyle(defaults), id: 'secondary', name: 'Second', visible: true, color: '#667788' }] }
let active = true
let current: { primary: string; regions: { id: string; color: string }[] }
const root = createRoot(document.getElementById('root')!)
const probe = {
  samples: [] as typeof current[],
  active(value: boolean) { active = value; render() },
  configure(patch: Partial<SpectrumSettings>) { settings = { ...settings, ...patch }; render() },
  region(id: string, color: string) {
    settings = { ...settings, regions: [{ ...regionStyle(defaults), id, name: id, visible: true, color }] }
    render()
  },
}
Object.assign(window, { paletteWork: probe })
function Probe() {
  const value = useCoverColors(settings, emptyNowPlaying, active)
  current = { primary: value.settings.color, regions: value.settings.regions.map(({ id, color }) => ({ id, color })) }
  return <output>{JSON.stringify(current)}</output>
}
function render() {
  flushSync(() => root.render(<Profiler id="palette" onRender={() => probe.samples.push(current)}><Probe /></Profiler>))
}
render()
