export interface SceneView {
  yaw: number;
  pitch: number;
  roll: number;
  x: number;
  y: number;
  distance: number;
}

export const defaultSceneView: SceneView = {
  yaw: 0,
  pitch: 0,
  roll: 0,
  x: 0,
  y: 0,
  distance: 1,
};
export const wrapAngle = (angle: number) =>
  ((((angle + 180) % 360) + 360) % 360) - 180;

export function normalizeSceneView(value: unknown): SceneView {
  const source =
    value && typeof value === "object" ? (value as Partial<SceneView>) : {};
  const number = (key: keyof SceneView, min: number, max: number) => {
    const value = source[key];
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value))
      : defaultSceneView[key];
  };
  return {
    yaw: number("yaw", -180, 180),
    pitch: number("pitch", -180, 180),
    roll: number("roll", -180, 180),
    x: number("x", -100, 100),
    y: number("y", -100, 100),
    distance: number("distance", 0.25, 4),
  };
}

export function rotateSceneView(
  view: SceneView,
  yaw: number,
  pitch: number,
  roll = 0,
): SceneView {
  return {
    ...view,
    yaw: wrapAngle(view.yaw + yaw),
    pitch: wrapAngle(view.pitch + pitch),
    roll: wrapAngle(view.roll + roll),
  };
}
