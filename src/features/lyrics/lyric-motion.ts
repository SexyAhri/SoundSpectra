const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Closed-form damped step: no integration state, identical on seek and at any FPS. */
export function lyricSpring(milliseconds: number) {
  if (milliseconds <= 0) return 0;
  if (milliseconds >= 650) return 1;
  const t = milliseconds / 1000;
  return (
    1 - Math.exp(-12 * t) * (Math.cos(14 * t) + (12 / 14) * Math.sin(14 * t))
  );
}

/** Only the final breath dissolves; a missing onset never delays clearing. */
export function lyricRelease(start: number, end: number, time: number) {
  const lead = Math.min(90, Math.max(1, end - start) * 0.04);
  return clamp((time - end + lead) / 430);
}

/** A perspective orbit with rigid, uniformly scaled glyphs and a front reading window. */
export function lyricOrbit(
  position: number,
  progress: number,
  width: number,
  height: number,
  reduced: boolean,
) {
  const u = position * 2 - 1;
  const travel = reduced ? 0 : (progress - 0.5) * 0.045;
  const a = u + travel;
  const depth = width * 0.64 * Math.abs(a) ** 1.7;
  const perspective = width / (width + depth);
  const bow = Math.max(0, Math.abs(a) - 0.22);
  return {
    x: width * 0.5 + a * width * 0.47 * perspective,
    y:
      height * (0.46 + bow * bow * 0.32) * perspective +
      height * 0.46 * (1 - perspective),
    z: -depth,
    scale: perspective,
    angle: Math.atan2(height * 0.5 * a, width) * 0.65,
  };
}
