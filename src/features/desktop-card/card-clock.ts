import { useLayoutEffect, useRef, type RefObject } from "react";
import { playbackPosition } from "../lyrics/model";
import type { NowPlaying } from "./use-now-playing";

export const cardPosition = (info: NowPlaying, now: number) =>
  info.issue ||
  info.playbackAvailable === false ||
  info.duration <= 0 ||
  ![info.position, info.duration, info.updated, now].every(Number.isFinite) ||
  info.updated > now + 2000
    ? null
    : playbackPosition(
        {
          ...info,
          timelineAvailable: info.timelineAvailable ?? info.duration > 0,
        },
        now,
      );
const stamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function useCardClock(
  info: NowPlaying,
  root: RefObject<HTMLElement | null>,
  active: boolean,
  desktop: boolean,
  demo: boolean,
  layout: string,
) {
  const current = useRef(info);
  const refresh = useRef<(() => void) | undefined>(undefined);
  current.current = info;
  useLayoutEffect(() => {
    const article = root.current;
    if (!article || !active) return;
    // These nodes only change when the card layout changes, not on media polls.
    const progress = article.querySelector<HTMLElement>(".mc-progress");
    const fill = article.querySelector<HTMLElement>(".mc-progress-fill");
    const arc = article.querySelector<SVGPathElement>(".mc-arc-fill");
    const clock = article.querySelector<HTMLElement>(".mc-time");
    let frame = 0,
      timer = 0,
      last = 0,
      visible = true;
    const publish = () => {
      const value = current.current;
      const position = demo ? null : cardPosition(value, Date.now());
      const timeline = position === null ? "unavailable" : "available";
      if (article.dataset.timeline !== timeline)
        article.dataset.timeline = timeline;
      if (position !== null && progress && fill) {
        const transform = `scaleX(${Number((position / 1000 / value.duration).toFixed(6))})`;
        if (fill.style.transform !== transform)
          fill.style.transform = transform;
        if (arc) {
          const offset = String(
            Number(
              (
                1 - Math.max(0, Math.min(1, position / 1000 / value.duration))
              ).toFixed(6),
            ),
          );
          if (arc.style.strokeDashoffset !== offset)
            arc.style.strokeDashoffset = offset;
        }
        const seconds = Math.floor(position / 1000);
        const label = `${stamp(seconds)} / ${stamp(value.duration)}`;
        if (clock && clock.textContent !== label) clock.textContent = label;
        const next = String(seconds);
        if (progress.getAttribute("aria-valuenow") !== next)
          progress.setAttribute("aria-valuenow", next);
        const maximum = String(Math.round(value.duration));
        if (progress.getAttribute("aria-valuemax") !== maximum)
          progress.setAttribute("aria-valuemax", maximum);
      }
      return position !== null && value.playing;
    };
    const tick = (now: number) => {
      if (!visible || (!desktop && document.hidden)) return;
      if (now - last >= 1000 / 30) {
        last = now;
        if (!publish()) return;
      }
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      const hidden = !desktop && document.hidden;
      if (article.dataset.hidden !== String(hidden))
        article.dataset.hidden = String(hidden);
      if (!visible || hidden) return;
      const running = publish();
      // A media correction already painted this instant; do not immediately
      // repeat it on the next RAF before the normal 30 Hz cadence is due.
      last = performance.now();
      if (running) frame = requestAnimationFrame(tick);
      else if (!current.current.playing && current.current.updated)
        timer = window.setTimeout(
          publish,
          Math.max(0, 4001 - (Date.now() - current.current.updated)),
        );
    };
    const observer = new IntersectionObserver((entries) => {
      const next = entries[0]?.isIntersecting ?? true;
      const changed = next !== visible;
      visible = next;
      if (article.dataset.visible !== String(visible))
        article.dataset.visible = String(visible);
      if (changed) start();
    });
    observer.observe(article);
    document.addEventListener("visibilitychange", start);
    refresh.current = start;
    return () => {
      refresh.current = undefined;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", start);
    };
  }, [active, desktop, demo, root, layout]);
  // Pause, seek and fresh observations still apply in the same React commit.
  // Only the clock's input changes; its observer and DOM nodes stay in place.
  useLayoutEffect(() => {
    refresh.current?.();
  }, [info, active, desktop, demo, root, layout]);
}
