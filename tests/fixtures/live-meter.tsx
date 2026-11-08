import { createRoot } from 'react-dom/client'
import { LiveMeter } from '../../src/features/desktop-card/live-meter'

const app = window as any
const bands = { current: new Float32Array(96) }, receivedAt = { current: 0 }
app.sound = () => { bands.current.fill(.8); receivedAt.current = performance.now() }
app.meterWrites = 0; app.meterFrames = 0
const host = document.getElementById('root')!
new MutationObserver(records => { app.meterWrites += records.length }).observe(host, { attributes: true, subtree: true })
const request = window.requestAnimationFrame.bind(window)
window.requestAnimationFrame = callback => request(now => { app.meterFrames++; callback(now) })
createRoot(host).render(<LiveMeter bands={bands} receivedAt={receivedAt} />)
