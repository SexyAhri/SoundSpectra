import * as T from "three";

/** Keep the saved scale range, with its upper half opening out into a sea. */
export function expanseFill(scale: number) {
  return T.MathUtils.smoothstep(scale, 1.35, 1.8);
}
