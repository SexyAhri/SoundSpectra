import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DrawerHost } from '../../src/components/ui/drawer'
import { EffectPanel } from '../../src/features/settings/effect-panel'
import { CardControls } from '../../src/features/desktop-card/card-controls'
import { LyricControls } from '../../src/features/lyrics/lyric-controls'
import { WallpaperDepthControls } from '../../src/features/wallpaper-depth/wallpaper-depth-controls'
import { RailSkinPicker } from '../../src/features/rail/rail-skin-picker'
import { defaults } from '../../src/features/spectrum/model'
import { emptyLyrics } from '../../src/features/lyrics/model'
import '../../src/index.css'
import '../../src/features/rail/rail.css'

const probe = { reads: 0 }
Object.assign(window, { drawerWork: probe })
const bounds = Element.prototype.getBoundingClientRect
Element.prototype.getBoundingClientRect = function () {
  if (this.classList.contains('drawer-work-host') || this.classList.contains('workspace-inspector-container')) probe.reads++
  return bounds.call(this)
}
function Fixture() {
  const [panel, setPanel] = useState('scene')
  const [settings, setSettings] = useState(structuredClone(defaults))
  const update = (patch: any) => setSettings(current => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }))
  return <><nav>{['scene', 'card', 'lyrics', 'wallpaper', 'rail'].map(name => <button key={name} onClick={() => setPanel(name)}>{name}</button>)}</nav>
    <DrawerHost scope={panel} className="drawer-work-host" style={{ width: 900, height: 650, display: 'flex' }}>
      <div className="workspace-inspector-container" style={{ width: 380, height: 600, overflow: 'auto' }}>
        {panel === 'scene' && <EffectPanel settings={settings} update={update} disabled={false} positionDisabled={false} scope="primary" />}
        {panel === 'card' && <CardControls settings={settings} update={update} disabled={false} />}
        {panel === 'lyrics' && <LyricControls settings={settings} update={update} document={emptyLyrics} tab="effect" onTabChange={() => {}} disabled={false} />}
        {panel === 'wallpaper' && <WallpaperDepthControls settings={settings.wallpaperDepth} onChange={wallpaperDepth => update({ wallpaperDepth })} disabled={false} />}
        {panel === 'rail' && <RailSkinPicker value="floral" onChange={() => {}} />}
      </div>
    </DrawerHost>
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
