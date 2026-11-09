/** Use a timer rather than animation frames: the audio window is hidden. */
export class MusicFade {
  value = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private target = 0;
  private done: (() => void) | undefined;

  constructor(private readonly update: (gain: number) => void) {}

  set(value: number) {
    this.cancel();
    this.value = this.target = value;
    this.update(value);
  }

  to(target: number, duration: number, done?: () => void) {
    if (this.timer !== undefined && this.target === target) {
      this.done = done;
      return;
    }
    this.cancel();
    this.target = target;
    if (this.value === target) {
      done?.();
      return;
    }
    this.done = done;
    const from = this.value;
    const started = performance.now();
    this.timer = setInterval(() => {
      const t = Math.min(1, (performance.now() - started) / duration);
      // Smooth the ends so neither the start nor the stop makes a sharp step.
      this.value = from + (target - from) * t * t * (3 - 2 * t);
      this.update(this.value);
      if (t === 1) {
        const finish = this.done;
        this.cancel();
        finish?.();
      }
    }, 10);
  }

  cancel() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.done = undefined;
  }
}
