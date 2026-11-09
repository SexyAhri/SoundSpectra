import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Parameter } from "@/components/ui/parameter";
import type { RailChange, RailGroup } from "./model";

export function RailLayoutSettings({
  group,
  disabled,
  change,
}: {
  group: RailGroup;
  disabled: boolean;
  change: (value: RailChange) => Promise<void>;
}) {
  return (
    <div className="rail-layout-settings">
      <section className="module-section" aria-label="拾光绳位置与尺寸">
        <h3>位置与尺寸</h3>
        <div
          className="rail-position-presets"
          role="group"
          aria-label="拾光绳靠边预设"
        >
          {[
            { label: "左上", x: 0.06, y: 0.12 },
            { label: "右上", x: 0.94 - group.width, y: 0.12 },
            { label: "左下", x: 0.06, y: 0.58 },
            { label: "右下", x: 0.94 - group.width, y: 0.58 },
          ].map((preset) => {
            const x = Math.max(0, Math.min(1 - group.width, preset.x));
            return (
              <Button
                key={preset.label}
                variant="outline"
                size="sm"
                disabled={disabled}
                aria-pressed={
                  Math.abs(group.x - x) < 0.001 &&
                  Math.abs(group.y - preset.y) < 0.001
                }
                onClick={() =>
                  void change({ type: "group", id: group.id, x, y: preset.y })
                }
              >
                {preset.label}
              </Button>
            );
          })}
        </div>
        <RailParameter
          label="拾光绳宽度"
          value={group.width * 100}
          min={20}
          max={100}
          disabled={disabled}
          onSave={(value) =>
            change({ type: "group", id: group.id, width: value / 100 })
          }
        />
        <details className="module-advanced">
          <summary>精确位置</summary>
          <RailParameter
            label="距屏幕左侧"
            value={group.x * 100}
            min={0}
            max={Math.round((1 - group.width) * 100)}
            disabled={disabled}
            onSave={(value) =>
              change({ type: "group", id: group.id, x: value / 100 })
            }
          />
          <RailParameter
            label="距屏幕顶部"
            value={group.y * 100}
            min={0}
            max={75}
            disabled={disabled}
            onSave={(value) =>
              change({ type: "group", id: group.id, y: value / 100 })
            }
          />
        </details>
      </section>
    </div>
  );
}

function RailParameter({
  value,
  onSave,
  ...props
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onSave: (value: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  return (
    <Parameter
      {...props}
      value={draft}
      onChange={(next) => {
        editing.current = true;
        setDraft(next);
      }}
      onCommit={(next) => {
        void onSave(next).finally(() => {
          editing.current = false;
          setDraft(latest.current);
        });
      }}
    />
  );
}
export function RailNameField({
  id,
  value,
  onSave,
  disabled,
  max = 120,
}: {
  id: string;
  value: string;
  onSave: (name: string) => void;
  disabled: boolean;
  max?: number;
}) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  return (
    <input
      id={id}
      value={draft}
      maxLength={max}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        if (draft.trim() && draft.trim() !== value) onSave(draft.trim());
        else setDraft(value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.stopPropagation();
          cancelled.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
