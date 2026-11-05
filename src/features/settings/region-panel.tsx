import { IconButton } from '@/components/ui/icon-button'
import { useEffect, useRef, useState } from 'react'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { MAX_REGIONS, type SpectrumSettings, type SettingsUpdate } from '../spectrum/model'
import { regionStyle, sceneRegions } from '../spectrum/regions'
import { ChoiceSelect } from '@/components/ui/choice-select'

interface Props { settings: SpectrumSettings; selected: string; onSelect: (id: string) => void; disabled: boolean; update: SettingsUpdate }
export function RegionPanel({ settings, selected, onSelect, disabled, update }: Props) {
  const regions = sceneRegions(settings), region = regions.find(item => item.id === selected) ?? regions[0]
  const [name, setName] = useState(region.name)
  const [renaming, setRenaming] = useState(false)
  const cancelRename = useRef(false), renameButton = useRef<HTMLButtonElement>(null)
  useEffect(() => setName(region.name), [region.id, region.name])
  useEffect(() => setRenaming(false), [region.id, disabled])
  const change = (patch: { name?: string; visible?: boolean }) => update(current => region.id === 'primary'
    ? { ...(patch.name !== undefined ? { regionName: patch.name } : {}), ...(patch.visible !== undefined ? { regionVisible: patch.visible } : {}) }
    : { regions: current.regions.map(item => item.id === region.id ? { ...item, ...patch } : item) })
  const add = () => {
    if (regions.length >= MAX_REGIONS || disabled) return
    const id = crypto.randomUUID()
    update(current => ({ regions: [...current.regions, { ...regionStyle(region), id, name: `区域 ${regions.length + 1}`, visible: true, bounds: { x: .3, y: .25, width: .4, height: .4 } }] }))
    onSelect(id)
  }
  const remove = () => {
    if (disabled || regions.length < 2) return
    if (region.id === 'primary') {
      update(current => {
        const [promoted, ...remaining] = current.regions
        return promoted ? { ...regionStyle(promoted), regionName: promoted.name, regionVisible: promoted.visible, regions: remaining } : {}
      })
    } else update(current => ({ regions: current.regions.filter(item => item.id !== region.id) }))
    onSelect('primary')
  }
  const finishRename = () => {
    const value = name.trim()
    if (!cancelRename.current && value && value !== region.name) change({ name: value })
    else setName(region.name)
    setRenaming(false)
  }
  return <div className="region-panel">
    <div className="region-panel-heading"><span>装饰区域 <small>{regions.length} / {MAX_REGIONS}</small></span>
      <label>显示<Switch aria-label="显示当前区域" disabled={disabled} checked={region.visible} onCheckedChange={visible => change({ visible })} /></label>
    </div>
    <div className="region-selector-row">
      {renaming ? <input aria-label="区域名称" autoFocus value={name} maxLength={24} onFocus={event => event.currentTarget.select()} onChange={event => setName(event.target.value)} onBlur={finishRename}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); cancelRename.current = event.key === 'Escape'; event.currentTarget.blur(); requestAnimationFrame(() => renameButton.current?.focus()) } }} /> : <ChoiceSelect label="当前装饰区域" disabled={disabled} value={region.id} onChange={onSelect}
          options={regions.map(item => ({ value: item.id, label: `${item.name}${item.visible ? '' : '（隐藏）'}` }))} />}
      <IconButton ref={renameButton} aria-label={renaming ? '完成重命名' : '重命名当前区域'} title={renaming ? '完成重命名' : '重命名当前区域'} disabled={disabled} onMouseDown={event => { if (renaming) event.preventDefault() }} onClick={() => { if (renaming) finishRename(); else { cancelRename.current = false; setName(region.name); setRenaming(true) } }}>{renaming ? <Check size={14} /> : <Pencil size={14} />}</IconButton>
      <IconButton aria-label="添加装饰区域" title={`添加区域（最多 ${MAX_REGIONS} 个）`} disabled={disabled || regions.length >= MAX_REGIONS} onClick={add}><Plus size={15} /></IconButton>
      <IconButton aria-label="删除当前区域" title="删除当前区域" disabled={disabled || regions.length < 2} onClick={remove}><Trash2 size={14} /></IconButton>
    </div>
  </div>
}
