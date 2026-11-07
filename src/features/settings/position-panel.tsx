import { Parameter } from '@/components/ui/parameter'
import { LayoutPresets } from '../preview/layout-presets'
import type { SpectrumSettings } from '../spectrum/model'
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
    <div className="inspector-content effect-position-controls">
      <section className="effect-settings-block" aria-label="区域布局">
      <header className="effect-block-heading"><h3>区域布局</h3><p>选择摆放方式，也可以在预览中拖动微调</p></header>
      <LayoutPresets bounds={settings.bounds} disabled={disabled} onChange={bounds => update({ bounds })} />
      <details className="inspector-advanced"><summary>精确位置</summary>
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
      </details>
      </section>
      {isThreeEffect(settings.effect) && <details className="module-advanced"><summary>三维视角</summary><SceneViewControls view={settings.view} onChange={view => update({ view })} disabled={disabled} /></details>}
    </div>
  )
}
