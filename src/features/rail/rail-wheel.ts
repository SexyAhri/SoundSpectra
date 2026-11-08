// Spread the visible wheel slots along a gently sagging cord.
export function railWheel(
  width: number,
  widest: number,
  unit: number,
  count: number,
  sagFactor = 1,
) {
  const half = Math.PI / 5;
  // Cord endpoints follow the group's bounds; card padding is handled below.
  const inset = 4 * unit;
  const chord = Math.max(48, width - inset * 2);
  const radius = chord / (2 * Math.sin(half));
  const endY = 18 * unit;
  const sag = Math.min(chord * 0.05 * sagFactor, 52 * unit);
  const gap = Math.max(90 * unit, widest + 28 * unit);
  // Leave a clickable tail past each outer card, then use the remaining span
  // even when there are too few items to fill the wheel's normal capacity.
  const usableHalf = Math.asin(
    Math.max(0, Math.sin(half) - (widest / 2 + 18 * unit) / radius),
  );
  const minimumStep = Math.min(usableHalf, Math.max(half / 4, gap / radius));
  const sideSlots = Math.max(
    1,
    Math.min(Math.floor(count / 2), Math.floor(usableHalf / minimumStep)),
  );
  // Bring neighboring cards about a third closer while retaining enough room
  // for the widest card and preserving the full cord span.
  const step = Math.max(
    Math.min(usableHalf, gap / radius),
    Math.max(minimumStep, usableHalf / sideSlots) * (2 / 3),
  );
  const height = 300 * unit;
  const point = (angle: number) => ({
    x: width / 2 + radius * Math.sin(angle),
    y: endY + sag * (1 - (Math.sin(angle) / Math.sin(half)) ** 2),
  });
  const left = point(-half),
    right = point(half);
  const path = `M ${left.x} ${left.y} Q ${width / 2} ${endY + 2 * sag} ${right.x} ${right.y}`;
  // One curve sampler for drawing, decorations, previews and native clipping.
  const atX = (x: number) => {
    const t = (x - left.x) / (right.x - left.x);
    const slope = 4 * sag * (1 - 2 * t) / (right.x - left.x);
    return { x, y: endY + 4 * sag * t * (1 - t), slope, angle: Math.atan(slope) * 180 / Math.PI };
  };
  const slot = (index: number, active: number) => {
    // Rotate the ordered sequence around the selected item without mutating it.
    const delta = count
      ? ((index - active + count / 2 + count) % count) - count / 2
      : 0;
    const angle = Math.max(-half - step, Math.min(half + step, delta * step));
    return {
      ...point(angle),
      angle,
      visible: Math.abs(delta * step) <= usableHalf + 0.001,
    };
  };
  return { half, radius, step, height, path, point, atX, slot };
}
