import { Parameter } from '@/components/ui/parameter'
import { ChoiceSelect } from '@/components/ui/choice-select'
import { Button } from '@/components/ui/button'
import type { SpectrumSettings } from '../spectrum/model'
import { type MusicSettings } from '../spectrum/music-engine/catalog'
import { effectPalettes, neutralEffectColor, type PaletteId } from '../spectrum/effect-palette'
import { recommendedMusic } from '../spectrum/effect-presets'
import { effectDefinitions, applyArt, artValue } from '../spectrum/effect-definitions'
import './creative-controls.css'

export function MusicControls({ settings, update, disabled }: {
  settings: SpectrumSettings; update: (patch: Partial<SpectrumSettings>) => void; disabled: boolean
}) {
  const music = settings.music
  const change = (patch: Partial<MusicSettings>) => update({ music: { ...music, ...patch } })
  const terrain = settings.effect === 'sound_field', definition = effectDefinitions[settings.effect]
  const fields = definition.controls
  const automatic = new Set(['speed','response','sensitivity','driftSpeed','rainSpeedMultiplier','skinFlowSpeedMultiplier','spinSpeed','fieldDrops'])
  const shapeFields=fields.filter(field=>!automatic.has(field.key)&&!['fieldScale','fieldBrightness'].includes(field.key))
  return <div className="music-controls">
    <>
      <label className="custom-color"><span>场景氛围</span><ChoiceSelect label="场景氛围" value={settings.sceneMode} disabled={disabled} onChange={value => update({ sceneMode: value as SpectrumSettings['sceneMode'] })}
        options={[{ value: 'daily', label: '融入桌面' }, { value: 'immersive', label: '沉浸暗场' }]} /></label>
      <label className="custom-color"><span>灯效配色</span><ChoiceSelect label="声场配色" value={music.fieldPalette} disabled={disabled} onChange={value => update({ music: { ...music, fieldPalette: value as PaletteId }, color: neutralEffectColor, followCover: false })}
        options={(['iris', 'ember', 'lake'] as const).map(value => { const palette = effectPalettes[settings.effect][value]; return { value, label: palette.name, swatches: [palette.main, palette.accent, palette.high] } })} /></label>
    </>

    <p className="creative-rule">速度与活跃程度随音乐变化，节拍带出局部回应。{definition.rules[1]}。</p>
    {definition.art.filter(control=>control.id!=='mood').map(control => <div className="art-control" key={control.id}>
      <Parameter label={control.label} value={artValue(control,music)} min={0} max={100} disabled={disabled}
        onChange={value => update({music:applyArt(control,value,music)})}/>
      <small>{control.hint}</small>
    </div>)}
      <details className="creative-details" key={settings.effect}><summary>造型细节</summary>
      {terrain && <label className="custom-color"><span>涟漪落点</span><ChoiceSelect label="涟漪落点" value={music.fieldRippleMode} disabled={disabled} onChange={value => change({ fieldRippleMode: value as MusicSettings['fieldRippleMode'] })}
        options={[{ value: 'rain', label: '分散落点' }, { value: 'center', label: '中心回响' }]} /></label>}
    {settings.effect === 'rhythm_rain' && <label className="custom-color"><span>落雨方向</span><ChoiceSelect label="落雨方向" value={music.rainDirection} disabled={disabled} onChange={value => change({ rainDirection: value as MusicSettings['rainDirection'] })}
      options={[{ value:'left',label:'向左' },{ value:'down',label:'垂直' },{ value:'right',label:'向右' }]} /></label>}
    {shapeFields.map(({ key, label, min, max, step = 1, unit = '' }) => <Parameter key={key} label={label} value={music[key]} min={min} max={max} step={step} unit={unit}
      format={value => Number(value.toFixed(step < .1 ? 2 : step < 1 ? 1 : 0))} disabled={disabled} onChange={value => change({ [key]: value })} />)}
    </details>
    <Button variant="ghost" className="reset-button" disabled={disabled} onClick={() => {
      const keys = [...new Set([...fields.map(field => field.key), ...definition.art.flatMap(control => control.channels.map(([key]) => key))]), ...['speed', 'response', 'fieldPalette'] as const, ...(terrain ? ['fieldRippleMode'] as const : []), ...(settings.effect==='rhythm_rain'?['rainDirection'] as const:[])]
      const recommended = recommendedMusic(settings.effect)
      update({ music: { ...music, ...Object.fromEntries(keys.map(key => [key, recommended[key]])) }, color: neutralEffectColor, followCover: false })
    }}>恢复当前灯效参数</Button>
  </div>
}
