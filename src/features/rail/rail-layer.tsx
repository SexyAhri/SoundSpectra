import { useRef, useState, type PointerEvent } from "react";
import { RailSurface } from "./rail-surface";
import type { RailGroup } from "./model";
import type { RailController } from "./use-rail";
export function RailLayer({
  controller,
  selected,
  editing,
  interactive = true,
  onSelect,
}: {
  controller: RailController;
  selected: string | null;
  editing: boolean;
  interactive?: boolean;
  onSelect: (groupId: string, itemId?: string) => void;
}) {
  const holder = useRef<HTMLDivElement>(null),
    [draft, setDraft] = useState<{ id: string; x: number; y: number } | null>(
      null,
    );
  const gesture = useRef<{
    id: string;
    pointer: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
    groupWidth: number;
    nextX: number;
    nextY: number;
  } | null>(null);
  const begin = (event: PointerEvent<HTMLButtonElement>, group: RailGroup) => {
    if (!editing || !interactive || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(group.id);
    const bounds = holder.current!.getBoundingClientRect();
    gesture.current = {
      id: group.id,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: group.x,
      startY: group.y,
      width: bounds.width,
      height: bounds.height,
      groupWidth: group.width,
      nextX: group.x,
      nextY: group.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    gesture.current = null;
    setDraft(null);
    if (!cancel)
      void controller
        .change({
          type: "group",
          id: current.id,
          x: current.nextX,
          y: current.nextY,
        })
        .catch(() => {});
  };
  if (!controller.loaded || (!controller.settings.enabled && !editing)) return null;
  return (
    <div
      ref={holder}
      className={`rail-layer${editing ? " rail-layer-editing" : ""}`}
      inert={!interactive}
      aria-label="桌面晾衣绳预览"
      onPointerMove={(event) => {
        const current = gesture.current;
        if (!current || current.pointer !== event.pointerId) return;
        current.nextX = Math.max(
          0,
          Math.min(
            1 - current.groupWidth,
            current.startX + (event.clientX - current.x) / current.width,
          ),
        );
        current.nextY = Math.max(
          0,
          Math.min(
            0.75,
            current.startY + (event.clientY - current.y) / current.height,
          ),
        );
        setDraft({ id: current.id, x: current.nextX, y: current.nextY });
      }}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event, true)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          gesture.current = null;
          setDraft(null);
        }
      }}
    >
      {controller.settings.groups.map((group) => (
        <div
          key={group.id}
          className={`rail-placement${selected === group.id ? " rail-placement-selected" : ""}`}
          style={{
            left: `${(draft?.id === group.id ? draft.x : group.x) * 100}%`,
            top: `${(draft?.id === group.id ? draft.y : group.y) * 100}%`,
            width: `${group.width * 100}%`,
          }}
        >
          <RailSurface
            group={group}
            controller={controller}
            selected={selected}
            onSelect={onSelect}
            onDragGroup={begin}
            editing={editing}
          />
        </div>
      ))}
    </div>
  );
}
