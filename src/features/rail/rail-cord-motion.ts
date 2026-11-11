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
  const paths = new Map<string, {
    rest: string;
    nodes: SVGPathElement[];
    points: { command: string; x: number; y: number }[];
  }>();
  for (const node of host.querySelectorAll<SVGPathElement>("[data-rail-rope-path]")) {
    const rest = node.dataset.railRopePath!;
    const shared = paths.get(rest);
    if (shared) {
      shared.nodes.push(node);
      continue;
    }
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
    paths.set(rest, { nodes: [node], rest, points });
  }
  const decorations = [
    ...host.querySelectorAll<SVGGElement>("[data-rail-decoration-x]"),
  ].map((node) => ({
    node,
    x: Number(node.dataset.railDecorationX),
    translate: undefined as string | undefined,
  }));
  let leafAngle: string | undefined;
  return {
    apply(motion: RailAudioMotion, config: RailAudioConfig) {
      const quiet = motion.level + motion.bass + motion.pulse < 0.00001;
      for (const { nodes, rest, points } of paths.values()) {
        const d = quiet
          ? rest
          : points
              .map(
                ({ command, x, y }) =>
                  `${command}${x.toFixed(2)} ${(y + motion.offset((x - left) / span, config, unit)).toFixed(2)}`,
              )
              .join("");
        for (const node of nodes) {
          if (node.getAttribute("d") !== d) node.setAttribute("d", d);
        }
      }
      for (const decoration of decorations) {
        const translate = `0 ${motion.offset((decoration.x - left) / span, config, unit).toFixed(3)}px`;
        if (decoration.translate !== translate) {
          decoration.node.style.translate = translate;
          decoration.translate = translate;
        }
      }
      const angle = `${(motion.level * Math.sin(motion.time * 2) + motion.pulse) * 2}deg`;
      if (leafAngle !== angle) {
        host.style.setProperty("--rail-music-leaf-angle", angle);
        leafAngle = angle;
      }
    },
    offset(x: number, motion: RailAudioMotion, config: RailAudioConfig) {
      return motion.offset((x - left) / span, config, unit);
    },
    reset() {
      // React may have committed a new width/skin before the old layout effect
      // cleans up. Restoring its snapshot would truncate the freshly drawn cord.
      for (const { nodes, rest } of paths.values()) {
        for (const node of nodes) {
          const authored = node.dataset.railRopePath ?? rest;
          if (node.getAttribute("d") !== authored)
            node.setAttribute("d", authored);
        }
      }
      for (const decoration of decorations) {
        decoration.node.style.removeProperty("translate");
        decoration.translate = undefined;
      }
      host.style.removeProperty("--rail-music-leaf-angle");
      leafAngle = undefined;
    },
  };
}
