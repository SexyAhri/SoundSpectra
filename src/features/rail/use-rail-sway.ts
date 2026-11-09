import { useLayoutEffect, useRef, type RefObject } from "react";
import { RailItemPhysics } from "./physics";
import type { RailSkinTheme } from "./skin-theme";
import { railAudioConfig, type RailAudioConfig } from "./audio-config";
import { RailAudioMotion } from "./audio-motion";
import { useRailAudio } from "./use-rail-audio";
import { bindRailCordMotion } from "./rail-cord-motion";
import type { railWheel } from "./rail-wheel";

/** One loop per surface; shared cord displacement, no React or native updates per frame. */
export function useRailSway(
  root: RefObject<HTMLDivElement | null>,
  theme: RailSkinTheme,
  scope: string,
  revision: string,
  enabled: boolean,
  geometry: ReturnType<typeof railWheel>,
  unit: number,
  config?: RailAudioConfig,
) {
  const settings = railAudioConfig(config);
  const source = useRailAudio(
    enabled && settings.enabled && settings.amount > 0,
  );
  const saved = useRef({ scope, items: new Map<string, RailItemPhysics>() });
  useLayoutEffect(() => {
    const host = root.current;
    if (!host) return;
    if (saved.current.scope !== scope)
      saved.current = { scope, items: new Map() };
    const states = saved.current.items;
    const hangings = [
      ...host.querySelectorAll<HTMLElement>(
        ".rail-items > .rail-hanging[data-rail-item]",
      ),
    ];
    const ids = new Set(hangings.map((node) => node.dataset.railItem!));
    for (const id of states.keys()) if (!ids.has(id)) states.delete(id);
    const entries = hangings
      .filter((node) => !node.inert)
      .map((node) => {
        const id = node.dataset.railItem!;
        if (!states.has(id)) states.set(id, new RailItemPhysics(id));
        return {
          node,
          sway: node.querySelector<HTMLElement>(".rail-sway")!,
          state: states.get(id)!,
          x: parseFloat(node.style.getPropertyValue("--wheel-x")),
        };
      });
    const cord = bindRailCordMotion(host, geometry, unit);
    let music = new RailAudioMotion();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const near = new Set<HTMLElement>();
    let frame = 0,
      previous = 0;
    const reset = () => {
      music = new RailAudioMotion();
      cord.reset();
      for (const node of hangings) {
        states.get(node.dataset.railItem!)?.reset();
        node
          .querySelector<HTMLElement>(".rail-sway")
          ?.style.removeProperty("--rail-sway-angle");
        node.style.removeProperty("--rail-audio-drop");
      }
    };
    const tick = (now: number) => {
      const delta = previous ? (now - previous) / 1000 : 0;
      previous = now;
      const paused =
        host.classList.contains("rail-popup-open") ||
        near.size > 0 ||
        entries.some(({ node }) =>
          node.matches(":focus-within, [data-dragging]"),
        ) ||
        !!host.querySelector(".rail-cord-add:hover");
      const impulse = music.update(
        delta,
        settings.enabled ? source.sample(now) : null,
        settings,
        paused,
      );
      const breezePaused = String(paused);
      if (host.dataset.breezePaused !== breezePaused) host.dataset.breezePaused = breezePaused;
      if (settings.enabled) cord.apply(music, settings);
      for (const { node, sway, state, x } of entries) {
        if (impulse > 0 && !paused)
          state.kick(
            impulse * (node.dataset.wheelActive === "true" ? 1 : 0.75),
          );
        state.update(
          delta,
          paused || node.matches(":hover"),
          theme.physics,
          music.level,
        );
        sway.style.setProperty(
          "--rail-sway-angle",
          `${state.angle.toFixed(6)}rad`,
        );
        if (settings.enabled)
          node.style.setProperty(
            "--rail-audio-drop",
            `${cord.offset(x, music, settings).toFixed(3)}px`,
          );
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      reset();
      host.dataset.breezeActive = String(enabled && !document.hidden && !reduced.matches);
      if (
        enabled &&
        !document.hidden &&
        !reduced.matches &&
        (entries.length || settings.enabled)
      )
        frame = requestAnimationFrame(tick);
    };
    const pointer = (event: PointerEvent) => {
      near.clear();
      // Measure only on pointer input, never during the animation loop.
      for (const { node } of entries) {
        const box = node.getBoundingClientRect(),
          pad = 12;
        if (
          event.clientX >= box.left - pad &&
          event.clientX <= box.right + pad &&
          event.clientY >= box.top - pad &&
          event.clientY <= box.bottom + pad
        )
          near.add(node);
      }
    };
    const leave = () => near.clear();
    const release = (event: Event) => {
      if (!enabled || reduced.matches || document.hidden) return;
      const id = (event as CustomEvent<{ id: string }>).detail.id;
      states.get(id)?.kick(0.35);
    };
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    host.addEventListener("pointermove", pointer, { passive: true });
    host.addEventListener("pointerleave", leave);
    host.addEventListener("rail-item-release", release);
    host.dataset.breezeActive = String(enabled && !document.hidden && !reduced.matches);
    if (enabled && !document.hidden && !reduced.matches && (entries.length || settings.enabled))
      frame = requestAnimationFrame(tick);
    else reset();
    return () => {
      cancelAnimationFrame(frame);
      reduced.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      host.removeEventListener("pointermove", pointer);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("rail-item-release", release);
      // Selection changes rebind the physics loop in the same commit. Keep the
      // CSS breeze state until its replacement sets it, avoiding a stop/start
      // animation cycle and an extra layout for every wheel selection.
      cord.reset();
      for (const node of hangings)
        node.style.removeProperty("--rail-audio-drop");
    };
  }, [
    root,
    theme,
    scope,
    revision,
    enabled,
    geometry.path,
    unit,
    settings.enabled,
    settings.profile,
    settings.amount,
    source,
  ]);
}
