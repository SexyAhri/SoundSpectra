import { Parameter } from '@/components/ui/parameter'
import { ChoiceSelect } from '@/components/ui/choice-select'
import { Button } from '@/components/ui/button'
import type { SpectrumSettings } from '../spectrum/model'
import { isAmbientEffect, type MusicSettings, type MusicEffect } from '../spectrum/music-engine/catalog'
import { effectPalettes, neutralEffectColor, type PaletteId } from '../spectrum/effect-palette'
import { recommendedMusic } from '../spectrum/effect-presets'

type NumericKey = Exclude<keyof MusicSettings, 'response' | 'rainDirection' | 'fieldPalette' | 'fieldRippleMode'>
type Control = { key: NumericKey; label: string; min: number; max: number; step?: number; unit?: string }
const controls: Partial<Record<MusicEffect, Control[]>> = {
  sound_field: [
    { key: 'fieldScale', label: '声场铺满', min: .8, max: 2, step: .05, unit: '×' },
    { key: 'fieldHeight', label: '地形高度', min: .3, max: 2, step: .1, unit: '×' },
    { key: 'fieldBrightness', label: '声场亮度', min: 15, max: 90, unit: '%' },
    { key: 'fieldSpread', label: '扩散范围', min: .5, max: 1.8, step: .1, unit: '×' },
    { key: 'fieldDrops', label: '雨落密度', min: 1, max: 8 },
  ],
  rhythm_balls: [
    { key: 'driftSpeed', label: '漂游速度', min: .1, max: 5, step: .1, unit: '×' },
    { key: 'jellySize', label: '伞体大小', min: 1.2, max: 4.8, step: .1 },
    { key: 'jellyCount', label: '水母数量', min: 3, max: 7 },
    { key: 'tentacleLength', label: '触须舒展', min: 0, max: 1, step: .05 },
  ],
  rhythm_rain: [
    { key: 'rainSpeedMultiplier', label: '落雨速度', min: .1, max: 5, step: .1, unit: '×' },
    { key: 'rainRadiusMultiplier', label: '雨滴半径', min: .5, max: 2, step: .1, unit: '×' },
    { key: 'rainCount', label: '雨幕密度', min: 5, max: 20 },
  ],
  rhythm_skin: [
    { key: 'skinFlowSpeedMultiplier', label: '织物流速', min: .1, max: 10, step: .1, unit: '×' },
    { key: 'dragonWidth', label: '绸面宽度', min: .5, max: 2, step: .1, unit: '×' },
    { key: 'dragonTrail', label: '织边光泽', min: 0, max: 8 },
  ],
  ripple: [
    { key: 'rippleWidth', label: '雪片大小', min: .5, max: 2, step: .1, unit: '×' },
    { key: 'rippleTwist', label: '飘雪风向', min: -1.5, max: 1.5, step: .1 },
    { key: 'rippleLights', label: '飘雪密度', min: 1, max: 4 },
  ],
  volume_rain: [
    { key: 'meteorDensity', label: '浮游密度', min: 24, max: 96 },
    { key: 'meteorTrail', label: '羽冠舒展', min: .5, max: 2, step: .1, unit: '×' },
    { key: 'meteorAngle', label: '风向倾角', min: -45, max: 45, unit: '°' },
  ],
  dream_stars: [
    { key: 'starDensity', label: '星河密度', min: 1200, max: 6000, step: 100 },
    { key: 'nebulaScale', label: '星云尺度', min: .5, max: 2, step: .1 },
    { key: 'dustOpacity', label: '尘埃浓度', min: 0, max: 1, step: .05 },
    { key: 'spinSpeed', label: '星云流速', min: 0, max: 2, step: .1 },
  ],
  vortex: [
    { key: 'vortexArms', label: '旋臂数量', min: 2, max: 5 },
    { key: 'vortexRange', label: '旋涡范围', min: .5, max: 1.3, step: .1, unit: '×' },
    { key: 'vortexWidth', label: '旋臂粗细', min: .5, max: 2, step: .1, unit: '×' },
  ],
}
const ambientControls: Control[] = [
  { key: 'fieldScale', label: '场景尺度', min: .8, max: 2, step: .05, unit: '×' },
  { key: 'fieldBrightness', label: '光感亮度', min: 15, max: 90, unit: '%' },
  { key: 'ambientDensity', label: '细节密度', min: .5, max: 2, step: .1, unit: '×' },
  { key: 'ambientSpread', label: '空间展开', min: .6, max: 1.8, step: .1, unit: '×' },
]

export function MusicControls({ settings, update, disabled }: {
  settings: SpectrumSettings; update: (patch: Partial<SpectrumSettings>) => void; disabled: boolean
}) {
  const music = settings.music
  const change = (patch: Partial<MusicSettings>) => update({ music: { ...music, ...patch } })
  const terrain = settings.effect === 'sound_field', ambient = isAmbientEffect(settings.effect)
  const luminous = ['rhythm_balls','dream_stars'].includes(settings.effect)
  const fields: Control[] = [
    ...(!luminous ? [{ key: 'sensitivity', label: '音乐灵敏度', min: .5, max: 2, step: .1, unit: '×' } as Control] : []),
    ...(ambient ? ambientControls : terrain ? controls.sound_field! : [
      ...ambientControls.slice(0, 2), ...(controls[settings.effect] ?? []),
    ]),
  ]
  return <div className="music-controls">
    <>
      <label className="custom-color"><span>场景氛围</span><ChoiceSelect label="场景氛围" value={settings.sceneMode} disabled={disabled} onChange={value => update({ sceneMode: value as SpectrumSettings['sceneMode'] })}
        options={[{ value: 'daily', label: '融入桌面' }, { value: 'immersive', label: '沉浸暗场' }]} /></label>
      <label className="custom-color"><span>灯效配色</span><ChoiceSelect label="声场配色" value={music.fieldPalette} disabled={disabled} onChange={value => update({ music: { ...music, fieldPalette: value as PaletteId }, color: neutralEffectColor, followCover: false })}
        options={(['iris', 'ember', 'lake'] as const).map(value => { const palette = effectPalettes[settings.effect][value]; return { value, label: palette.name, swatches: [palette.main, palette.accent, palette.high] } })} /></label>
      {terrain && <label className="custom-color"><span>涟漪落点</span><ChoiceSelect label="涟漪落点" value={music.fieldRippleMode} disabled={disabled} onChange={value => change({ fieldRippleMode: value as MusicSettings['fieldRippleMode'] })}
        options={[{ value: 'rain', label: '分散落点' }, { value: 'center', label: '中心回响' }]} /></label>}
    </>
    <>
      {!luminous && <label className="custom-color"><span>运动速度</span><ChoiceSelect label="运动速度" value={String(music.speed)} disabled={disabled}
        onChange={value => change({ speed: Number(value) })} options={['很慢', '慢速', '中速', '快速', '很快'].map((label, value) => ({ value: String(value), label }))} /></label>}
      <label className="custom-color"><span>音乐响应</span><ChoiceSelect label="音乐响应" value={music.response} disabled={disabled}
        onChange={value => change({ response: value as MusicSettings['response'] })} options={[{ value: 'soft', label: '柔和' }, { value: 'balanced', label: '均衡' }, { value: 'responsive', label: '灵敏' }]} /></label>
    </>
    {settings.effect === 'rhythm_rain' && <label className="custom-color"><span>落雨方向</span><ChoiceSelect label="落雨方向" value={music.rainDirection} disabled={disabled} onChange={value => change({ rainDirection: value as MusicSettings['rainDirection'] })}
      options={[{ value:'left',label:'向左' },{ value:'down',label:'垂直' },{ value:'right',label:'向右' }]} /></label>}
    {fields.map(({ key, label, min, max, step = 1, unit = '' }) => <Parameter key={key} label={label} value={music[key]} min={min} max={max} step={step} unit={unit}
      format={value => Number(value.toFixed(step < .1 ? 2 : step < 1 ? 1 : 0))} disabled={disabled} onChange={value => change({ [key]: value })} />)}
    <Button variant="ghost" className="reset-button" disabled={disabled} onClick={() => {
      const keys = [...fields.map(field => field.key), ...['speed', 'response', 'fieldPalette'] as const, ...(terrain ? ['fieldRippleMode'] as const : []), ...(settings.effect==='rhythm_rain'?['rainDirection'] as const:[])]
      const recommended = recommendedMusic(settings.effect)
      update({ music: { ...music, ...Object.fromEntries(keys.map(key => [key, recommended[key]])) }, color: neutralEffectColor, followCover: false })
    }}>恢复当前灯效参数</Button>
  </div>
}
