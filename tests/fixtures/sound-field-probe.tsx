import { createRoot } from 'react-dom/client'
import { SpectrumCanvas } from '../../src/features/spectrum/spectrum-canvas'
import { defaults, type SpectrumSettings } from '../../src/features/spectrum/model'
import { silentAnalysis, type MusicAnalysis } from '../../src/features/spectrum/music-analysis'

/** Exercises the live analysis subscription boundary without pretending to capture audio. */
export function mountSoundFieldProbe(patch: Partial<SpectrumSettings> = {}) {
  document.querySelector<HTMLElement>('.app-shell')!.style.display = 'none'
  const host = document.createElement('div'); host.id = 'sound-field-probe'
  host.style.cssText = 'width:640px;height:360px;background:#11151b'
  document.body.append(host)
  const root = createRoot(host), analysis = { current: { ...silentAnalysis(), receivedAt: 0 } }
  const bands = { current: new Float32Array(96) }, receivedAt = { current: 0 }
  let active = true
  const render = () => root.render(<SpectrumCanvas settings={{ ...defaults, effect: 'sound_field', bounds: { x: 0, y: 0, width: 1, height: 1 }, ...patch }}
    analysis={analysis} bands={bands} receivedAt={receivedAt} demo={false} active={active} />)
  render()
  return {
    push(audio: MusicAnalysis) { analysis.current = { ...audio, receivedAt: performance.now() } },
    active(value: boolean) { active = value; render() },
    dispose() { root.unmount(); host.remove() },
  }
}
