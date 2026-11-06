import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { defaults, type SpectrumSettings } from '../../src/features/spectrum/model'
import { emptyNowPlaying, type NowPlaying } from '../../src/features/desktop-card/use-now-playing'
import { useCoverColors } from '../../src/features/desktop-card/use-cover-colors'
import { CoverColorControl } from '../../src/features/desktop-card/cover-color-control'

export function mountCoverProbe() {
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node)
  let change: (patch: Partial<NowPlaying>) => void
  function Probe() {
    const [settings, setSettings] = useState<SpectrumSettings>({ ...structuredClone(defaults), followCover: true })
    const [info, setInfo] = useState({ ...emptyNowPlaying, playing: true })
    change = patch => setInfo(value => ({ ...value, ...patch }))
    const color = useCoverColors(settings, info, true)
    return <div id="cover-probe">
      <output>{JSON.stringify({ color: color.settings.color, stored: settings.color, following: settings.followCover, available: color.available })}</output>
      <CoverColorControl settings={settings} display={color.settings} message={color.message} available={color.available} disabled={false}
        update={patch => setSettings(current => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }))} />
    </div>
  }
  root.render(<Probe />)
  return { change: (patch: Partial<NowPlaying>) => change(patch), unmount: () => root.unmount() }
}
