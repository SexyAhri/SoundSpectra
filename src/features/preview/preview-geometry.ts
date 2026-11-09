import type { SpectrumSettings } from "../spectrum/model";
export type Bounds = SpectrumSettings["bounds"];
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
export function moveBounds(start: Bounds, dx: number, dy: number): Bounds {
  return {
    ...start,
    x: clamp(start.x + dx, 0, 1 - start.width),
    y: clamp(start.y + dy, 0, 1 - start.height),
  };
}
export function resizeBounds(start: Bounds, dx: number, dy: number): Bounds {
  const cx = start.x + start.width / 2,
    cy = start.y + start.height / 2;
  const width = clamp(
    start.width + dx * 2,
    0.2,
    Math.min(1, 2 * Math.min(cx, 1 - cx)),
  );
  const height = clamp(
    start.height + dy * 2,
    0.08,
    Math.min(1, 2 * Math.min(cy, 1 - cy)),
  );
  return {
    x: Math.max(0, cx - width / 2),
    y: Math.max(0, cy - height / 2),
    width,
    height,
  };
}

/** Snap in screen pixels so the threshold stays usable at every preview size. */
export function snapBounds(
  bounds: Bounds,
  width: number,
  height: number,
  targets: Bounds[] = [],
) {
  const snapAxis = (
    start: number,
    extent: number,
    size: number,
    guides: number[],
  ) => {
    const anchors = [0, extent / 2, extent];
    let distance = Math.min(0.02, 6 / Math.max(1, size)),
      result = start,
      guide: number | null = null;
    for (const target of guides)
      for (const anchor of anchors) {
        const next = target - anchor,
          delta = Math.abs(next - start);
        if (next >= 0 && next <= 1 - extent && delta < distance) {
          distance = delta;
          result = next;
          guide = target;
        }
      }
    return { value: result, guide };
  };
  const x = snapAxis(bounds.x, bounds.width, width, [
    0,
    0.5,
    1,
    ...targets.flatMap((b) => [b.x, b.x + b.width / 2, b.x + b.width]),
  ]);
  const y = snapAxis(bounds.y, bounds.height, height, [
    0,
    0.5,
    1,
    ...targets.flatMap((b) => [b.y, b.y + b.height / 2, b.y + b.height]),
  ]);
  return {
    bounds: { ...bounds, x: x.value, y: y.value },
    x: x.guide,
    y: y.guide,
  };
}
