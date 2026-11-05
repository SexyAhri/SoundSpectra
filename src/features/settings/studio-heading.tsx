import type { RefObject } from 'react'
import { AudioLines, Layers3 } from 'lucide-react'
import type { SpectrumSettings } from '../spectrum/model'
import { LiveMeter } from '../desktop-card/live-meter'
import { effectCatalog } from './effect-artwork'
import { sceneRegions } from '../spectrum/regions'

export function StudioHeading({ settings, bands, receivedAt, demo, active }: { settings: SpectrumSettings; bands: RefObject<Float32Array>; receivedAt: RefObject<number>; demo: boolean; active: boolean }) {
  const effect = effectCatalog[settings.effect]
  return <div className="studio-heading">
    <div><div className="studio-eyebrow"><span />SOUND IN MOTION</div><h2>场景工作台<span className="studio-heading-period">.</span></h2></div>
    <div className="studio-session"><div className="studio-session-caption"><AudioLines size={13} /><span>{effect.label}</span><span className="studio-session-count"><Layers3 size={12} />{sceneRegions(settings).filter(r => r.visible).length}</span></div><LiveMeter bands={bands} receivedAt={receivedAt} demo={demo} active={active} /></div>
  </div>
}
