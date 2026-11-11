import { useLayoutEffect, type RefObject } from "react";

/** Restore presentation state only; it never stores application settings or credentials. */
export function usePanelMemory(
  root: RefObject<HTMLElement | null>,
  scope: string,
) {
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const key = `soundspectra.panel-memory.${scope}`;
    const panes = () => [
      node,
      ...node.querySelectorAll<HTMLElement>(
        ".inspector-scroll, .rail-settings-panel",
      ),
    ];
    const details = () => [
      ...node.querySelectorAll<HTMLDetailsElement>("details"),
    ];
    const restore = (scroll = false) => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
        if (saved && typeof saved === "object") {
          details().forEach((el) => {
            const label = el.querySelector("summary")?.textContent ?? "";
            if (
              typeof saved.open?.[label] === "boolean" &&
              el.open !== saved.open[label]
            )
              el.open = saved.open[label];
          });
          if (scroll)
            panes().forEach((el, i) => {
              if (Number.isFinite(saved.top?.[i]))
                el.scrollTop = Math.max(0, saved.top[i]);
            });
        }
      } catch {
        /* Malformed optional memory must not affect editing. */
      }
    };
    let previous = "";
    try {
      previous = sessionStorage.getItem(key) ?? "";
    } catch {
      /* Optional memory. */
    }
    let saveFrame = 0;
    let pending: {
      panes: HTMLElement[];
      value: { top: number[]; open: Record<string, boolean> };
    } | null = null;
    const persist = () => {
      saveFrame = 0;
      const snapshot = pending;
      pending = null;
      if (!snapshot) return;
      try {
        const next = JSON.stringify(snapshot.value);
        if (next === previous) return;
        sessionStorage.setItem(key, next);
        previous = next;
      } catch {
        /* Optional memory. */
      }
    };
    const flush = () => {
      cancelAnimationFrame(saveFrame);
      persist();
    };
    const save = (event: Event) => {
      // Capture the old page's values before React can replace its tab content.
      // Further events in this frame update only their own target.
      if (!pending) {
        const elements = panes();
        pending = {
          panes: elements,
          value: {
            top: elements.map((el) => el.scrollTop),
            open: Object.fromEntries(
              details().map((el) => [
                el.querySelector("summary")?.textContent ?? "",
                el.open,
              ]),
            ),
          },
        };
      } else if (event.type === "scroll") {
        const index = pending.panes.indexOf(event.target as HTMLElement);
        if (index >= 0)
          pending.value.top[index] = pending.panes[index].scrollTop;
      } else if (event.target instanceof HTMLDetailsElement) {
        const detail = event.target;
        const label = detail.querySelector("summary")?.textContent ?? "";
        pending.value.open[label] = detail.open;
      }
      if (!saveFrame) saveFrame = requestAnimationFrame(persist);
    };
    // Radix mounts the selected tab's contents after its parent's layout
    // effects. Expand details once that content exists, then restore scrolling
    // after the browser lays out the opened content, avoiding bottom clamping.
    const connect = () => {
      restore(true);
      node.addEventListener("scroll", save, true);
      node.addEventListener("toggle", save, true);
      window.addEventListener("pagehide", flush);
    };
    let disposed = false;
    let frame = 0;
    queueMicrotask(() => {
      if (disposed) return;
      restore();
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(connect);
      });
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      node.removeEventListener("scroll", save, true);
      node.removeEventListener("toggle", save, true);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [scope, root]);
}
