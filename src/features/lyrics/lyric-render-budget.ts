import type { RenderQuality } from "../spectrum/model";
import { budgets } from "../spectrum/render-budget";

export function lyricRenderBudget(
  quality: RenderQuality = "balanced",
  reduced = false,
) {
  const budget = budgets[quality];
  return {
    fps: reduced ? 15 : budget.fps,
    pixels: budget.pixels,
    scale: budget.scale,
    particles: quality === "eco" ? 800 : 2000,
  };
}
