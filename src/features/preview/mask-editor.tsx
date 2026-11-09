import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { MAX_MASKS, type SceneBounds, type SceneMask } from "../spectrum/model";
import { moveBounds } from "./preview-geometry";

interface Props {
  masks: SceneMask[];
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (masks: SceneMask[]) => void;
  disabled: boolean;
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));
function resizeMask(bounds: SceneBounds, dx: number, dy: number) {
  const cx = bounds.x + bounds.width / 2,
    cy = bounds.y + bounds.height / 2;
  const width = Math.max(
    0.02,
    Math.min(bounds.width + dx * 2, 2 * Math.min(cx, 1 - cx)),
  );
  const height = Math.max(
    0.02,
    Math.min(bounds.height + dy * 2, 2 * Math.min(cy, 1 - cy)),
  );
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}
export function MaskEditor({
  masks,
  selected,
  onSelect,
  onChange,
  disabled,
}: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    pointer: number;
    id: string | null;
    kind: "draw" | "move" | "resize";
    startX: number;
    startY: number;
    start: SceneBounds;
    next: SceneBounds;
    target: HTMLElement;
  } | null>(null);
  const [draft, setDraft] = useState<{
    id: string | null;
    bounds: SceneBounds;
  } | null>(null);
  useEffect(() => {
    if (disabled) {
      gesture.current = null;
      setDraft(null);
    }
  }, [disabled]);
  const point = (event: PointerEvent) => {
    const rect = surface.current!.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.x) / rect.width),
      y: clamp((event.clientY - rect.y) / rect.height),
    };
  };
  const begin = (
    event: PointerEvent<HTMLElement>,
    mask?: SceneMask,
    resize = false,
  ) => {
    if (
      disabled ||
      event.button !== 0 ||
      gesture.current ||
      (!mask && masks.length >= MAX_MASKS)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const p = point(event),
      start = mask?.bounds ?? { x: p.x, y: p.y, width: 0, height: 0 };
    gesture.current = {
      pointer: event.pointerId,
      id: mask?.id ?? null,
      kind: !mask ? "draw" : resize ? "resize" : "move",
      startX: p.x,
      startY: p.y,
      start,
      next: start,
      target: event.currentTarget,
    };
    if (mask) onSelect(mask.id);
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointer) return;
    const p = point(event),
      dx = p.x - g.startX,
      dy = p.y - g.startY;
    g.next =
      g.kind === "draw"
        ? {
            x: Math.min(p.x, g.startX),
            y: Math.min(p.y, g.startY),
            width: Math.abs(dx),
            height: Math.abs(dy),
          }
        : g.kind === "resize"
          ? resizeMask(g.start, dx, dy)
          : moveBounds(g.start, dx, dy);
    setDraft({ id: g.id, bounds: g.next });
  };
  const finish = (cancelled = false) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    setDraft(null);
    if (g.target.hasPointerCapture(g.pointer))
      g.target.releasePointerCapture(g.pointer);
    if (cancelled) return;
    if (g.id)
      onChange(
        masks.map((mask) =>
          mask.id === g.id ? { ...mask, bounds: g.next } : mask,
        ),
      );
    else if (g.next.width >= 0.02 && g.next.height >= 0.02) {
      const id = crypto.randomUUID();
      onChange([...masks, { id, bounds: g.next, feather: 0.015 }]);
      onSelect(id);
    }
  };
  const keyboard = (event: KeyboardEvent, mask: SceneMask, resize = false) => {
    if (event.key === "Escape" && gesture.current) {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
      return;
    }
    if (
      disabled ||
      gesture.current ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(mask.id);
    const step = event.shiftKey ? 0.02 : 0.002;
    const bounds = (resize ? resizeMask : moveBounds)(
      mask.bounds,
      event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
      event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
    );
    onChange(
      masks.map((item) => (item.id === mask.id ? { ...item, bounds } : item)),
    );
  };
  const box = (bounds: SceneBounds) => ({
    left: `${bounds.x * 100}%`,
    top: `${bounds.y * 100}%`,
    width: `${bounds.width * 100}%`,
    height: `${bounds.height * 100}%`,
  });
  return (
    <div
      className="mask-editor"
      ref={surface}
      tabIndex={disabled ? -1 : 0}
      aria-label="遮罩绘制区域"
      onPointerDown={(event) => begin(event)}
      onPointerMove={move}
      onPointerUp={() => finish()}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && gesture.current) {
          event.preventDefault();
          event.stopPropagation();
          finish(true);
        }
      }}
    >
      {masks.map((mask, index) => (
        <div
          key={mask.id}
          className={`mask-box${selected === mask.id ? " selected" : ""}`}
          style={box(draft?.id === mask.id ? draft.bounds : mask.bounds)}
          role="group"
          tabIndex={disabled ? -1 : 0}
          aria-label={`遮罩 ${index + 1}，方向键移动`}
          data-mask-id={mask.id}
          onFocus={() => onSelect(mask.id)}
          onPointerDown={(event) => begin(event, mask)}
          onKeyDown={(event) => keyboard(event, mask)}
        >
          <span className="preview-bounds-label">遮罩 {index + 1}</span>
          <button
            className="preview-resize"
            aria-label={`缩放遮罩 ${index + 1}`}
            disabled={disabled}
            onPointerDown={(event) => begin(event, mask, true)}
            onKeyDown={(event) => keyboard(event, mask, true)}
          />
        </div>
      ))}
      {draft?.id === null && (
        <div className="mask-box draft" style={box(draft.bounds)} />
      )}
    </div>
  );
}
