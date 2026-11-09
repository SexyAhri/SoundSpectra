/** Independent controls for the jellyfish and galaxy scenes. Legacy fields are read only at migration. */
export interface LuminousAppearance {
  jellyCount: number;
  jellySize: number;
  tentacleLength: number;
  driftSpeed: number;
  starDensity: number;
  nebulaScale: number;
  dustOpacity: number;
  spinSpeed: number;
}
export const luminousDefaults: LuminousAppearance = {
  jellyCount: 5,
  jellySize: 2.4,
  tentacleLength: 0.5,
  driftSpeed: 1.5,
  starDensity: 2400,
  nebulaScale: 1,
  dustOpacity: 0.65,
  spinSpeed: 0.55,
};
export function normalizeLuminous(
  value: Record<string, unknown>,
): LuminousAppearance {
  const read = (
    name: string,
    legacy: string | null,
    factor: number,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const current = value[name],
      old = legacy ? value[legacy] : undefined;
    const v =
      typeof current === "number" && Number.isFinite(current)
        ? current
        : typeof old === "number" && Number.isFinite(old)
          ? old * factor
          : fallback;
    return Math.max(min, Math.min(max, v));
  };
  return {
    jellyCount: Math.round(read("jellyCount", "ballCount", 1, 5, 3, 7)),
    jellySize: read("jellySize", "ballRadiusMultiplier", 2.4, 2.4, 1.2, 4.8),
    tentacleLength: read("tentacleLength", "ballTrail", 1, 0.5, 0, 1),
    driftSpeed: read("driftSpeed", "ballSpeedMultiplier", 1, 1.5, 0.1, 5),
    starDensity: Math.round(
      read("starDensity", "starCount", 20, 2400, 1200, 6000),
    ),
    nebulaScale: read("nebulaScale", "starDepth", 1, 1, 0.5, 2),
    dustOpacity: read("dustOpacity", null, 1, 0.65, 0, 1),
    spinSpeed: read("spinSpeed", "starTrail", 0.55, 0.55, 0, 2),
  };
}
