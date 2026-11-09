import type { SceneMotion } from "../motion";

// Owned by the accepted simulation, not React lifetime or GPU render count.
// Switching compositions retains the path. Silence/reduced motion freezes travel.
export function compositionTime(
  motion: SceneMotion,
  reduced: boolean,
  restrained = false,
  speed = 1,
  restraint = 0.3,
) {
  return motion.flowPhase(
    "composition-transport",
    (0.45 + speed * 0.55) * (restrained ? restraint : 1),
    0,
    reduced,
  );
}
