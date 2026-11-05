import { Button } from '@/components/ui/button'
import { Parameter } from './appearance-panel'
import { LayoutPresets } from '../preview/layout-presets'
import { defaults, type SpectrumSettings } from '../spectrum/model'
import { isThreeEffect } from '../spectrum/music-engine/catalog'
import { SceneViewControls } from './scene-view-controls'

export function PositionPanel({ settings, update, disabled }: { settings: SpectrumSettings; update: (patch: Partial<SpectrumSettings>) => void; disabled: boolean }) {
  const positionPatch = (
    key: "width" | "height" | "x" | "y",
    percent: number,
  ) => {
    const bounds = { ...settings.bounds, [key]: percent / 100 };
    if (key === "width") {
      bounds.x += (settings.bounds.width - bounds.width) / 2;
    }
    bounds.x = Math.max(0, Math.min(bounds.x, 1 - bounds.width));
    bounds.y = Math.min(bounds.y, 1 - bounds.height);
    update({ bounds });
  };
  return (
    <div className="inspector-content">
      {isThreeEffect(settings.effect) && <><SceneViewControls view={settings.view} onChange={view => update({ view })} disabled={disabled} /><div className="inspector-divider" /></>}
      <div className="section-label">布局预设</div>
      <LayoutPresets bounds={settings.bounds} disabled={disabled} onChange={bounds => update({ bounds })} />
      <div className="section-label">相对主屏幕的比例</div>
      <Parameter
        label="宽度"
        value={settings.bounds.width * 100}
        min={20}
        max={100}
        disabled={disabled}
        onChange={(value) => positionPatch("width", value)}
      />
      <Parameter
        label="高度"
        value={settings.bounds.height * 100}
        min={8}
        max={100}
        disabled={disabled}
        onChange={(value) => positionPatch("height", value)}
      />
      <Parameter
        label="距左侧"
        value={settings.bounds.x * 100}
        min={0}
        max={Math.round((1 - settings.bounds.width) * 100)}
        disabled={disabled}
        onChange={(value) => positionPatch("x", value)}
      />
      <Parameter
        label="距顶部"
        value={settings.bounds.y * 100}
        min={0}
        max={Math.round((1 - settings.bounds.height) * 100)}
        disabled={disabled}
        onChange={(value) => positionPatch("y", value)}
      />
      <Button
        variant="outline"
        className="w-full"
        disabled={disabled}
        onClick={() => update({ bounds: { ...defaults.bounds } })}
      >
        恢复中下部位置
      </Button>
    </div>
  )
}
