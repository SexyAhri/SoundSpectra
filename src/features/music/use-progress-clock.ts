import { useLayoutEffect, useRef, useState } from "react";
import type { Playback } from "./types";

/** Interpolate native checkpoints locally; never send the display clock to audio. */
export function useProgressClock(p: Playback, override: number | null) {
  const [position, setPosition] = useState(p.position);
  const displayed = useRef(p.position);
  const identity = `${p.generation}:${p.seekRevision}`;
  const previous = useRef(identity);
  useLayoutEffect(() => {
    let frame = 0;
    const start = () => {
      cancelAnimationFrame(frame);
      const advancing = override === null && p.playing && !p.suspended &&
        !p.seeking && p.phase === "playing";
      const target = override ?? p.position;
      const continuous = advancing && previous.current === identity &&
        Math.abs(displayed.current - target) < 1;
      previous.current = identity;
      const initial = continuous ? Math.max(target, displayed.current) : target;
      const began = performance.now();
      const paint = (value: number) => {
        displayed.current = Math.max(0, Math.min(p.duration || Infinity, value));
        setPosition(displayed.current);
      };
      paint(initial);
      if (!advancing) return;
      const tick = (now: number) => {
        const elapsed = Math.min(900, now - began);
        // Ease small checkpoint corrections without stepping backwards. Stop
        // extrapolating when native feedback is stale, including a stalled IPC.
        const correction = (initial - target) * Math.max(0, 1 - elapsed / 180);
        paint(Math.max(displayed.current, target + elapsed / 1000 + correction));
        if (elapsed < 900) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    start();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [p.position, p.duration, p.playing, p.suspended, p.seeking, p.phase, identity, override]);
  return position;
}
