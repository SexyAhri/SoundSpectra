/** GPU-only feedback. Compilation, resizing and transitions must call settle(). */
export class AdaptiveResolution {
  private level = 0;
  private slow = 0;
  private fast = 0;
  private cooldownUntil = 0;
  private targetFps = 0;
  private readonly scales = [1, 0.85, 0.75];

  get scale() {
    return this.scales[this.level];
  }

  settle(now: number) {
    this.slow = this.fast = 0;
    this.cooldownUntil = Math.max(this.cooldownUntil, now + 1500);
  }

  sample(gpuMs: number, now: number, fps: number) {
    const targetFps = fps || 60;
    if (targetFps !== this.targetFps) {
      this.targetFps = targetFps;
      this.settle(now);
    }
    if (!Number.isFinite(gpuMs) || gpuMs <= 0 || now < this.cooldownUntil)
      return this.scale;
    const target = 1000 / targetFps;
    this.slow = gpuMs > target * 1.05 ? this.slow + 1 : 0;
    this.fast = gpuMs < target * 0.65 ? this.fast + 1 : 0;
    if (this.slow >= 120 && this.level < this.scales.length - 1) {
      this.level++;
      this.slow = this.fast = 0;
      this.cooldownUntil = now + 6000;
    } else if (this.fast >= 360 && this.level > 0) {
      this.level--;
      this.slow = this.fast = 0;
      this.cooldownUntil = now + 8000;
    }
    return this.scale;
  }
}
