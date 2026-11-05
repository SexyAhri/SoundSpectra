import { Slider } from "@/components/ui/slider";
import type { SpectrumSettings } from "../spectrum/model";
import { MusicControls } from './music-controls';

interface Props {
  settings: SpectrumSettings;
  disabled: boolean;
  update: (patch: Partial<SpectrumSettings>) => void;
}
export function Parameter({
  label,
  value,
  min,
  max,
  unit = "%",
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="parameter">
      <div className="parameter-label">
        <span>{label}</span>
        <output>
          {Math.round(value)}
          {unit}
        </output>
      </div>
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={[value]}
        onValueChange={([next]) => onChange(next)}
        disabled={disabled || min === max}
      />
    </div>
  );
}
export function AppearancePanel({ settings, update, disabled }: Props) {
  return <div className="inspector-content appearance-controls">
    <div className="section-label">画面</div>
    <Parameter label="不透明度" value={settings.opacity} min={10} max={100} disabled={disabled} onChange={opacity => update({ opacity })} />
    <div className="inspector-divider" />
    <MusicControls settings={settings} update={update} disabled={disabled} />
  </div>
}
