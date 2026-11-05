import type { RenderQuality } from "./model";

export const budgets = {
  eco: { fps: 30, scale: 1, pixels: 600_000 },
  balanced: { fps: 60, scale: 1.5, pixels: 1_200_000 },
  smooth: { fps: 120, scale: 2, pixels: 2_000_000 },
  unlimited: { fps: 0, scale: 2, pixels: 2_000_000 },
} as const;

export function drawingSize(width: number, height: number, dpr: number, quality: RenderQuality, regionCount = 1) {
  const budget = budgets[quality];
  const scale = Math.min(dpr || 1, budget.scale, Math.sqrt(budget.pixels / Math.max(1, regionCount) / Math.max(1, width * height)), 4096 / Math.max(1, width), 4096 / Math.max(1, height));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export class FrameBudget {
  private next = 0;
  private fps = 0;
  due(now: number, fps: number) {
    if (fps === 0) { this.fps = fps; this.next = now; return true; }
    if (this.fps !== fps) { this.fps = fps; this.next = now; }
    if (now + 0.2 < this.next) return false;
    const interval = 1000 / fps;
    this.next = Math.max(this.next + interval, now - interval + 1);
    // Do not replay a backlog after returning from the tray or a long pause.
    if (this.next <= now) this.next = now + interval;
    return true;
  }
}
