import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import type { DesktopCardSettings, SceneBounds } from "../spectrum/model";
import { relativeBounds } from "../spectrum/regions";
import type { NowPlaying } from "./use-now-playing";
import { MusicCard } from "./music-card";
import { snapBounds } from "../preview/preview-geometry";

export function CardLayer({
  settings,
  info,
  color,
  bands,
  receivedAt,
  demo = false,
  active = true,
  desktop = false,
  host,
  arranging = false,
  onChange,
  onSelect,
  zIndex,
  selected,
  previewSize,
  onSnap,
}: {
  settings: DesktopCardSettings;
  info: NowPlaying;
  color: string;
  bands: RefObject<Float32Array>;
  receivedAt: RefObject<number>;
  demo?: boolean;
  active?: boolean;
  desktop?: boolean;
  host?: SceneBounds;
  arranging?: boolean;
  onChange?: (bounds: SceneBounds) => void;
  onSelect?: () => void;
  zIndex?: number;
  selected?: boolean;
  previewSize?: { width: number; height: number; scale: number };
  onSnap?: (guides: { x: number | null; y: number | null }) => void;
}) {
  const [draft, setDraft] = useState<SceneBounds | null>(null);
  const drag = useRef<{
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
  useEffect(() => {
    if (!arranging) {
      drag.current = null;
      setDraft(null);
      onSnap?.({ x: null, y: null });
    }
  }, [arranging]);
  const move = (b: SceneBounds, dx: number, dy: number) => ({
    ...b,
    x: Math.max(0, Math.min(1 - b.width, b.x + dx)),
    y: Math.max(0, Math.min(1 - b.height, b.y + dy)),
  });
  const resize = (b: SceneBounds, delta: number) => {
    const width = Math.max(0.15, Math.min(0.45, 1 - b.x, b.width + delta));
    const height = Math.max(
      0.08,
      Math.min(0.24, 1 - b.y, (b.height * width) / b.width),
    );
    return { ...b, width, height };
  };
  const begin = (event: PointerEvent<HTMLElement>, resizing = false) => {
    if (!arranging || event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    const layer =
      event.currentTarget.closest<HTMLElement>(".music-card-layer")!;
    layer.focus({ preventScroll: true });
    onSelect?.();
    const rect = layer.parentElement!.getBoundingClientRect();
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      start: settings.bounds,
      next: settings.bounds,
      resize: resizing,
      target: event.currentTarget,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moving = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = (event.clientX - current.x) / current.width,
      dy = (event.clientY - current.y) / current.height;
    const bounds = current.resize
      ? resize(current.start, dx)
      : move(current.start, dx, dy);
    const snapped =
      onSnap && !current.resize && !event.altKey
        ? snapBounds(bounds, current.width, current.height)
        : { bounds, x: null, y: null };
    current.next = snapped.bounds;
    onSnap?.({ x: snapped.x, y: snapped.y });
    setDraft(current.next);
  };
  const end = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    if (current.target.hasPointerCapture(event.pointerId))
      current.target.releasePointerCapture(event.pointerId);
    onSnap?.({ x: null, y: null });
    if (!cancel) onChange?.(current.next);
    setDraft(null);
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!arranging) return;
    if (event.key === "Escape" && drag.current) {
      event.preventDefault();
      event.stopPropagation();
      const current = drag.current;
      drag.current = null;
      if (current.target.hasPointerCapture(current.id))
        current.target.releasePointerCapture(current.id);
      setDraft(null);
      onSnap?.({ x: null, y: null });
      return;
    }
    if (!event.key.startsWith("Arrow") || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 0.02 : 0.002;
    if ((event.target as HTMLElement).closest(".card-preview-resize")) {
      onChange?.(
        resize(
          settings.bounds,
          ["ArrowLeft", "ArrowUp"].includes(event.key) ? -step : step,
        ),
      );
      return;
    }
    onChange?.(
      move(
        settings.bounds,
        event.key === "ArrowLeft"
          ? -step
          : event.key === "ArrowRight"
            ? step
            : 0,
        event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
      ),
    );
  };
  const b = host
    ? relativeBounds(draft ?? settings.bounds, host)
    : (draft ?? settings.bounds);
  return (
    <div
      className={`music-card-layer ${arranging ? "arrange-card" : ""}`}
      data-testid="music-card-layer"
      data-preview-object="card"
      data-selected={selected || undefined}
      style={{
        zIndex,
        left: `${b.x * 100}%`,
        top: `${b.y * 100}%`,
        width: `${b.width * 100}%`,
        height: `${b.height * 100}%`,
      }}
      role={arranging ? "group" : undefined}
      tabIndex={arranging ? 0 : undefined}
      aria-label={arranging ? "音乐卡片位置，方向键移动" : undefined}
      onFocus={arranging ? onSelect : undefined}
      onPointerDown={begin}
      onPointerMove={moving}
      onPointerUp={(event) => end(event)}
      onPointerCancel={(event) => end(event, true)}
      onLostPointerCapture={(event) => end(event, true)}
      onKeyDown={keyboard}
    >
      <div
        className="music-card-render"
        style={{
          width: previewSize?.width ?? "100%",
          height: previewSize?.height ?? "100%",
          transformOrigin: "top left",
          transform: previewSize ? `scale(${previewSize.scale})` : undefined,
        }}
      >
        <MusicCard
          info={info}
          settings={settings}
          color={color}
          bands={bands}
          receivedAt={receivedAt}
          demo={demo}
          active={active}
          desktop={desktop}
          controlsDisabled={arranging}
        />
      </div>
      {arranging && (
        <>
          <span className="card-layer-bounds-label" aria-hidden="true">
            音乐卡片 · {Math.round(b.width * 100)}%
          </span>
          <button
            className="card-preview-resize"
            aria-label="缩放音乐卡片"
            title="拖动缩放，方向键微调"
            onPointerDown={(event) => begin(event, true)}
          />
        </>
      )}
    </div>
  );
}
