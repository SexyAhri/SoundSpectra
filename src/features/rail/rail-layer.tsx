import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { RailSurface } from "./rail-surface";
import type { RailGroup } from "./model";
import type { RailController } from "./use-rail";

type Placement = Pick<RailGroup, "x" | "y" | "width">;
function RailLayerContent({
  controller,
  selected,
  editing,
  arranging = false,
  locked = [],
  interactive = true,
  active = true,
  onSelect,
  desktopWidth,
}: {
  controller: RailController;
  selected: string | null;
  editing: boolean;
  arranging?: boolean;
  locked?: string[];
  interactive?: boolean;
  active?: boolean;
  onSelect: (groupId: string, itemId?: string) => void;
  desktopWidth?: number;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<(Placement & { id: string }) | null>(null);
  const [previewWidth, setPreviewWidth] = useState(0);
  const gesture = useRef<{
    id: string;
    pointer: number;
    x: number;
    y: number;
    width: number;
    height: number;
    start: Placement;
    next: Placement;
    resize: boolean;
    target: HTMLElement;
  } | null>(null);
  const canEdit =
    (editing || arranging) && interactive && controller.pending === 0;
  const cancel = () => {
    const current = gesture.current;
    gesture.current = null;
    setDraft(null);
    if (current?.target.hasPointerCapture(current.pointer))
      current.target.releasePointerCapture(current.pointer);
  };
  useLayoutEffect(() => {
    if (!holder.current) return;
    setPreviewWidth(holder.current.clientWidth);
    const observer = new ResizeObserver(() =>
      setPreviewWidth(holder.current?.clientWidth ?? 0),
    );
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, [controller.loaded, controller.settings.enabled, editing, arranging]);
  useEffect(() => {
    if (!canEdit) cancel();
  }, [canEdit]);
  const scale = desktopWidth ? previewWidth / desktopWidth : 1;
  const begin = (
    event: PointerEvent<HTMLButtonElement>,
    group: RailGroup,
    resize = false,
  ) => {
    if (
      !canEdit ||
      locked.includes(group.id) ||
      event.button !== 0 ||
      gesture.current
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(group.id);
    event.currentTarget
      .closest<HTMLElement>(".rail-placement")
      ?.focus({ preventScroll: true });
    const rect = holder.current!.getBoundingClientRect();
    const start = { x: group.x, y: group.y, width: group.width };
    gesture.current = {
      id: group.id,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      start,
      next: start,
      resize,
      target: event.currentTarget,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    event.stopPropagation();
    cancel();
    if (
      !cancelled &&
      JSON.stringify(current.start) !== JSON.stringify(current.next)
    )
      void controller
        .change({ type: "group", id: current.id, ...current.next })
        .catch(() => {});
  };
  if (!controller.loaded || (!controller.settings.enabled && !editing))
    return null;
  return (
    <div
      ref={holder}
      className={`rail-layer${editing ? " rail-layer-editing" : ""}`}
      inert={!interactive}
      aria-label="桌面拾光绳预览"
      onPointerMove={(event) => {
        const current = gesture.current;
        if (!current || current.pointer !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const dx = (event.clientX - current.x) / current.width,
          dy = (event.clientY - current.y) / current.height;
        current.next = current.resize
          ? {
              ...current.start,
              width: Math.max(
                0.2,
                Math.min(1 - current.start.x, current.start.width + dx),
              ),
            }
          : {
              ...current.start,
              x: Math.max(
                0,
                Math.min(1 - current.start.width, current.start.x + dx),
              ),
              y: Math.max(0, Math.min(0.75, current.start.y + dy)),
            };
        setDraft({ id: current.id, ...current.next });
      }}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event, true)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && gesture.current) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      {controller.settings.groups.map((group) => {
        const placement = draft?.id === group.id ? draft : group;
        return (
          <div
            key={group.id}
            className={`rail-placement${selected === group.id ? " rail-placement-selected" : ""}${arranging ? " rail-placement-arranging" : ""}`}
            data-preview-object={arranging ? `rail:${group.id}` : undefined}
            data-selected={(arranging && selected === group.id) || undefined}
            role={arranging ? "group" : undefined}
            tabIndex={arranging ? 0 : undefined}
            aria-label={
              arranging ? `${group.name}位置，拖动或方向键移动` : undefined
            }
            onFocus={(event) => {
              if (arranging && event.target === event.currentTarget)
                onSelect(group.id);
            }}
            onKeyDown={(event) => {
              if (
                !arranging ||
                !canEdit ||
                locked.includes(group.id) ||
                gesture.current ||
                !event.key.startsWith("Arrow")
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              const step = event.shiftKey ? 0.02 : 0.002;
              const resize = (event.target as HTMLElement).classList.contains(
                "rail-placement-resize",
              );
              const dx =
                event.key === "ArrowLeft"
                  ? -step
                  : event.key === "ArrowRight"
                    ? step
                    : 0;
              const dy =
                event.key === "ArrowUp"
                  ? -step
                  : event.key === "ArrowDown"
                    ? step
                    : 0;
              void controller
                .change({
                  type: "group",
                  id: group.id,
                  ...(resize
                    ? {
                        width: Math.max(
                          0.2,
                          Math.min(1 - group.x, group.width + dx),
                        ),
                      }
                    : {
                        x: Math.max(0, Math.min(1 - group.width, group.x + dx)),
                        y: Math.max(0, Math.min(0.75, group.y + dy)),
                      }),
                })
                .catch(() => {});
            }}
            style={
              {
                left: `${placement.x * 100}%`,
                top: `${placement.y * 100}%`,
                width: desktopWidth
                  ? desktopWidth * placement.width
                  : `${placement.width * 100}%`,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                "--rail-preview-inverse": scale > 0 ? 1 / scale : 1,
              } as CSSProperties
            }
          >
            <RailSurface
              active={active}
              layoutWidth={
                desktopWidth ? desktopWidth * placement.width : undefined
              }
              group={group}
              controller={controller}
              selected={selected}
              onSelect={onSelect}
              onDragGroup={begin}
              editing={editing && !arranging && !locked.includes(group.id)}
            />
            {arranging && (
              <>
                <button
                  className="rail-placement-move"
                  aria-label={`移动${group.name}`}
                  tabIndex={-1}
                  disabled={!canEdit || locked.includes(group.id)}
                  onPointerDown={(event) => begin(event, group)}
                />
                <span className="rail-placement-label" aria-hidden="true">
                  {group.name} · 拖动移动
                </span>
                <button
                  className="rail-placement-resize"
                  aria-label={`调整${group.name}宽度`}
                  title="拖动调整宽度；左右方向键微调"
                  disabled={!canEdit || locked.includes(group.id)}
                  onPointerDown={(event) => begin(event, group, true)}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const RailLayer = memo(RailLayerContent);
