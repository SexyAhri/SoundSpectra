import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type { RailChange, RailGroup } from "./model";

// Keep local reordering separate from WebView2's native file-drop handler.
export function useRailReorder(
  groups: RailGroup[],
  move: (change: RailChange) => void,
  dragOut?: (id: string) => Promise<unknown>,
  detach?: (id: string) => Promise<unknown>,
) {
  const gesture = useRef<{
    id: string;
    pointer: number;
    x: number;
    y: number;
    source: HTMLElement;
    dragging: boolean;
    fromList: boolean;
    clientX: number;
    clientY: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const exporting = useRef(false);
  const [target, setTarget] = useState<string | null>(null);
  const [side, setSide] = useState<"before" | "after" | null>(null);
  const [detaching, setDetaching] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const cancel = () => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.dragging)
      current.source.dispatchEvent(
        new CustomEvent("rail-item-release", {
          bubbles: true,
          detail: { id: current.id },
        }),
      );
    if (current?.source.hasPointerCapture(current.pointer))
      current.source.releasePointerCapture(current.pointer);
    setTarget(null);
    setSide(null);
    setDetaching(null);
    setDragging(null);
  };
  useEffect(() => {
    // Pointer capture does not transfer keyboard focus. Escape must also work
    // when the drag started while another field/window surface held focus.
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault();
        cancel();
      }
    };
    const visibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", visibility);
      cancel();
    };
  }, []);
  const destination = (event: { clientX: number; clientY: number }) => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (element?.closest(".rail-popup:not(.rail-popup-more)")) return null;
    let container = element?.closest<HTMLElement>(
      ".rail-overflow-items, .rail-body",
    );
    // The transparent space around the cord deliberately passes normal clicks
    // through to the desktop. Pointer capture still lets a drag land in its gaps.
    if (
      !container &&
      !element?.closest(".rail-popup") &&
      !gesture.current?.fromList
    ) {
      container = [
        ...document.querySelectorAll<HTMLElement>(".rail-body:not([inert])"),
      ].find((body) => {
        const box = body.getBoundingClientRect();
        return (
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom
        );
      });
    }
    if (!container) return null;
    const group = groups.find(
      (value) =>
        value.id ===
        container.closest<HTMLElement>("[data-rail-group]")?.dataset.railGroup,
    );
    if (!group) return null;
    // Include gaps between cards, but ignore clipped/offscreen slots. In a grid,
    // prefer the row under the pointer before comparing horizontal distances.
    const candidates = [
      ...container.querySelectorAll<HTMLElement>(
        "[data-rail-list-item], [data-rail-item]:not([inert])",
      ),
    ]
      .map((node) => ({ node, box: node.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0);
    const grid = container.matches(".rail-overflow-items");
    const distance = ({ box }: (typeof candidates)[number]) => {
      const dx = Math.max(
        box.left - event.clientX,
        0,
        event.clientX - box.right,
      );
      const dy = Math.max(
        box.top - event.clientY,
        0,
        event.clientY - box.bottom,
      );
      return grid ? dy * 10000 + dx : dx;
    };
    const nearest = candidates.sort((a, b) => distance(a) - distance(b))[0];
    if (!nearest)
      return group.items.length
        ? null
        : { group, item: undefined, side: null, index: 0 };
    const item =
      nearest.node.dataset.railListItem ?? nearest.node.dataset.railItem;
    const index = group.items.findIndex((value) => value.id === item);
    if (index < 0) return null;
    const side =
      event.clientX >= nearest.box.left + nearest.box.width / 2
        ? "after"
        : "before";
    const boundary = index + (side === "after" ? 1 : 0);
    const sourceIndex = group.items.findIndex(
      (value) => value.id === gesture.current?.id,
    );
    // The move command takes an index in the array AFTER removing the source.
    const insertion =
      boundary - (sourceIndex >= 0 && sourceIndex < boundary ? 1 : 0);
    return { group, item, side, index: insertion } as const;
  };
  const mark = (next: ReturnType<typeof destination>) => {
    setTarget(next?.item ?? null);
    setSide(next?.side ?? null);
  };
  useEffect(() => {
    if (!dragging || !gesture.current?.fromList) return;
    let frame = 0,
      last = performance.now();
    const scroll = (now: number) => {
      const current = gesture.current;
      const list = current?.source.closest<HTMLElement>(".rail-overflow-items");
      if (!current || !list) return;
      const box = list.getBoundingClientRect();
      const elapsed = Math.min(32, now - last);
      last = now;
      if (
        current.clientX >= box.left &&
        current.clientX <= box.right &&
        current.clientY >= box.top &&
        current.clientY <= box.bottom
      ) {
        const edge = 28;
        const speed =
          current.clientY < box.top + edge
            ? -1
            : current.clientY > box.bottom - edge
              ? 1
              : 0;
        if (speed) {
          list.scrollTop += speed * elapsed * 0.45;
          mark(destination(current));
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [dragging, groups]);
  const preventClick = (event: MouseEvent) => {
    if (!suppressClick.current || event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
  };
  return {
    target,
    side,
    dragging,
    detaching,
    events: {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || !event.isPrimary || exporting.current) return;
        suppressClick.current = false;
        const source = (event.target as Element).closest<HTMLElement>(
          ".rail-item, .rail-overflow-entry",
        );
        const id =
          source?.dataset.railListItem ??
          source?.closest<HTMLElement>("[data-rail-item]")?.dataset.railItem;
        if (source && id)
          gesture.current = {
            id,
            source,
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            dragging: false,
            fromList: source.matches(".rail-overflow-entry"),
            clientX: event.clientX,
            clientY: event.clientY,
          };
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const current = gesture.current;
        if (!current || current.pointer !== event.pointerId) return;
        current.clientX = event.clientX;
        current.clientY = event.clientY;
        if (!(event.buttons & 1)) {
          cancel();
          return;
        }
        if (
          !current.dragging &&
          Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6
        )
          return;
        if (!current.dragging) {
          current.dragging = true;
          suppressClick.current = true;
          setDragging(current.id);
          current.source.setPointerCapture(current.pointer);
        }
        event.preventDefault();
        const next = destination(event);
        const item = groups
          .flatMap((group) => group.items)
          .find((item) => item.id === current.id);
        if (current.fromList) {
          const panel = current.source
            .closest(".rail-popup-more")
            ?.getBoundingClientRect();
          const outside =
            panel &&
            (event.clientX < panel.left - 8 ||
              event.clientX > panel.right + 8 ||
              event.clientY < panel.top - 8 ||
              event.clientY > panel.bottom + 8);
          setDetaching(outside && item ? current.id : null);
          mark(outside ? null : next);
          return;
        }
        const surface = current.source.closest(".rail-surface");
        const box = surface?.getBoundingClientRect();
        // Keep sorting inside the rail. Handoff only after crossing its bounds,
        // and leave cross-group moves local. Notes export through a text file.
        const outside =
          box &&
          (event.clientX < box.left - 12 ||
            event.clientX > box.right + 12 ||
            event.clientY < box.top - 12 ||
            event.clientY > box.bottom + 12);
        if (dragOut && item && !next && outside) {
          exporting.current = true;
          cancel();
          void dragOut(current.id).finally(() => {
            exporting.current = false;
          });
          return;
        }
        mark(next);
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        const current = gesture.current;
        if (!current || current.pointer !== event.pointerId) return;
        const next = current.dragging ? destination(event) : null;
        const panel =
          current.fromList &&
          current.source.closest(".rail-popup-more")?.getBoundingClientRect();
        const outside =
          panel &&
          (event.clientX < panel.left - 8 ||
            event.clientX > panel.right + 8 ||
            event.clientY < panel.top - 8 ||
            event.clientY > panel.bottom + 8);
        const item = groups
          .flatMap((group) => group.items)
          .find((item) => item.id === current.id);
        cancel();
        if (current.dragging && outside && detach && item) {
          void detach(current.id);
          return;
        }
        if (
          next &&
          next.index !==
            next.group.items.findIndex((item) => item.id === current.id)
        )
          move({
            type: "move",
            id: current.id,
            groupId: next.group.id,
            index: next.index,
          });
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === "Escape") cancel();
      },
      onClickCapture: preventClick,
      onDoubleClickCapture: preventClick,
    },
  };
}
