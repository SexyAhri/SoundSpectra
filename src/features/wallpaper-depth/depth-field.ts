export type DepthProfile = "landscape" | "left-foreground";
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// The optional foreground outline is a composition guide, not inferred scene geometry.
const cottage = [
  [0, 0],
  [0.26, 0],
  [0.29, 0.04],
  [0.29, 0.1],
  [0.38, 0.06],
  [0.43, 0.22],
  [0.45, 0.27],
  [0.43, 0.42],
  [0.49, 0.42],
  [0.5, 0.53],
  [0.44, 0.54],
  [0.46, 0.69],
  [0.43, 0.81],
  [0.54, 1],
  [0, 1],
];
function outlineDistance(x: number, y: number) {
  let inside = false,
    distance = 1;
  for (let i = 0, j = cottage.length - 1; i < cottage.length; j = i++) {
    const [ax, ay] = cottage[i],
      [bx, by] = cottage[j];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
      inside = !inside;
    const dx = bx - ax,
      dy = by - ay,
      t = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)),
      );
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return (inside ? 1 : -1) * distance;
}
export function depthAt(x: number, y: number, profile: DepthProfile) {
  const ground = smooth(0.3, 1, y),
    foreground = smooth(0.72, 1, y);
  let depth = 0.08 + ground * 0.34 + foreground * 0.45;
  if (profile === "left-foreground") {
    const mask = smooth(-0.007, 0.007, outlineDistance(x, y));
    depth = depth * (1 - mask) + (0.55 + smooth(0.25, 1, y) * 0.3) * mask;
  }
  return Math.min(1, depth);
}
export function depthPixels(profile: DepthProfile, width = 384, height = 216) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4,
        value = Math.round(
          depthAt(x / (width - 1), 1 - y / (height - 1), profile) * 255,
        );
      pixels.set([value, value, value, 255], offset);
    }
  return { pixels, width, height };
}
