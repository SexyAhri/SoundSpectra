import { useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { ThreeSceneCanvas } from '../../src/features/spectrum/three/scene-canvas'
import { defaults } from '../../src/features/spectrum/model'

let suspended = false
const settings = { ...structuredClone(defaults), effect: 'aurora_flow' as const, quality: 'eco' as const }
const root = createRoot(document.getElementById('root')!)
Object.assign(window, { canvasWork: { suspend(value: boolean) { suspended = value; render() } } })
function Probe() {
  const bands = useRef(new Float32Array(96)), receivedAt = useRef(0)
  return <ThreeSceneCanvas settings={settings} bands={bands} receivedAt={receivedAt} demo suspended={suspended} />
}
function render() { flushSync(() => root.render(<Probe />)) }
render()
