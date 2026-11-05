import { useId, type ReactNode } from 'react'
import { Slider } from './slider'

export interface ParameterProps {
  label: string; value: number; min: number; max: number; step?: number; unit?: string
  format?: (value: number) => ReactNode
  onChange: (value: number) => void; onCommit?: (value: number) => void; disabled?: boolean
}

export function Parameter({ label, value, min, max, step = 1, unit = '%', format = Math.round, onChange, onCommit, disabled }: ParameterProps) {
  const id = useId()
  return <div className="parameter">
    <div className="parameter-label"><span id={id}>{label}</span><output>{format(value)}{unit}</output></div>
    <Slider aria-label={label} aria-labelledby={id} min={min} max={max} step={step} value={[value]}
      onValueChange={([next]) => onChange(next)} onValueCommit={onCommit ? ([next]) => onCommit(next) : undefined}
      disabled={disabled || min === max} />
  </div>
}
