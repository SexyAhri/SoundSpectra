import { flushSync } from "react-dom";

const pending = new Map<string, { cancel: () => void }>();

/** Fade the outgoing view before committing a user-requested content switch.
 * Keep one live React tree, and let the newest navigation win during a fade. */
export function fadeUpdate(
  selector: string,
  update: () => void,
  scope = selector,
) {
  const element = document.querySelector<HTMLElement>(selector);
  const opacity = element ? getComputedStyle(element).opacity : "1";
  pending.get(scope)?.cancel();
  if (
    !element ||
    !element.animate ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    update();
    return;
  }
  let cancelled = false;
  let animation: Animation;
  const task = {
    cancel: () => {
      cancelled = true;
      animation?.cancel();
      pending.delete(scope);
    },
  };
  pending.set(scope, task);
  animation = element.animate([{ opacity }, { opacity: 0 }], {
    duration: 60,
    easing: "ease-out",
    fill: "forwards",
  });
  void (async () => {
    try {
      await animation.finished;
      if (cancelled || !element.isConnected) return;
      flushSync(update);
      animation.cancel();
      const next = document.querySelector<HTMLElement>(selector);
      if (next) {
        animation = next.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 120,
          easing: "ease-out",
        });
        await animation.finished;
      }
    } catch (error) {
      if (
        !cancelled &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        throw error;
    } finally {
      if (pending.get(scope) === task) pending.delete(scope);
    }
  })();
}
