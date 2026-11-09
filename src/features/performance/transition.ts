import type { SpectrumSettings } from "../spectrum/model";
import type { TransitionKind, TransitionSettings } from "./model";

export const transitionCompatibility = (
  kind: TransitionKind,
  from: string,
  to: string,
): TransitionKind =>
  kind === "particles" &&
  ["tidal_knot", "layered_tides"].includes(from) &&
  ["tidal_knot", "layered_tides"].includes(to)
    ? kind
    : kind === "travel" &&
        ["echo_corridor", "star_flight"].includes(from) &&
        ["echo_corridor", "star_flight"].includes(to)
      ? kind
      : "dissolve";
export interface TransitionFrame {
  blend: number;
  scatter: number;
  travel: number;
  kind: TransitionKind;
}
const smooth = (x: number) => {
  const p = Math.max(0, Math.min(1, x));
  return p * p * (3 - 2 * p);
};
/** One live scene plus a bounded GPU still of the last presented frame. */
export class SceneTransition {
  frame: TransitionFrame = {
    blend: 1,
    scatter: 0,
    travel: 0,
    kind: "dissolve",
  };
  private pending?: SpectrumSettings;
  private phase: "idle" | "exit" | "prepare" | "enter" = "idle";
  private age = 0;
  private duration = 1.4;
  get active() {
    return this.phase !== "idle";
  }
  cancel() {
    this.phase = "idle";
    this.pending = undefined;
    this.frame = { blend: 1, scatter: 0, travel: 0, kind: "dissolve" };
  }
  step(
    current: SpectrumSettings,
    next: SpectrumSettings,
    options: TransitionSettings,
    animate: boolean,
    reduced: boolean,
    dt: number,
    ready: boolean,
    capture: () => void,
  ) {
    const desired = this.pending?.effect ?? current.effect;
    if (!animate && this.active && next.effect === desired) {
      this.cancel();
      return next;
    }
    if (reduced && this.active && this.frame.kind !== "dissolve") {
      capture();
      current = this.pending ?? next;
      this.phase = "prepare";
      this.age = 0;
      this.duration = 0.2;
      this.frame = { blend: 0, scatter: 0, travel: 0, kind: "dissolve" };
    }
    if (next.effect !== desired) {
      const interrupted = this.active;
      this.pending = next;
      this.age = 0;
      this.duration = Math.max(0.2, Math.min(6, options.durationMs / 1000));
      this.frame.kind =
        !animate || reduced || interrupted
          ? "dissolve"
          : transitionCompatibility(options.kind, current.effect, next.effect);
      if (!animate || reduced) this.duration = 0.2;
      if (this.frame.kind === "dissolve") {
        capture();
        current = next;
        this.phase = "prepare";
        this.frame.blend = 0;
        this.frame.scatter = this.frame.travel = 0;
      } else this.phase = "exit";
    } else if (this.pending) this.pending = next;
    else current = next;
    if (this.phase === "exit") {
      this.age += dt;
      const p = smooth(this.age / (this.duration * 0.4));
      this.frame.scatter = this.frame.kind === "particles" ? p : 0;
      this.frame.travel = this.frame.kind === "travel" ? p : 0;
      if (p >= 1) {
        capture();
        current = this.pending!;
        this.phase = "prepare";
        this.age = 0;
        this.frame.blend = 0;
      }
    } else if (this.phase === "prepare") {
      if (ready && current.effect === next.effect) {
        this.phase = "enter";
        this.age = 0;
      }
    } else if (this.phase === "enter" && ready) {
      this.age += dt;
      const p = smooth(
        this.age / (this.duration * (this.frame.kind === "dissolve" ? 1 : 0.6)),
      );
      this.frame.blend = p;
      this.frame.scatter = this.frame.kind === "particles" ? 1 - p : 0;
      this.frame.travel = this.frame.kind === "travel" ? 1 - p : 0;
      if (p >= 1) {
        this.phase = "idle";
        this.pending = undefined;
        this.frame.scatter = this.frame.travel = 0;
      }
    }
    return current;
  }
}
