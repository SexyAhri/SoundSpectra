import type { railWheel } from "./rail-wheel";
import type { RailSkinTheme } from "./skin-theme";

/** The static cord and composited leaf tips share attachment-free positions. */
export function railFloralLayout(
  unit: number,
  geometry: ReturnType<typeof railWheel>,
  attachments: number[],
  theme: RailSkinTheme,
) {
  const left = geometry.point(-geometry.half),
    right = geometry.point(geometry.half),
    span = right.x - left.x;
  const anchors = [
    left.x,
    ...attachments
      .filter((x) => x > left.x && x < right.x)
      .sort((a, b) => a - b),
    right.x,
  ];
  const flowers = anchors.slice(1).flatMap((end, index) => {
    const start = anchors[index],
      length = end - start;
    if (length < theme.decoration.minGap * unit) return [];
    const count = Math.max(
      1,
      Math.floor(length / (theme.decoration.spacing * unit)),
    );
    return Array.from(
      { length: count },
      (_, part) => start + (length * (part + 0.5)) / count,
    );
  });
  const leaves = Array.from(
    { length: Math.floor(span / (theme.decoration.leafSpacing * unit)) },
    (_, index) => left.x + (index + 0.5) * theme.decoration.leafSpacing * unit,
  ).filter(
    (x) =>
      x > left.x + 15 * unit &&
      x < right.x - 15 * unit &&
      attachments.every((anchor) => Math.abs(anchor - x) > 17 * unit) &&
      flowers.every((flower) => Math.abs(flower - x) > 25 * unit),
  );
  return { flowers, leaves };
}
