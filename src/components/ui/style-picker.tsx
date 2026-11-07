import { useState, type ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { Button } from './button'
import { IconButton } from './icon-button'
import { ModalContent } from './modal'
import './style-picker.css'

export interface StyleOption {
  value: string; label: string; detail?: string; group?: string; preview?: ReactNode;
}

/** The same compact entry and accessible chooser for every module. */
export function StylePicker({ label, value, options, onChange, disabled, actions }: {
  label: string; value: string; options: StyleOption[]; onChange: (value: string) => void;
  disabled?: boolean; actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [group, setGroup] = useState('all')
  const current = options.find(option => option.value === value) ?? options[0]
  const groups = [...new Set(options.flatMap(option => option.group ? [option.group] : []))]
  const term = query.trim().toLocaleLowerCase()
  const filtered = options.filter(option => (group === 'all' || option.group === group) && `${option.label} ${option.detail ?? ''} ${option.group ?? ''} ${option.value}`.toLocaleLowerCase().includes(term))
  return <Dialog.Root open={open} onOpenChange={next => { setOpen(next); if (next) { setQuery(''); setGroup('all') } }}>
    <div className="module-style-row" role="group" aria-label={`当前${label}`}>
      {current?.preview && <div className="module-style-thumbnail" aria-hidden="true">{current.preview}</div>}
      <div className="module-style-copy"><span>{label}</span><strong>{current?.label}</strong></div>
      {actions}
      <Dialog.Trigger asChild><Button size="sm" variant="outline" disabled={disabled} aria-label={`更换${label}`}>更换<ChevronDown size={12} /></Button></Dialog.Trigger>
    </div>
    <ModalContent className="module-style-dialog">
      <header><div><Dialog.Title>选择{label}</Dialog.Title><Dialog.Description>点击样式即可应用到当前对象。</Dialog.Description></div><Dialog.Close asChild><IconButton aria-label={`关闭${label}选择`}><X size={18} /></IconButton></Dialog.Close></header>
      {(options.length > 6 || groups.length > 1) && <div className="module-style-filters">
        <label className="module-style-search"><Search size={15} /><input type="search" aria-label={`搜索${label}`} placeholder="搜索名称或风格" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {groups.length > 1 && <div role="group" aria-label={`${label}分类`}>{['all', ...groups].map(name => <button key={name} aria-pressed={group === name} onClick={() => setGroup(name)}>{name === 'all' ? '全部' : name}</button>)}</div>}
      </div>}
      <div className="module-style-options" role="group" aria-label={`${label}选项`}>
        {filtered.map(option => <button className="module-style-option" key={option.value} aria-label={option.label} aria-pressed={value === option.value} disabled={disabled} onClick={() => { if (!disabled) { onChange(option.value); setOpen(false) } }}>
          <div className="module-option-preview" aria-hidden="true">{option.preview}{value === option.value && <span className="module-option-selected"><Check size={12} />当前</span>}</div>
          <span className="module-option-name">{option.label}</span>{option.detail && <small>{option.detail}</small>}
        </button>)}
        {!filtered.length && <div className="module-style-empty"><p>没有找到匹配的样式</p><Button size="sm" variant="outline" onClick={() => { setQuery(''); setGroup('all') }}>查看全部样式</Button></div>}
      </div>
    </ModalContent>
  </Dialog.Root>
}
