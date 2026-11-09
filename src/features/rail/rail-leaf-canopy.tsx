import type { CSSProperties } from "react";
import type { railWheel } from "./rail-wheel";
import type { RailSkinTheme } from "./skin-theme";
import { railFloralLayout } from "./rail-floral-layout";

/** HTML pivots let tiny leaf tips move without relaying out the SVG cord. */
export function RailLeafCanopy({
  unit,
  geometry,
  attachments,
  theme,
}: {
  unit: number;
  geometry: ReturnType<typeof railWheel>;
  attachments: number[];
  theme: RailSkinTheme;
}) {
  const { leaves } = railFloralLayout(unit, geometry, attachments, theme);
  return (
    <div className="rail-leaf-canopy" aria-hidden="true">
      {leaves.map((x, index) => (
        <span
          className="rail-leaf-anchor"
          data-rail-decoration-x={x}
          key={x}
          style={
            {
              left: x,
              top: geometry.atX(x).y,
              width: 24 * unit,
              height: 24 * unit,
              transform: `translate(-50%, -50%) rotate(${geometry.atX(x).angle + (index % 3) * 7 - 7}deg) scale(${0.78 + (index % 3) * 0.09}, ${index % 2 ? -0.86 : 0.86})`,
              "--rail-leaf-delay": `${(index % 3) * -2.5}s`,
            } as CSSProperties
          }
        >
          <span className="rail-leaf-breeze">
            <svg viewBox="-12 -12 24 24" fill="none">
              <path className="rail-leaf-tip" d="M-7 0Q-3-11 7-8Q5-1-7 0Z" />
              <path className="rail-leaf-tip-vein" d="M-5 0 4-6" />
            </svg>
          </span>
        </span>
      ))}
    </div>
  );
}
