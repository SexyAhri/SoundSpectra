import { useLayoutEffect, useRef, useState } from "react";

// Keep only the retiring presentation alive; saved changes take effect at once.
// A new value cancels retirement, including reopening during the exit transition.
export function useRailPresence<T>(value: T | null, duration = 160): T | null {
  const retained = useRef(value);
  // Only finishing an exit needs another render; new content is already visible.
  const [, refresh] = useState(0);
  useLayoutEffect(() => {
    if (value !== null) {
      retained.current = value;
      return;
    }
    const timer = window.setTimeout(() => {
      if (retained.current === null) return;
      retained.current = null;
      refresh((revision) => revision + 1);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [value, duration]);
  return value ?? retained.current;
}
