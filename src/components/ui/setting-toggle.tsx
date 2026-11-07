import { useId } from 'react'
import { Switch } from './switch'
import { cn } from '@/lib/utils'

export function SettingToggle({ label, description, accessibleLabel = label, checked, disabled, onChange, className }: {
  label: string; description?: string; accessibleLabel?: string; checked: boolean; disabled?: boolean
  onChange: (value: boolean) => void; className?: string
}) {
  const descriptionId = useId()
  return <label className={cn('setting-toggle', className)}>
    <div><span>{label}</span>{description && <p id={descriptionId}>{description}</p>}</div>
    <Switch aria-label={accessibleLabel} aria-describedby={description ? descriptionId : undefined} checked={checked} disabled={disabled} onCheckedChange={onChange} />
  </label>
}
