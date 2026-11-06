import { Select } from 'radix-ui'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import './choice-select.css'

export interface ChoiceOption { value: string; label: string; description?: string; swatches?: readonly string[] }
export function ChoiceSelect({ label, value, onChange, options, disabled, className = '' }: {
  label: string; value: string; onChange: (value: string) => void; options: ChoiceOption[]; disabled?: boolean; className?: string;
}) {
  return <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
    <Select.Trigger aria-label={label} className={`choice-trigger ${className}`}><Select.Value /><Select.Icon><ChevronDown size={14} /></Select.Icon></Select.Trigger>
    <Select.Portal><Select.Content className="choice-menu" position="popper" sideOffset={6} collisionPadding={10}>
      <Select.ScrollUpButton className="choice-scroll"><ChevronUp size={14} /></Select.ScrollUpButton>
      <Select.Viewport className="choice-viewport">{options.map(option => <Select.Item key={option.value} value={option.value} data-value={option.value} className="choice-option" textValue={option.label}>
        <span><Select.ItemText>{option.swatches && <span className="choice-swatches" aria-hidden="true">{option.swatches.map((color, index) => <i key={index} style={{ backgroundColor: color }} />)}</span>}{option.label}</Select.ItemText>{option.description && <small>{option.description}</small>}</span>
        <Select.ItemIndicator><Check size={14} /></Select.ItemIndicator>
      </Select.Item>)}</Select.Viewport>
      <Select.ScrollDownButton className="choice-scroll"><ChevronDown size={14} /></Select.ScrollDownButton>
    </Select.Content></Select.Portal>
  </Select.Root>
}
