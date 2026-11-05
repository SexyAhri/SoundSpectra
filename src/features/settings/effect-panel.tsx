import { Button } from '@/components/ui/button'
import type { SpectrumSettings } from '../spectrum/model'
import { musicEffects, isClassicEffect } from '../spectrum/music-engine/catalog'
import { EffectArtwork, effectCatalog } from './effect-artwork'
import { Focus, Monitor, PanelBottom } from 'lucide-react'
import { defaultSceneView } from '../spectrum/three/view'

export function EffectPanel({ settings, update, disabled, positionDisabled }: { settings: SpectrumSettings; update: (patch: Partial<SpectrumSettings>) => void; disabled: boolean; positionDisabled: boolean }) {
  const fillScreen = () => update({sceneMode:'immersive',opacity:100,view:{...defaultSceneView},bounds:{x:0,y:0,width:1,height:1},music:{...settings.music,fieldScale:1.35}})
  return <div className="inspector-content effect-panel">
    <section className="immersive-presets" aria-label="全屏沉浸场景">
      <Button className="immersive-current" variant="outline" disabled={disabled || positionDisabled} onClick={fillScreen}><Monitor size={14} />全屏展示当前灯效</Button>
    </section>
    <div className="desktop-layout-choices" role="group" aria-label="桌面灯效布局">
      <Button variant="outline" disabled={disabled || positionDisabled} aria-label="应用桌面全景布局" onClick={fillScreen}><Monitor size={13} /><span>全景氛围</span></Button>
      <Button variant="outline" disabled={disabled || positionDisabled} aria-label="应用底部灯带布局" onClick={() => update({ bounds: { x: .04, y: .66, width: .92, height: .30 } })}><PanelBottom size={13} /><span>底部灯带</span></Button>
      <Button variant="outline" disabled={disabled || positionDisabled} aria-label="应用居中聚光布局" onClick={() => update({ bounds: { x: .18, y: .15, width: .64, height: .7 } })}><Focus size={13} /><span>居中聚光</span></Button>
    </div>
    {[{ label: '三维声场', effects: musicEffects.filter(effect => !isClassicEffect(effect.value)) }, { label: '音乐律动', effects: musicEffects.slice(0, 4).filter(effect => effect.value !== 'rhythm_fluid') }, { label: '场景动效', effects: musicEffects.slice(4, 12).filter(effect => effect.value !== 'water_ripple' && effect.value !== 'rhythm_bars') }].map(group => <section className="effect-category" key={group.label}>
      <div className="section-label">{group.label}<small>{String(group.effects.length).padStart(2, '0')}</small></div>
      <div className="effect-options" role="group" aria-label={group.label === '音乐律动' ? '参考音乐动效' : group.label === '三维声场' ? '三维声场' : '动效样式'}>
        {group.effects.map(effect => <Button key={effect.value} variant="outline" aria-label={effect.label} className="effect-tile" aria-pressed={settings.effect === effect.value} disabled={disabled} onClick={() => update({ effect: effect.value, ...(!isClassicEffect(effect.value) && isClassicEffect(settings.effect) && !positionDisabled ? { bounds: { x: 0, y: 0, width: 1, height: 1 } } : {}) })}><EffectArtwork effect={effect.value} /><span className="effect-tile-caption"><span>{effect.label}</span><small>{effectCatalog[effect.value].caption}</small></span></Button>)}
      </div>
    </section>)}
  </div>
}
