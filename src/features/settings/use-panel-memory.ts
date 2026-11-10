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
    const save = () => {
      try {
        sessionStorage.setItem(
          key,
          JSON.stringify({
            top: panes().map((el) => el.scrollTop),
            open: Object.fromEntries(
              details().map((el) => [
                el.querySelector("summary")?.textContent ?? "",
                el.open,
              ]),
            ),
          }),
        );
      } catch {
        /* Optional memory. */
      }
    };
    // Radix mounts the selected tab's contents after its parent's layout
    // effects. Expand details once that content exists, then restore scrolling
    // after the browser lays out the opened content, avoiding bottom clamping.
    const connect = () => {
      restore(true);
      node.addEventListener("scroll", save, true);
      node.addEventListener("toggle", save, true);
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
    };
  }, [scope, root]);
}
