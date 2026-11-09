import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

interface Snapshot {
  node: HTMLElement;
  clone?: HTMLElement;
  left: number;
  top: number;
  width: number;
  height: number;
  parent: HTMLElement;
  presentation?: { opacity: string; translate: string; transform: string };
}

function currentMotion(animation: Animation | undefined) {
  const effect = animation?.effect as KeyframeEffect | null | undefined;
  const frames = effect?.getKeyframes() ?? [];
  const progress = effect?.getComputedTiming().progress ?? 0;
  const first = frames[0],
    last = frames.at(-1);
  const start = String(first?.translate ?? "0 0")
    .split(" ")
    .map((value) => parseFloat(value) || 0);
  const end = String(last?.translate ?? "0 0")
    .split(" ")
    .map((value) => parseFloat(value) || 0);
  return {
    opacity:
      Number(first?.opacity ?? 1) +
      (Number(last?.opacity ?? 1) - Number(first?.opacity ?? 1)) * progress,
    translate: `${(start[0] ?? 0) + ((end[0] ?? 0) - (start[0] ?? 0)) * progress}px ${(start[1] ?? 0) + ((end[1] ?? 0) - (start[1] ?? 0)) * progress}px`,
  };
}

// Animate the presentation after a saved change; never delay persistence or keep
// removed references interactive while their visual copy fades out.
export function useRailMotion(
  root: RefObject<HTMLDivElement | null>,
  selector: string,
  key: "railItem" | "controlItem",
  scope: string,
) {
  const previous = useRef(new Map<string, Snapshot>());
  const active = useRef(new Map<HTMLElement, Animation>());
  const ghosts = useRef(new Set<HTMLElement>());
  const context = useRef<{ scope: string; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!root.current) return;
    const next = new Map<string, Snapshot>();
    for (const node of root.current.querySelectorAll<HTMLElement>(selector)) {
      const id = node.dataset[key];
      if (!id || node.classList.contains("rail-exiting")) continue;
      next.set(id, {
        node,
        left: node.offsetLeft,
        top: node.offsetTop,
        width: node.offsetWidth,
        height: node.offsetHeight,
        parent: node.parentElement!,
      });
    }
    const old = previous.current;
    previous.current = next;
    const priorContext = context.current;
    context.current = { scope, width: root.current.clientWidth };
    if (
      !priorContext ||
      priorContext.scope !== scope ||
      priorContext.width !== root.current.clientWidth ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      for (const animation of active.current.values()) animation.cancel();
      for (const ghost of ghosts.current) ghost.remove();
      active.current.clear();
      ghosts.current.clear();
      return;
    }
    const animate = (
      node: HTMLElement,
      frames: Keyframe[],
      duration: number,
      done?: () => void,
      delay = 0,
    ) => {
      active.current.get(node)?.cancel();
      const animation = node.animate(frames, {
        duration,
        delay,
        fill: "backwards",
        easing: "cubic-bezier(.22,.72,.26,1)",
      });
      active.current.set(node, animation);
      void animation.finished
        .catch(() => {})
        .finally(() => {
          if (active.current.get(node) === animation)
            active.current.delete(node);
          done?.();
          root.current?.dispatchEvent(new Event("rail-motion-end"));
        });
    };
    let entering = 0;
    for (const [id, entry] of next) {
      const before = old.get(id);
      if (!before) {
        animate(
          entry.node,
          [
            {
              opacity: 0,
              translate: key === "railItem" ? "0 -10px" : "0 -5px",
            },
            { opacity: 1, translate: "0 0" },
          ],
          240,
          undefined,
          key === "railItem" ? Math.min(entering++ * 18, 72) : 0,
        );
      } else {
        const dx = before.left - entry.left,
          dy = before.top - entry.top;
        // The wheel already animates its position with a CSS transform. A second FLIP translation
        // fights that interpolation when mounting, rotating, or removing cards.
        if (key !== "railItem" && Math.abs(dx) + Math.abs(dy) > 1) {
          const style = getComputedStyle(entry.node);
          const offset = active.current.has(entry.node)
            ? style.translate.split(" ").map((value) => parseFloat(value) || 0)
            : [];
          animate(
            entry.node,
            [
              {
                translate: `${dx + (offset[0] ?? 0)}px ${dy + (offset[1] ?? 0)}px`,
                opacity: style.opacity,
              },
              { translate: "0 0", opacity: 1 },
            ],
            220,
          );
        }
      }
    }
    for (const [id, before] of old) {
      if (next.has(id) || !before.parent.isConnected) continue;
      const ghost =
        before.clone ?? (before.node.cloneNode(true) as HTMLElement);
      ghost.classList.add("rail-exiting");
      ghost.removeAttribute("data-rail-item");
      ghost.removeAttribute("data-control-item");
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      ghost
        .querySelectorAll("[id]")
        .forEach((node) => node.removeAttribute("id"));
      Object.assign(ghost.style, {
        position: "absolute",
        left: `${before.left}px`,
        top: `${before.top}px`,
        width: `${before.width}px`,
        height: `${before.height}px`,
        margin: "0",
        pointerEvents: "none",
        zIndex: "5",
      });
      if (before.presentation)
        Object.assign(ghost.style, {
          transform: before.presentation.transform,
          transition: "none",
        });
      before.parent.append(ghost);
      ghosts.current.add(ghost);
      const motion =
        before.presentation ?? currentMotion(active.current.get(before.node));
      active.current.get(before.node)?.cancel();
      animate(ghost, [motion, { opacity: 0, translate: "0 8px" }], 160, () => {
        ghost.remove();
        ghosts.current.delete(ghost);
      });
    }
  });
  useEffect(
    () => () => {
      for (const animation of active.current.values()) animation.cancel();
      for (const ghost of ghosts.current) ghost.remove();
      active.current.clear();
      ghosts.current.clear();
      previous.current.clear();
      context.current = null;
    },
    [],
  );
  return (remaining: readonly string[]) => {
    const ids = new Set(remaining);
    for (const [id, snapshot] of previous.current) {
      if (ids.has(id) || !snapshot.node.isConnected) continue;
      const style = getComputedStyle(snapshot.node);
      snapshot.left = parseFloat(style.left) || snapshot.node.offsetLeft;
      snapshot.top = parseFloat(style.top) || snapshot.node.offsetTop;
      snapshot.clone = snapshot.node.cloneNode(true) as HTMLElement;
      snapshot.presentation = {
        opacity: style.opacity,
        translate: style.translate,
        transform: style.transform,
      };
      // Cloning restarts CSS wind at its initial phase. Preserve the visible
      // angle so an exiting card does not flick sideways as it fades.
      const sway = snapshot.node.querySelector<HTMLElement>(".rail-sway");
      const copy = snapshot.clone.querySelector<HTMLElement>(".rail-sway");
      if (sway && copy)
        Object.assign(copy.style, {
          animation: "none",
          transform: getComputedStyle(sway).transform,
        });
    }
  };
}
