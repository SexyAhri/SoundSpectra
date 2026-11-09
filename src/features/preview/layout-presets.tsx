import { Button } from "@/components/ui/button";
import type { Bounds } from "./preview-geometry";

export const layoutPresets: { id: string; label: string; bounds: Bounds }[] = [
  {
    id: "panorama",
    label: "全景",
    bounds: { x: 0, y: 0, width: 1, height: 1 },
  },
  {
    id: "lower",
    label: "中下部",
    bounds: { x: 0.12, y: 0.7, width: 0.76, height: 0.22 },
  },
  { id: "sky", label: "天空", bounds: { x: 0, y: 0, width: 1, height: 0.6 } },
  {
    id: "center",
    label: "居中",
    bounds: { x: 0.2, y: 0.25, width: 0.6, height: 0.5 },
  },
  {
    id: "left",
    label: "左侧",
    bounds: { x: 0.04, y: 0.24, width: 0.38, height: 0.6 },
  },
  {
    id: "right",
    label: "右侧",
    bounds: { x: 0.58, y: 0.24, width: 0.38, height: 0.6 },
  },
];

export function LayoutPresets({
  bounds,
  disabled,
  onChange,
}: {
  bounds: Bounds;
  disabled: boolean;
  onChange: (bounds: Bounds) => void;
}) {
  return (
    <div className="layout-presets" role="group" aria-label="布局预设">
      {layoutPresets.map((preset) => (
        <Button
          key={preset.id}
          variant="outline"
          disabled={disabled}
          aria-label={`应用${preset.label}布局`}
          aria-pressed={(Object.keys(bounds) as (keyof Bounds)[]).every(
            (key) => Math.abs(bounds[key] - preset.bounds[key]) < 0.0001,
          )}
          onClick={() => onChange({ ...preset.bounds })}
        >
          <span className="layout-miniature" aria-hidden="true">
            <span
              style={{
                left: `${preset.bounds.x * 100}%`,
                top: `${preset.bounds.y * 100}%`,
                width: `${preset.bounds.width * 100}%`,
                height: `${preset.bounds.height * 100}%`,
              }}
            />
          </span>
          <span>{preset.label}</span>
        </Button>
      ))}
    </div>
  );
}
