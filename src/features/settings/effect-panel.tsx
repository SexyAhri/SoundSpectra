import type { SpectrumSettings } from '../spectrum/model'
import { effectGroups } from '../spectrum/effect-presets'
import { selectEffect } from './effect-memory'
import { EffectArtwork, effectCatalog } from './effect-artwork'
import { Monitor } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { StylePicker } from '@/components/ui/style-picker'
import { defaultSceneView } from '../spectrum/three/view'

export function EffectPanel({ settings, update, disabled, positionDisabled, scope }: {
  settings: SpectrumSettings; update: (patch: Partial<SpectrumSettings>) => void;
  disabled: boolean; positionDisabled: boolean; scope: string;
}) {
  return <div className="effect-panel">
    <StylePicker key={scope} label="灯效" value={settings.effect} disabled={disabled}
      options={effectGroups.flatMap(group => group.effects.map(value => ({ value, label: effectCatalog[value].label,
        detail: effectCatalog[value].caption, group: group.label, preview: <EffectArtwork effect={value} /> })))}
      onChange={value => update(selectEffect(settings, value as SpectrumSettings['effect'], scope))}
      actions={<IconButton aria-label="全屏展示当前灯效" title="全屏展示当前灯效" disabled={disabled || positionDisabled}
        onClick={() => update({ sceneMode: 'immersive', opacity: 100, view: { ...defaultSceneView }, bounds: { x: 0, y: 0, width: 1, height: 1 }, music: { ...settings.music, fieldScale: 1.35 } })}><Monitor size={15} /></IconButton>} />
  </div>
}
