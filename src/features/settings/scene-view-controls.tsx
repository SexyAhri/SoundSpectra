import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { ChoiceSelect } from '@/components/ui/choice-select'
import { Parameter } from '@/components/ui/parameter'
import { defaultSceneView, normalizeSceneView, rotateSceneView, type SceneView } from '../spectrum/three/view'

const axes = [
  { key: 'yaw', label: '左右旋转', min: -180, max: 180, step: 1, unit: '°' },
  { key: 'pitch', label: '上下旋转', min: -180, max: 180, step: 1, unit: '°' },
  { key: 'roll', label: '画面旋转', min: -180, max: 180, step: 1, unit: '°' },
  { key: 'distance', label: '前后距离', min: .25, max: 4, step: .05, unit: '×' },
  { key: 'x', label: '水平平移', min: -100, max: 100, step: 1, unit: '%' },
  { key: 'y', label: '垂直平移', min: -100, max: 100, step: 1, unit: '%' },
] as const
const turns = [
  { label: '向左转', yaw: -1, pitch: 0, roll: 0 }, { label: '向右转', yaw: 1, pitch: 0, roll: 0 },
  { label: '向上转', yaw: 0, pitch: -1, roll: 0 }, { label: '向下转', yaw: 0, pitch: 1, roll: 0 },
  { label: '逆时针转', yaw: 0, pitch: 0, roll: -1 }, { label: '顺时针转', yaw: 0, pitch: 0, roll: 1 },
]
const presets = [
  { label: '默认朝向', yaw: 0, pitch: 0 }, { label: '左侧视角', yaw: -35, pitch: 0 },
  { label: '右侧视角', yaw: 35, pitch: 0 }, { label: '俯视角度', yaw: 0, pitch: -35 },
]

export function SceneViewControls({ view, onChange, disabled }: { view: SceneView; onChange: (view: SceneView) => void; disabled: boolean }) {
  const [step, setStep] = useState(5)
  return <section className="scene-view-controls" aria-label="三维视角">
    <div className="section-label">三维视角</div>
    <div className="scene-view-presets">{presets.map(preset => <Button key={preset.label} variant="outline" disabled={disabled}
      onClick={() => onChange({ ...view, yaw: preset.yaw, pitch: preset.pitch, roll: 0 })}>{preset.label}</Button>)}</div>
    <label className="custom-color"><span>每次转动</span><ChoiceSelect label="每次转动" value={String(step)} disabled={disabled}
      onChange={value => setStep(Number(value))} options={[1, 5, 15, 45, 90].map(value => ({ value: String(value), label: `${value}°` }))} /></label>
    <div className="scene-view-turns">{turns.map(turn => <Button key={turn.label} variant="outline" disabled={disabled}
      onClick={() => onChange(rotateSceneView(view, turn.yaw * step, turn.pitch * step, turn.roll * step))}>{turn.label}</Button>)}</div>
    <div className="scene-view-axes">{axes.map(axis => <Parameter key={axis.key} label={axis.label} min={axis.min} max={axis.max} step={axis.step} unit={axis.unit} value={view[axis.key]}
      format={value => axis.key === 'distance' ? value.toFixed(2) : Math.round(value)} disabled={disabled}
      onChange={value => onChange(normalizeSceneView({ ...view, [axis.key]: value }))} />)}</div>
    <p className="scene-view-hint">拖动旋转 · Ctrl＋拖动精调 · Shift＋拖动平移 · 滚轮前后 · Alt＋拖动画面旋转。方向键微调，Home 恢复视角。</p>
    <Button variant="ghost" className="reset-button" disabled={disabled} onClick={() => onChange({ ...defaultSceneView })}>恢复三维视角</Button>
  </section>
}
