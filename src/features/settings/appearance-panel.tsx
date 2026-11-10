import { Parameter } from "@/components/ui/parameter";
import type { SpectrumSettings } from "../spectrum/model";
import { SceneAppearanceControls } from "./music-controls";

interface Props {
  settings: SpectrumSettings;
  disabled: boolean;
  update: (patch: Partial<SpectrumSettings>) => void;
  region?: string;
}
export function AppearancePanel({ settings, update, disabled }: Props) {
  return (
    <div className="inspector-content appearance-controls">
      <section className="effect-settings-block" aria-label="画面与配色">
        <header className="effect-block-heading">
          <h3>画面与配色</h3>
          <p>让灯效融入桌面，或营造沉浸氛围</p>
        </header>
        <Parameter
          label="不透明度"
          value={settings.opacity}
          defaultValue={100}
          min={10}
          max={100}
          disabled={disabled}
          onChange={(opacity) => update({ opacity })}
        />
        <SceneAppearanceControls
          settings={settings}
          update={update}
          disabled={disabled}
        />
      </section>
    </div>
  );
}
