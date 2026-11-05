import { Parameter } from "@/components/ui/parameter";
import type { SpectrumSettings } from "../spectrum/model";
import { MusicControls } from './music-controls';

interface Props {
  settings: SpectrumSettings;
  disabled: boolean;
  update: (patch: Partial<SpectrumSettings>) => void;
}
export function AppearancePanel({ settings, update, disabled }: Props) {
  return <div className="inspector-content appearance-controls">
    <div className="section-label">画面</div>
    <Parameter label="不透明度" value={settings.opacity} min={10} max={100} disabled={disabled} onChange={opacity => update({ opacity })} />
    <div className="inspector-divider" />
    <MusicControls settings={settings} update={update} disabled={disabled} />
  </div>
}
