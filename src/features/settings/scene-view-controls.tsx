import { Button } from '@/components/ui/button'
import { Parameter } from '@/components/ui/parameter'
import { defaultSceneView, normalizeSceneView, type SceneView } from '../spectrum/three/view'

const axes = [
  { key: 'yaw', label: '左右旋转', min: -180, max: 180, step: 1, unit: '°' },
  { key: 'pitch', label: '上下旋转', min: -180, max: 180, step: 1, unit: '°' },
  { key: 'roll', label: '画面旋转', min: -180, max: 180, step: 1, unit: '°' },
  { key: 'distance', label: '前后距离', min: .25, max: 4, step: .05, unit: '×' },
  { key: 'x', label: '水平平移', min: -100, max: 100, step: 1, unit: '%' },
  { key: 'y', label: '垂直平移', min: -100, max: 100, step: 1, unit: '%' },
] as const
const presets = [
  { label: '默认朝向', yaw: 0, pitch: 0 }, { label: '左侧视角', yaw: -35, pitch: 0 },
  { label: '右侧视角', yaw: 35, pitch: 0 }, { label: '俯视角度', yaw: 0, pitch: -35 },
]

export function SceneViewControls({ view, onChange, disabled }: { view: SceneView; onChange: (view: SceneView) => void; disabled: boolean }) {
  return <section className="scene-view-controls" aria-label="三维视角">
    <div className="section-label">三维视角</div>
    <div className="scene-view-presets">{presets.map(preset => <Button key={preset.label} variant="outline" disabled={disabled}
      onClick={() => onChange({ ...view, yaw: preset.yaw, pitch: preset.pitch, roll: 0 })}>{preset.label}</Button>)}</div>
    <p className="scene-view-hint">在预览中拖动旋转，Shift＋拖动平移，滚轮缩放。</p>
    <details className="inspector-advanced"><summary>精细视角</summary>
    <div className="scene-view-axes">{axes.map(axis => <Parameter key={axis.key} label={axis.label} min={axis.min} max={axis.max} step={axis.step} unit={axis.unit} value={view[axis.key]}
      format={value => axis.key === 'distance' ? value.toFixed(2) : Math.round(value)} disabled={disabled}
      onChange={value => onChange(normalizeSceneView({ ...view, [axis.key]: value }))} />)}</div>
    <Button variant="ghost" className="reset-button" disabled={disabled} onClick={() => onChange({ ...defaultSceneView })}>恢复三维视角</Button>
    </details>
  </section>
}
