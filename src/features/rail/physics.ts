import type { RailSkinTheme } from "./skin-theme";

const step = 1 / 240;

/** Small torsional spring for cards, independent of the shared cord displacement. */
export class RailItemPhysics {
  angle = 0;
  angularVelocity = 0;
  private time = 0;
  private remainder = 0;
  readonly phase: number;
  private excitation = 0;

  constructor(id: string) {
    const seed = Array.from(id).reduce(
      (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
      7,
    );
    this.phase = ((seed % 1009) / 1009) * Math.PI * 2;
  }

  reset() {
    this.angle = this.angularVelocity = this.remainder = 0;
    this.excitation = 0;
  }

  kick(strength: number) {
    if (!Number.isFinite(strength) || strength <= 0) return;
    this.angularVelocity +=
      (Math.sin(this.phase) >= 0 ? 1 : -1) * Math.min(1, strength) * 0.12;
    this.angularVelocity = Math.max(-0.3, Math.min(0.3, this.angularVelocity));
    this.excitation = 0.6;
  }

  update(
    deltaTime: number,
    interacting: boolean,
    physics: RailSkinTheme["physics"],
    musicLevel = 0,
  ) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;
    // Discard suspended time and integrate at a fixed step across refresh rates.
    this.remainder += Math.min(deltaTime, 0.05);
    while (this.remainder + 1e-10 >= step) {
      this.remainder = Math.max(0, this.remainder - step);
      this.time += step;
      this.excitation = Math.max(0, this.excitation - step);
      if (interacting) {
        const decay = Math.exp(-physics.interactionDamping * step);
        this.angularVelocity *= decay;
        this.angle *= decay;
        if (Math.abs(this.angle) < 0.00001)
          this.angle = this.angularVelocity = 0;
        continue;
      }
      // Quiet intervals keep cards easy to acquire, as with the original wind
      // animation's resting keyframes. Resume from the held angle without a jump.
      const cycle = (this.time + this.phase) % physics.windPeriod;
      if (cycle < physics.restDuration && this.excitation === 0) {
        this.angularVelocity = 0;
        continue;
      }
      const wind =
        Math.sin(this.time * 0.7 + this.phase) *
        (Math.cos(this.time * 0.31 + this.phase) *
          0.12 *
          physics.windResponsiveness +
          musicLevel * 0.04);
      const acceleration =
        -physics.stiffness * this.angle +
        wind -
        physics.damping * this.angularVelocity;
      this.angularVelocity += acceleration * step;
      const remaining = physics.windPeriod - cycle;
      if (remaining < 0.3)
        this.angularVelocity *= Math.exp(-12 * step * (1 - remaining / 0.3));
      this.angle += this.angularVelocity * step;
      if (Math.abs(this.angle) > physics.maxAngle) {
        this.angle = Math.sign(this.angle) * physics.maxAngle;
        this.angularVelocity = 0;
      }
    }
  }
}
