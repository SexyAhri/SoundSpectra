import { useState } from 'react'
import { ChoiceSelect } from '@/components/ui/choice-select'
import { Parameter } from '@/components/ui/parameter'
import type { SpectrumSettings } from '../spectrum/model'
import { mappingCapabilities, originalMapping, type Mapping } from './model'
import { savePerformance, usePerformanceConfig } from './runtime'
import './performance.css'

export function MappingControls({ settings, region, disabled }: {
  settings: SpectrumSettings; region: string; disabled: boolean;
}) {
  const config = usePerformanceConfig()
  const [error, setError] = useState('')
  const capabilities = mappingCapabilities[settings.effect]
  if (!capabilities) return null
  const mapping = config.mappings[`${region}--${settings.effect}`] ?? originalMapping
  const change = (next: Mapping) => {
    try {
      savePerformance({ ...config, mappings: { ...config.mappings, [`${region}--${settings.effect}`]: next } })
      setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  return <section className="mapping-controls" aria-label="音乐响应映射">
    <div className="section-label">音乐响应</div>
    <label className="custom-color"><span>演奏方式</span><ChoiceSelect label="音乐映射预设" value={mapping.preset} disabled={disabled}
      onChange={value => change({ ...originalMapping, preset: value as Mapping['preset'], target: value === 'unfold' ? 'unfold' : 'bend' })}
      options={[{ value: 'original', label: '场景原有响应' }, { value: 'bend', label: '低频推动路径弯曲' }, { value: 'unfold', label: '低频推动局部展开' }, { value: 'custom', label: '自定映射' }]} /></label>
    <p className="creative-rule">让同一场景随音乐弯曲，或向外舒展。</p>
    <details className="creative-details"><summary>细调映射</summary>
      <label className="custom-color"><span>来源</span><ChoiceSelect label="映射来源" value={mapping.source} disabled={disabled}
        onChange={value => change({ ...mapping, preset: 'custom', source: value as Mapping['source'] })}
        options={[{ value: 'bass', label: '低频 RMS' }, { value: 'middle', label: '中频 RMS' }, { value: 'treble', label: '高频 RMS' }, { value: 'transient', label: '起音包络' }]} /></label>
      <label className="custom-color"><span>目标</span><ChoiceSelect label="映射目标" value={mapping.target} disabled={disabled}
        onChange={value => change({ ...mapping, preset: 'custom', target: value as Mapping['target'] })}
        options={Object.entries(capabilities).map(([value, label]) => ({ value, label }))} /></label>
      <Parameter label="映射强度" value={mapping.amount * 100} min={0} max={100} step={5} disabled={disabled}
        onChange={value => change({ ...mapping, preset: 'custom', amount: value / 100 })} />
      <label className="custom-color"><span>曲线</span><ChoiceSelect label="映射曲线" value={mapping.curve} disabled={disabled}
        onChange={value => change({ ...mapping, preset: 'custom', curve: value as Mapping['curve'] })}
        options={[{ value: 'linear', label: '线性' }, { value: 'square', label: '强调强音' }]} /></label>
      <p className="creative-rule">静音或减少动态时回到基础形状，不改变音频增益。每个区域与场景分别记住选择。</p>
    </details>
    {error && <p role="alert">{error}</p>}
  </section>
}
