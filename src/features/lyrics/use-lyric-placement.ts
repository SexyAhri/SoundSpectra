import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { SceneBounds } from "../spectrum/model";
import { snapBounds } from "../preview/preview-geometry";

export function useLyricPlacement(
  bounds: SceneBounds,
  enabled: boolean,
  onChange?: (bounds: SceneBounds, resized?: boolean) => void,
  onSnap?: (guides: { x: number | null; y: number | null }) => void,
) {
  const [draft, setDraft] = useState<SceneBounds | null>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    start: SceneBounds;
    next: SceneBounds;
    resize: boolean;
    target: HTMLElement;
  } | null>(null);
  const cancel = () => {
    const drag = gesture.current;
    gesture.current = null;
    setDraft(null);
    onSnap?.({ x: null, y: null });
    if (drag?.target.hasPointerCapture(drag.id))
      drag.target.releasePointerCapture(drag.id);
  };
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled]);
  const begin = (event: PointerEvent<HTMLElement>, resize = false) => {
    if (!enabled || event.button !== 0 || gesture.current) return;
    event.preventDefault();
    event.stopPropagation();
    const layer = event.currentTarget.closest<HTMLElement>(".lyric-layer")!;
    const box = layer.parentElement!.getBoundingClientRect();
    layer.focus({ preventScroll: true });
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: box.width,
      height: box.height,
      start: { ...bounds },
      next: { ...bounds },
      resize,
      target: event.currentTarget,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moving = (event: PointerEvent<HTMLElement>) => {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = (event.clientX - drag.x) / drag.width,
      dy = (event.clientY - drag.y) / drag.height;
    drag.next = drag.resize
      ? {
          ...drag.start,
          width: Math.max(
            0.25,
            Math.min(1 - drag.start.x, drag.start.width + dx),
          ),
          height: Math.max(
            0.1,
            Math.min(0.75, 1 - drag.start.y, drag.start.height + dy),
          ),
        }
      : {
          ...drag.start,
          x: Math.max(0, Math.min(1 - drag.start.width, drag.start.x + dx)),
          y: Math.max(0, Math.min(1 - drag.start.height, drag.start.y + dy)),
        };
    const snapped =
      onSnap && !drag.resize && !event.altKey
        ? snapBounds(drag.next, drag.width, drag.height)
        : { bounds: drag.next, x: null, y: null };
    drag.next = snapped.bounds;
    onSnap?.({ x: snapped.x, y: snapped.y });
    setDraft(drag.next);
  };
  const end = (event: PointerEvent<HTMLElement>, cancelled = false) => {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    event.stopPropagation();
    gesture.current = null;
    setDraft(null);
    onSnap?.({ x: null, y: null });
    if (drag.target.hasPointerCapture(drag.id))
      drag.target.releasePointerCapture(drag.id);
    if (!cancelled) onChange?.(drag.next, drag.resize);
  };
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (!enabled) return;
    if (event.key === "Escape" && gesture.current) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
        event.key,
      ) ||
      gesture.current
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 0.02 : 0.002;
    const dx =
      event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy =
      event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    onChange?.({
      ...bounds,
      x: Math.max(0, Math.min(1 - bounds.width, bounds.x + dx)),
      y: Math.max(0, Math.min(1 - bounds.height, bounds.y + dy)),
    });
  };
  return { bounds: draft ?? bounds, begin, moving, end, keyboard };
}
