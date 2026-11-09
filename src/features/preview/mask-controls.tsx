import { IconButton } from "@/components/ui/icon-button";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { MAX_MASKS, type SceneMask } from "../spectrum/model";

export function MaskControls({
  masks,
  selected,
  onSelect,
  onChange,
  disabled,
}: {
  masks: SceneMask[];
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (masks: SceneMask[]) => void;
  disabled: boolean;
}) {
  const mask = masks.find((item) => item.id === selected) ?? masks[0];
  const add = () => {
    const id = crypto.randomUUID();
    onChange([
      ...masks,
      {
        id,
        bounds: { x: 0.4, y: 0.3, width: 0.2, height: 0.3 },
        feather: 0.015,
      },
    ]);
    onSelect(id);
  };
  return (
    <div className="mask-controls" aria-label="遮罩设置">
      <div className="mask-actions">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || masks.length >= MAX_MASKS}
          onClick={add}
        >
          <Plus size={13} />
          添加遮罩
        </Button>
        {masks.map((item, index) => (
          <Button
            key={item.id}
            size="sm"
            variant="ghost"
            aria-label={`选择遮罩 ${index + 1}`}
            aria-pressed={mask?.id === item.id}
            disabled={disabled}
            onClick={() => onSelect(item.id)}
          >
            {index + 1}
          </Button>
        ))}
        {mask && (
          <IconButton
            aria-label="删除当前遮罩"
            title="删除当前遮罩"
            disabled={disabled}
            onClick={() =>
              onChange(masks.filter((item) => item.id !== mask.id))
            }
          >
            <Trash2 size={14} />
          </IconButton>
        )}
      </div>
      {mask && (
        <div className="mask-feather">
          <span>柔边</span>
          <Slider
            aria-label="遮罩柔边"
            min={0}
            max={8}
            step={0.5}
            value={[mask.feather * 100]}
            disabled={disabled}
            onValueChange={([value]) =>
              onChange(
                masks.map((item) =>
                  item.id === mask.id
                    ? { ...item, feather: value / 100 }
                    : item,
                ),
              )
            }
          />
          <output>{Math.round(mask.feather * 1000) / 10}%</output>
        </div>
      )}
      <p className="preview-message">
        拖出矩形以留出空白，方向键微调；最多 {MAX_MASKS} 个。
      </p>
    </div>
  );
}
