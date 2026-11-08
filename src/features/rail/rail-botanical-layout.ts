import type { RailSkin } from "./model";
import type { railWheel } from "./rail-wheel";
import { getRailSkinTheme } from "./skin-theme";

/** Shared by SVG drawing and the desktop's visible/input region. */
export function botanicalSprigs(
  skin: RailSkin,
  unit: number,
  geometry: ReturnType<typeof railWheel>,
  attachments: number[],
) {
  const recipe = getRailSkinTheme(skin).decoration;
  if (recipe.type !== "wisteria" && recipe.type !== "autumn") return [];
  const left = geometry.point(-geometry.half),
    right = geometry.point(geometry.half);
  const anchors = [
    left.x,
    ...attachments
      .filter((x) => x > left.x && x < right.x)
      .sort((a, b) => a - b),
    right.x,
  ];
  return anchors.slice(1).flatMap((end, index) => {
    const start = anchors[index],
      length = end - start;
    if (length < recipe.minGap * unit) return [];
    const count = Math.max(1, Math.floor(length / (recipe.spacing * unit)));
    return Array.from({ length: count }, (_, part) => {
      const x = start + (length * (part + 0.5)) / count;
      return { ...geometry.atX(x), flip: (index + part) % 2 ? -1 : 1 };
    });
  });
}
