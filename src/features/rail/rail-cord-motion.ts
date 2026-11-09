import type { railWheel } from "./rail-wheel";
import type { RailAudioConfig } from "./audio-config";
import { RailAudioMotion } from "./audio-motion";

/** Cache the authored paths once. SVG updates never read layout or rerender React. */
export function bindRailCordMotion(
  host: HTMLElement,
  geometry: ReturnType<typeof railWheel>,
  unit: number,
) {
  const left = geometry.point(-geometry.half).x,
    span = geometry.point(geometry.half).x - left;
  const segments = Math.ceil(span / (8 * unit));
  const paths = [
    ...host.querySelectorAll<SVGPathElement>("[data-rail-rope-path]"),
  ].map((node) => {
    const rest = node.dataset.railRopePath!;
    const points = rest.includes("Q")
      ? Array.from({ length: segments + 1 }, (_, index) => {
          const x = left + (span * index) / segments;
          return { command: index ? "L" : "M", x, y: geometry.atX(x).y };
        })
      : [...rest.matchAll(/([ML])\s*([-\d.]+)[,\s]+([-\d.]+)/g)].map(
          (match) => ({
            command: match[1],
            x: Number(match[2]),
            y: Number(match[3]),
          }),
        );
    return { node, rest, points };
  });
  const decorations = [
    ...host.querySelectorAll<SVGGElement>("[data-rail-decoration-x]"),
  ].map((node) => ({ node, x: Number(node.dataset.railDecorationX) }));
  return {
    apply(motion: RailAudioMotion, config: RailAudioConfig) {
      const quiet = motion.level + motion.bass + motion.pulse < 0.00001;
      for (const { node, rest, points } of paths) {
        const d = quiet
          ? rest
          : points
              .map(
                ({ command, x, y }) =>
                  `${command}${x.toFixed(2)} ${(y + motion.offset((x - left) / span, config, unit)).toFixed(2)}`,
              )
              .join("");
        if (node.getAttribute("d") !== d) node.setAttribute("d", d);
      }
      for (const { node, x } of decorations) {
        node.style.translate = `0 ${motion.offset((x - left) / span, config, unit).toFixed(3)}px`;
      }
      host.style.setProperty(
        "--rail-music-leaf-angle",
        `${(motion.level * Math.sin(motion.time * 2) + motion.pulse) * 2}deg`,
      );
    },
    offset(x: number, motion: RailAudioMotion, config: RailAudioConfig) {
      return motion.offset((x - left) / span, config, unit);
    },
    reset() {
      // React may have committed a new width/skin before the old layout effect
      // cleans up. Restoring its snapshot would truncate the freshly drawn cord.
      for (const { node, rest } of paths) {
        const authored = node.dataset.railRopePath ?? rest;
        if (node.getAttribute("d") !== authored)
          node.setAttribute("d", authored);
      }
      for (const { node } of decorations)
        node.style.removeProperty("translate");
      host.style.removeProperty("--rail-music-leaf-angle");
    },
  };
}
