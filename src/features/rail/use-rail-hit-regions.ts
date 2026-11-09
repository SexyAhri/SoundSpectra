import { useLayoutEffect, useRef, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { railSkin, type RailGroup } from "./model";
import type { railWheel } from "./rail-wheel";
import { botanicalSprigs } from "./rail-botanical-layout";
import { railFloralLayout } from "./rail-floral-layout";
import { getRailSkinTheme } from "./skin-theme";
import { railAudioTravel } from "./audio-motion";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
type Geometry = ReturnType<typeof railWheel>;

function envelope(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

// The native region clips pixels as well as mouse input. Keep the whole swept
// area available during a transition, then tighten it after the motion ends.
export function useRailHitRegions(
  root: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  group: RailGroup,
  geometry: Geometry,
  active: number,
  unit: number,
  bodyPresent: boolean,
  popupMode: string | undefined,
  report: (error: string) => void,
) {
  const previous = useRef(new Map<string, Rect>());
  const pending = useRef(Promise.resolve());
  useLayoutEffect(() => {
    const host = root.current;
    if (!enabled || !host) return;
    let disposed = false;
    const dpi = window.devicePixelRatio;
    const theme = getRailSkinTheme(group.skin);
    const publish = (regions: Rect[]) => {
      // Serialize updates so a slow native call cannot restore an older region.
      pending.current = pending.current
        .catch(() => {})
        .then(async () => {
          if (disposed) return;
          await invoke("rail_hit_regions", {
            regions: regions.map((rect) => ({
              x: rect.x * dpi,
              y: rect.y * dpi,
              width: rect.width * dpi,
              height: rect.height * dpi,
            })),
          });
        })
        .catch((error) => {
          if (!disposed) report(String(error));
        });
    };
    const measure = (moving: boolean) => {
      if (disposed) return;
      const box = host.getBoundingClientRect();
      const regions: Rect[] = [];
      const bounds = (element: Element, pad: number): Rect => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x - box.x - pad,
          y: rect.y - box.y - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
        };
      };
      for (const element of host.querySelectorAll(
        ".rail-header button, .rail-empty, .rail-popup, .rail-inline-notice",
      )) {
        if (!element.closest("[inert]")) regions.push(bounds(element, 6));
      }
      const next = new Map<string, Rect>();
      for (const element of host.querySelectorAll<HTMLElement>(
        ".rail-items > .rail-hanging",
      )) {
        const id = element.dataset.railItem;
        const index = group.items.findIndex((item) => item.id === id);
        if (index < 0) {
          if (moving && element.classList.contains("rail-exiting"))
            regions.push(bounds(element, 24));
          continue;
        }
        const slot = geometry.slot(index, active);
        // Include the clip, rotation, shadows and hover affordances. The target
        // uses layout coordinates, which are not delayed by CSS interpolation.
        const musicPad = group.audioSync?.enabled ? railAudioTravel * unit : 0;
        const swayPad =
          Math.sin(theme.physics.maxAngle) *
          (element.offsetHeight + Math.abs(theme.clipStyle.offsetY) * unit);
        const target: Rect = {
          x: slot.x - element.offsetWidth / 2 - 24 * unit - swayPad,
          y: 28 + slot.y - 26 * unit - musicPad,
          width: element.offsetWidth + 48 * unit + swayPad * 2,
          height: element.offsetHeight + 50 * unit + musicPad * 2,
        };
        if (slot.visible && bodyPresent) next.set(id!, target);
        const before = previous.current.get(id!);
        // An interrupted turn can be between the last settled position and an
        // abandoned destination. Include that actual position when reversing,
        // without sending a new native region on every animation frame.
        if (moving && before)
          regions.push(
            envelope(envelope(before, target), bounds(element, 24 * unit)),
          );
        else if (slot.visible && bodyPresent)
          regions.push(
            moving ? envelope(bounds(element, 24 * unit), target) : target,
          );
      }
      if (bodyPresent) {
        // Include hanging flowers locally, leaving gaps available to the desktop.
        const attachments = group.items
          .map((_, index) => geometry.slot(index, active))
          .filter((slot) => slot.visible)
          .map((slot) => slot.x);
        const floral = railFloralLayout(unit, geometry, attachments, theme);
        const sprigs =
          theme.decoration.type === "floral"
            ? [...floral.flowers, ...floral.leaves].map((x) => geometry.atX(x))
            : botanicalSprigs(
                railSkin(group.skin),
                unit,
                geometry,
                attachments,
              );
        for (const sprig of sprigs) {
          const bounds = theme.decoration.bounds;
          const extra = group.audioSync?.enabled ? railAudioTravel : 0;
          regions.push({
            x: sprig.x - bounds.left * unit,
            y: 28 + sprig.y - (bounds.top + extra) * unit,
            width: (bounds.left + bounds.right) * unit,
            height: (bounds.top + bounds.bottom + extra * 2) * unit,
          });
        }
        // Each strip spans both neighboring points, so widening the window
        // cannot leave holes between samples. This also fits the native limit.
        const segments = 96,
          pad = Math.max(
            10,
            (theme.decoration.cordPadding +
              (group.audioSync?.enabled ? railAudioTravel : 0)) *
              unit,
          );
        for (let i = 0; i < segments; i++) {
          const a = geometry.point(
            -geometry.half + (i / segments) * geometry.half * 2,
          );
          const b = geometry.point(
            -geometry.half + ((i + 1) / segments) * geometry.half * 2,
          );
          regions.push({
            x: a.x - pad,
            y: 28 + Math.min(a.y, b.y) - pad,
            width: b.x - a.x + pad * 2,
            height: Math.abs(b.y - a.y) + pad * 2,
          });
        }
      }
      if (!moving) previous.current = next;
      publish(regions);
    };
    let waitingForMotion = false;
    const settle = () => {
      if (disposed || waitingForMotion) return;
      const running = host
        .getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation.playState === "running" &&
            animation.effect?.getComputedTiming().iterations !== Infinity,
        );
      if (running.length) {
        waitingForMotion = true;
        void Promise.all(
          running.map((animation) => animation.finished.catch(() => {})),
        ).then(() => {
          waitingForMotion = false;
          settle();
        });
        return;
      }
      measure(false);
    };
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    measure(!reduced && previous.current.size > 0 && bodyPresent);
    const settled = window.setTimeout(settle, reduced ? 0 : 440);
    const observer = new ResizeObserver(() =>
      measure(!reduced && previous.current.size > 0),
    );
    observer.observe(host);
    const panel = host.querySelector(".rail-popup");
    if (panel) observer.observe(panel);
    host.addEventListener("rail-motion-end", settle);
    return () => {
      disposed = true;
      clearTimeout(settled);
      observer.disconnect();
      host.removeEventListener("rail-motion-end", settle);
    };
  }, [
    enabled,
    group,
    geometry.path,
    geometry.step,
    active,
    unit,
    bodyPresent,
    popupMode,
    report,
  ]);
}
