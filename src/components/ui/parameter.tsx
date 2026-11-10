import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Slider } from "./slider";
import { Hint } from "./hint";

export interface ParameterProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  format?: (value: number) => ReactNode;
  defaultValue?: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  disabled?: boolean;
}

export function Parameter({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "%",
  format = Math.round,
  defaultValue,
  onChange,
  onCommit,
  disabled,
}: ParameterProps) {
  const id = useId();
  const valueButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState("");
  const initial = useRef(value),
    captured = useRef(false),
    cancelled = useRef(false);
  useEffect(() => {
    if (!disabled && !captured.current) {
      initial.current = value;
      captured.current = true;
    }
  }, [disabled, value]);
  useEffect(() => {
    if (disabled) setEditing(false);
  }, [disabled]);
  const normalize = (next: number) =>
    Number(
      Math.max(
        min,
        Math.min(max, min + Math.round((next - min) / step) * step),
      ).toFixed(8),
    );
  const commit = (next: number) => {
    const result = normalize(next);
    onChange(result);
    onCommit?.(result);
  };
  const finish = () => {
    setEditing(false);
    if (!cancelled.current && draft.trim() && Number.isFinite(Number(draft)))
      commit(Number(draft));
    cancelled.current = false;
    if (returnFocus.current) {
      returnFocus.current = false;
      requestAnimationFrame(() =>
        valueButton.current?.focus({ preventScroll: true }),
      );
    }
  };
  const reset = normalize(defaultValue ?? initial.current);
  return (
    <div className="parameter">
      <div className="parameter-label">
        <span id={id}>{label}</span>
        <div className="parameter-value">
          {editing ? (
            <input
              type="number"
              aria-label={`${label}精确值`}
              aria-describedby={`${id}-range`}
              autoFocus
              min={min}
              max={max}
              step={step}
              value={draft}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={finish}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  cancelled.current = e.key === "Escape";
                  returnFocus.current = true;
                  e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <Hint text={`输入精确值 · ${min}–${max}${unit}`}>
              <button
                ref={valueButton}
                disabled={disabled || min === max}
                aria-label={`编辑${label}数值`}
                onClick={() => {
                  cancelled.current = false;
                  setDraft(String(Number(value.toFixed(8))));
                  setEditing(true);
                }}
              >
                <output>
                  {format(value)}
                  {unit}
                </output>
              </button>
            </Hint>
          )}
          <Hint
            text={
              defaultValue === undefined ? "恢复进入此设置时的值" : "恢复默认值"
            }
          >
            <button
              className="parameter-reset"
              aria-label={`还原${label}`}
              disabled={disabled || value === reset}
              onClick={() => commit(reset)}
            >
              <RotateCcw size={12} />
            </button>
          </Hint>
        </div>
      </div>
      {editing && (
        <span className="parameter-range" id={`${id}-range`}>
          范围 {min}–{max}
          {unit} · 步长 {step}
        </span>
      )}
      <Slider
        aria-label={label}
        aria-labelledby={id}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => onChange(next)}
        onValueCommit={onCommit ? ([next]) => onCommit(next) : undefined}
        disabled={disabled || min === max}
      />
    </div>
  );
}
