import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { activeLine, type LyricLine } from "../lyrics/model";
import type { Playback } from "./types";

/** Bridge native checkpoints without rendering the lyric list on every animation frame. */
export function useLyricActive(lines: LyricLine[], playback: Playback) {
  const {
    position,
    playing,
    phase,
    suspended,
    seeking,
    generation,
    globalLyricOffset = 0,
  } = playback;
  const [active, setActive] = useState(() =>
    activeLine(lines, (position + globalLyricOffset) * 1000),
  );
  useEffect(() => {
    const at = performance.now();
    const advancing = playing && !suspended && !seeking && phase === "playing";
    const tick = () => {
      // Freeze if native feedback stops arriving, rather than drifting indefinitely.
      const elapsed = advancing
        ? Math.min(900, performance.now() - at) / 1000
        : 0;
      setActive(
        activeLine(lines, (position + elapsed + globalLyricOffset) * 1000),
      );
    };
    tick();
    if (!advancing || !lines.length) return;
    const timer = setInterval(tick, 50);
    return () => clearInterval(timer);
  }, [
    lines,
    position,
    playing,
    phase,
    suspended,
    seeking,
    generation,
    globalLyricOffset,
  ]);
  return active;
}

/** Keep the current sentence centered; user input cancels the animation immediately. */
export function useLyricFollow(
  body: RefObject<HTMLDivElement | null>,
  active: number,
  identity: string,
  content: unknown,
) {
  const [browsing, setBrowsing] = useState(false);
  const frame = useRef(0);
  const positioned = useRef<string | null>(null);
  const cancel = useCallback(() => cancelAnimationFrame(frame.current), []);
  const browse = useCallback(() => {
    cancel();
    setBrowsing(true);
  }, [cancel]);
  const resume = useCallback(() => setBrowsing(false), []);

  useEffect(() => setBrowsing(false), [identity]);
  useLayoutEffect(() => {
    const root = body.current;
    if (!root) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const follow = () => {
      cancel();
      root.style.setProperty(
        "--lyric-space",
        `${Math.max(20, root.clientHeight / 2 - 26)}px`,
      );
      const line = root.querySelector<HTMLElement>('[aria-current="true"]');
      if (!line || browsing) return;
      const target = Math.max(
        0,
        Math.min(
          root.scrollHeight - root.clientHeight,
          line.offsetTop - root.clientHeight / 2 + line.offsetHeight / 2,
        ),
      );
      const start = root.scrollTop;
      const initial = positioned.current !== identity;
      positioned.current = identity;
      if (initial || reduced.matches || Math.abs(target - start) < 1) {
        root.scrollTop = target;
        return;
      }
      const began = performance.now();
      const animate = (now: number) => {
        const progress = Math.min(1, (now - began) / 520);
        root.scrollTop = start + (target - start) * (1 - (1 - progress) ** 4);
        if (progress < 1) frame.current = requestAnimationFrame(animate);
      };
      frame.current = requestAnimationFrame(animate);
    };
    follow();
    const resize = new ResizeObserver(follow);
    resize.observe(root, { box: "border-box" });
    reduced.addEventListener("change", follow);
    return () => {
      cancel();
      resize.disconnect();
      reduced.removeEventListener("change", follow);
    };
  }, [body, active, identity, content, browsing, cancel]);
  return { browsing, browse, resume };
}
