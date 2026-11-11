import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { SpectrumSettings } from "../spectrum/model";

/** Keep one renderer alive while a new composition settles into view. */
export function useSceneTransition(
  requested: SpectrumSettings,
  enabled: boolean,
  surface: RefObject<HTMLDivElement | null>,
) {
  const key = useMemo(() => JSON.stringify(requested), [requested]);
  const shown = useRef({ key, settings: requested });
  const [, refresh] = useState(0);
  useLayoutEffect(() => {
    const node = surface.current;
    if (!enabled || !node?.animate) {
      // Direct editing already renders the request. Remember its committed
      // baseline for reentry without scheduling a second React commit.
      shown.current = { key, settings: requested };
      return;
    }
    if (shown.current.key === key) return;
    let cancelled = false;
    let frame = 0;
    let timer = 0;
    let animation = node.animate(
      [{ opacity: getComputedStyle(node).opacity }, { opacity: 0.25 }],
      { duration: 100, easing: "ease-out", fill: "forwards" },
    );
    node.dataset.sceneTransition = "outgoing";
    void Promise.race([
      animation.finished,
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, 140);
      }),
    ])
      .then(() => {
        if (cancelled || !node.isConnected) return;
        shown.current = { key, settings: requested };
        refresh((revision) => revision + 1);
        // React commits the new composition before its incoming paint.
        frame = requestAnimationFrame(() => {
          if (cancelled) return;
          animation.cancel();
          node.dataset.sceneTransition = "incoming";
          animation = node.animate([{ opacity: 0.25 }, { opacity: 1 }], {
            duration: 280,
            easing: "cubic-bezier(.2,.7,.2,1)",
          });
          void animation.finished
            .then(() => {
              if (!cancelled) delete node.dataset.sceneTransition;
            })
            .catch(() => {});
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      animation.cancel();
      delete node.dataset.sceneTransition;
    };
    // The request owns its entire fade, including the state update it schedules.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, surface]);
  return enabled && surface.current?.animate
    ? shown.current.settings
    : requested;
}
