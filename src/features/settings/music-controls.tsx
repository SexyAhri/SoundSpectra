import { Slider } from '@/components/ui/slider'
import { ChoiceSelect } from '@/components/ui/choice-select'
import { Button } from '@/components/ui/button'
import type { SpectrumSettings } from '../spectrum/model'
import { defaultMusicSettings, isAmbientEffect, type MusicSettings, type MusicEffect } from '../spectrum/music-engine/catalog'

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
    { key: 'ballSpeedMultiplier', label: '弹球速度', min: .1, max: 5, step: .1, unit: '×' },
    { key: 'ballRadiusMultiplier', label: '弹球半径', min: .5, max: 2, step: .1, unit: '×' },
    { key: 'ballCount', label: '球体数量', min: 3, max: 7 },
    { key: 'ballTrail', label: '球体余迹', min: 0, max: 1, step: .05 },
  ],
  rhythm_rain: [
    { key: 'rainSpeedMultiplier', label: '落雨速度', min: .1, max: 5, step: .1, unit: '×' },
    { key: 'rainRadiusMultiplier', label: '雨滴半径', min: .5, max: 2, step: .1, unit: '×' },
    { key: 'rainCount', label: '雨幕密度', min: 5, max: 20 },
  ],
  rhythm_fluid: [
    { key: 'fluidSpeedMultiplier', label: '液面流速', min: .1, max: 5, step: .1, unit: '×' },
    { key: 'fluidCount', label: '交叠波系', min: 1, max: 3 },
    { key: 'fluidWidth', label: '浪脊幅度', min: .5, max: 2, step: .1, unit: '×' },
    { key: 'sourceFluidFadeSpeed', label: '细波消散', min: .5, max: 50, step: .5 },
  ],
  rhythm_skin: [
    { key: 'skinFlowSpeedMultiplier', label: '织物流速', min: .1, max: 10, step: .1, unit: '×' },
    { key: 'dragonWidth', label: '绸面宽度', min: .5, max: 2, step: .1, unit: '×' },
    { key: 'dragonTrail', label: '织边光泽', min: 0, max: 8 },
  ],
  spectrum_bars: [
    { key: 'spectrumTracks', label: '音轨数量', min: 12, max: 40 },
    { key: 'spectrumAmplitude', label: '频谱起伏', min: .5, max: 1.5, step: .05, unit: '×' },
    { key: 'spectrumNoteDensity', label: '音符密度', min: 0, max: 3 },
  ],
  ripple: [
    { key: 'rippleWidth', label: '雪片大小', min: .5, max: 2, step: .1, unit: '×' },
    { key: 'rippleTwist', label: '飘雪风向', min: -1.5, max: 1.5, step: .1 },
    { key: 'rippleLights', label: '飘雪密度', min: 1, max: 4 },
  ],
  pulse_ring: [
    { key: 'pulseRange', label: '光环范围', min: .5, max: 1.5, step: .1, unit: '×' },
    { key: 'pulseImpact', label: '重拍强调', min: 0, max: 2, step: .1 },
    { key: 'pulseParticles', label: '轨道粒子', min: 4, max: 16, step: 2 },
  ],
  volume_rain: [
    { key: 'meteorDensity', label: '浮游密度', min: 24, max: 96 },
    { key: 'meteorTrail', label: '羽冠舒展', min: .5, max: 2, step: .1, unit: '×' },
    { key: 'meteorAngle', label: '风向倾角', min: -45, max: 45, unit: '°' },
  ],
  dream_stars: [
    { key: 'starCount', label: '星点数量', min: 64, max: 192 },
    { key: 'starDepth', label: '星空纵深', min: .5, max: 2, step: .1, unit: '×' },
    { key: 'starTrail', label: '星点拖尾', min: 0, max: 2, step: .1, unit: '×' },
  ],
  vortex: [
    { key: 'vortexArms', label: '旋臂数量', min: 2, max: 5 },
    { key: 'vortexRange', label: '旋涡范围', min: .5, max: 1.3, step: .1, unit: '×' },
    { key: 'vortexWidth', label: '旋臂粗细', min: .5, max: 2, step: .1, unit: '×' },
  ],
  water_ripple: [
    { key: 'waterDrops', label: '水珠数量', min: 2, max: 6 },
    { key: 'waterRange', label: '水波范围', min: .5, max: 1.5, step: .1, unit: '×' },
    { key: 'waterEchoes', label: '涟漪层数', min: 1, max: 4 },
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
  const spectrum = settings.effect === 'spectrum_bars' || settings.effect === 'rhythm_bars'
  const terrain = settings.effect === 'sound_field', ambient = isAmbientEffect(settings.effect)
  const driftKey = settings.effect === 'ripple' ? 'rippleTwist' : settings.effect === 'volume_rain' ? 'meteorAngle' : null
  const driftAmount = settings.effect === 'ripple' ? 1.5 : 35
  const fields: Control[] = [
    { key: 'sensitivity', label: '音乐灵敏度', min: .5, max: 2, step: .1, unit: '×' },
    ...(ambient ? ambientControls : terrain ? controls.sound_field! : [
      ...ambientControls.slice(0, 2), ...(controls[settings.effect] ?? controls.spectrum_bars!),
    ]),
  ]
  return <div className="music-controls">
    <>
      <label className="custom-color"><span>场景氛围</span><ChoiceSelect label="场景氛围" value={settings.sceneMode} disabled={disabled} onChange={value => update({ sceneMode: value as SpectrumSettings['sceneMode'] })}
        options={[{ value: 'daily', label: '融入桌面' }, { value: 'immersive', label: '沉浸暗场' }]} /></label>
      <label className="custom-color"><span>声场配色</span><ChoiceSelect label="声场配色" value={music.fieldPalette} disabled={disabled} onChange={value => change({ fieldPalette: value as MusicSettings['fieldPalette'] })}
        options={!terrain ? [{ value: 'iris', label: '月光鸢尾' }, { value: 'ember', label: '暖金暮色' }, { value: 'lake', label: '冰川青蓝' }]
          : [{ value: 'iris', label: '冷暖地形' }, { value: 'ember', label: '落日余烬' }, { value: 'lake', label: '静湖青蓝' }]} /></label>
      {terrain && <label className="custom-color"><span>涟漪落点</span><ChoiceSelect label="涟漪落点" value={music.fieldRippleMode} disabled={disabled} onChange={value => change({ fieldRippleMode: value as MusicSettings['fieldRippleMode'] })}
        options={[{ value: 'rain', label: '分散落点' }, { value: 'center', label: '中心回响' }]} /></label>}
    </>
    <>
      <label className="custom-color"><span>{spectrum ? '回落速度' : '运动速度'}</span><ChoiceSelect label={spectrum ? '回落速度' : '运动速度'} value={String(music.speed)} disabled={disabled}
        onChange={value => change({ speed: Number(value) })} options={['很慢', '慢速', '中速', '快速', '很快'].map((label, value) => ({ value: String(value), label }))} /></label>
      <label className="custom-color"><span>音乐响应</span><ChoiceSelect label="音乐响应" value={music.response} disabled={disabled}
        onChange={value => change({ response: value as MusicSettings['response'] })} options={[{ value: 'soft', label: '柔和' }, { value: 'balanced', label: '均衡' }, { value: 'responsive', label: '灵敏' }]} /></label>
    </>
    {settings.effect === 'rhythm_rain' && <label className="custom-color"><span>落雨方向</span><ChoiceSelect label="落雨方向" value={music.rainDirection} disabled={disabled} onChange={value => change({ rainDirection: value as MusicSettings['rainDirection'] })}
      options={[{ value:'left',label:'向左' },{ value:'down',label:'垂直' },{ value:'right',label:'向右' }]} /></label>}
    {driftKey && <section aria-label="飘动方向">
      <div className="section-label">飘动方向</div>
      <div className="motion-directions">{[{ label: '向左飘', value: -driftAmount }, { label: '垂直飘动', value: 0 }, { label: '向右飘', value: driftAmount }].map(option =>
        <Button key={option.label} variant="outline" disabled={disabled} aria-pressed={music[driftKey] === option.value}
          onClick={() => change({ [driftKey]: option.value })}>{option.label}</Button>)}</div>
      <p className="scene-view-hint">以默认视角为准，负值向左、正值向右；垂直时保留自然轻摆。</p>
    </section>}
    {fields.map(({ key, label, min, max, step = 1, unit = '' }) => <div className="parameter" key={key}>
      <div className="parameter-label"><span>{label}</span><output>{Number(music[key].toFixed(step < .1 ? 2 : step < 1 ? 1 : 0))}{unit}</output></div>
      <Slider aria-label={label} value={[music[key]]} min={min} max={max} step={step} disabled={disabled} onValueChange={([value]) => change({ [key]: value })} />
    </div>)}
    <Button variant="ghost" className="reset-button" disabled={disabled} onClick={() => {
      const keys = [...fields.map(field => field.key), ...['speed', 'response', 'fieldPalette'] as const, ...(terrain ? ['fieldRippleMode'] as const : []), ...(settings.effect==='rhythm_rain'?['rainDirection'] as const:[])]
      change(Object.fromEntries(keys.map(key => [key, defaultMusicSettings[key]])))
    }}>恢复当前灯效参数</Button>
  </div>
}
