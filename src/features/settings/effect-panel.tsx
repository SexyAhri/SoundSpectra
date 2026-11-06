import { Button } from '@/components/ui/button'
import type { SpectrumSettings } from '../spectrum/model'
import { musicEffects } from '../spectrum/music-engine/catalog'
import { effectGroups } from '../spectrum/effect-presets'
import { selectEffect } from './effect-memory'
import { EffectArtwork, effectCatalog } from './effect-artwork'
import { Monitor } from 'lucide-react'
import { defaultSceneView } from '../spectrum/three/view'

export function EffectPanel({ settings, update, disabled, positionDisabled, scope }: { settings: SpectrumSettings; update: (patch: Partial<SpectrumSettings>) => void; disabled: boolean; positionDisabled: boolean; scope: string }) {
  const fillScreen = () => update({sceneMode:'immersive',opacity:100,view:{...defaultSceneView},bounds:{x:0,y:0,width:1,height:1},music:{...settings.music,fieldScale:1.35}})
  return <div className="inspector-content effect-panel">
    <section className="immersive-presets" aria-label="全屏沉浸场景">
      <Button className="immersive-current" variant="outline" disabled={disabled || positionDisabled} onClick={fillScreen}><Monitor size={14} />全屏展示当前灯效</Button>
    </section>
    {effectGroups.map(group => <section className="effect-category" key={group.label}>
      <div className="section-label">{group.label}<small>{String(group.effects.length).padStart(2, '0')}</small></div>
      <div className="effect-options" role="group" aria-label={group.label}>
        {group.effects.map(id => { const effect = musicEffects.find(item => item.value === id)!; return <Button key={effect.value} variant="outline" aria-label={effect.label} className="effect-tile" aria-pressed={settings.effect === effect.value} disabled={disabled} onClick={() => update(selectEffect(settings, effect.value, scope))}><EffectArtwork effect={effect.value} /><span className="effect-tile-caption"><span>{effect.label}</span><small>{effectCatalog[effect.value].caption}</small></span></Button> })}
      </div>
    </section>)}
  </div>
}
