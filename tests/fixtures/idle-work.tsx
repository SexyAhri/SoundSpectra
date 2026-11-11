import { useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { LiveMeter } from '../../src/features/desktop-card/live-meter'
import { usePanelMemory } from '../../src/features/settings/use-panel-memory'
import { ShowPreview } from '../../src/features/performance/preview'
import { exampleShow } from '../../src/features/performance/model'
import '../../src/index.css'

const mode = new URLSearchParams(location.search).get('mode')
const root = createRoot(document.getElementById('root')!)
const bands = { current: new Float32Array(96) }, receivedAt = { current: 0 }
let scope = 'first', mounted = true, hidden = false
let show = exampleShow(), selectedCue = show.cues[0]
const probe = {
  frames: 0, writes: 0, scans: 0,
  sound() { bands.current.fill(.8); receivedAt.current = performance.now() },
  hidden(value: boolean) { hidden = value; document.dispatchEvent(new Event('visibilitychange')) },
  scope(value: string) { scope = value; render() },
  mount(value: boolean) { mounted = value; render() },
  cue(timeMs: number) {
    selectedCue = { ...selectedCue, timeMs }
    show = { ...show, cues: show.cues.map(cue => cue.id === selectedCue.id ? selectedCue : cue) }
    render()
  },
  duration(timeMs: number) {
    show = { ...show, cues: show.cues.map((cue, i) => i === show.cues.length - 1 ? { ...cue, timeMs } : cue) }
    render()
  },
}
Object.assign(window, { idleWork: probe })
Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
const request = window.requestAnimationFrame.bind(window)
window.requestAnimationFrame = callback => request(now => { probe.frames++; callback(now) })
const write = Storage.prototype.setItem
Storage.prototype.setItem = function (key, value) {
  if (key.startsWith('soundspectra.panel-memory.')) probe.writes++
  write.call(this, key, value)
}
const query = Element.prototype.querySelectorAll
Element.prototype.querySelectorAll = function (selector: string) {
  if (this.id === 'memory-root') probe.scans++
  return query.call(this, selector)
} as typeof query

function Memory() {
  const host = useRef<HTMLDivElement>(null)
  usePanelMemory(host, scope)
  return <div ref={host} id="memory-root">
    <div className="inspector-scroll" style={{ height: 100, overflow: 'auto' }}>
      <details><summary>{scope}</summary><div style={{ height: 240 }}>Expanded controls</div></details>
      <div style={{ height: 600 }}>Scrollable controls</div>
    </div>
  </div>
}
function render() {
  flushSync(() => root.render(!mounted ? null : mode === 'memory' ? <Memory /> :
    mode === 'rehearsal' ? <ShowPreview show={show} selectedCue={selectedCue} /> :
    <div id="meter-host"><LiveMeter bands={bands} receivedAt={receivedAt} /></div>))
}
render()
