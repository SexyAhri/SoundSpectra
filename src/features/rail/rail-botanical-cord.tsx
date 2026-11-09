import type { RailSkin } from "./model";
import type { railWheel } from "./rail-wheel";
import { botanicalSprigs } from "./rail-botanical-layout";

export function RailBotanicalCord({
  skin,
  unit,
  geometry,
  attachments,
}: {
  skin: RailSkin;
  unit: number;
  geometry: ReturnType<typeof railWheel>;
  attachments: number[];
}) {
  const sprigs = botanicalSprigs(skin, unit, geometry, attachments);
  return (
    <g className={`rail-botanical-cord rail-cord-${skin}`} aria-hidden="true">
      <path
        className="rail-branch-shadow"
        data-rail-rope-path={geometry.path}
        d={geometry.path}
        transform={`translate(0 ${unit})`}
      />
      <path
        className="rail-branch-main"
        data-rail-rope-path={geometry.path}
        d={geometry.path}
      />
      <path
        className="rail-branch-grain"
        data-rail-rope-path={geometry.path}
        d={geometry.path}
      />
      {sprigs.map(({ x, y, angle, flip }, index) => (
        <g
          key={index}
          data-rail-decoration-x={x}
          transform={`translate(${x} ${y}) rotate(${angle}) scale(${unit})`}
        >
          {skin === "wisteria" ? (
            <>
              <path
                className="rail-botanical-stem"
                d="M-22 0 Q-10-4 0 0 T22-1 M-10 0Q-12 10-9 17 M2 0Q0 16 3 32 M14 0Q12 11 15 22"
              />
              <path
                className="rail-wisteria-leaf"
                d="M-4 0Q-9-14-18-10Q-17-2-4 0Z M10 0Q17-12 24-8Q22-1 10 0Z"
              />
              <path className="rail-botanical-vein" d="M-6-1-15-8 M12-1 21-6" />
              {[
                { x: -10, length: 4, y: 3 },
                { x: 2, length: 7, y: 4 },
                { x: 14, length: 5, y: 3 },
              ].map((cluster, clusterIndex) => (
                <g
                  key={clusterIndex}
                  transform={`translate(${cluster.x} ${cluster.y})`}
                >
                  {Array.from({ length: cluster.length }, (_, row) => {
                    const size = 1 - (row / (cluster.length + 1)) * 0.55;
                    return (
                      <g
                        key={row}
                        transform={`translate(${Math.sin(row * 0.9) * 1.2} ${row * 4.2}) scale(${size})`}
                      >
                        <ellipse
                          className={`rail-wisteria-petal rail-wisteria-petal-${(row + clusterIndex) % 3}`}
                          cx="-2.1"
                          cy="1"
                          rx="3.1"
                          ry="2.1"
                          transform="rotate(28)"
                        />
                        <ellipse
                          className={`rail-wisteria-petal rail-wisteria-petal-${(row + clusterIndex + 1) % 3}`}
                          cx="2.1"
                          cy="1"
                          rx="3.1"
                          ry="2.1"
                          transform="rotate(-28)"
                        />
                      </g>
                    );
                  })}
                  <ellipse
                    className="rail-wisteria-tip"
                    cy={cluster.length * 4.2}
                    rx="1.4"
                    ry="2.1"
                  />
                </g>
              ))}
            </>
          ) : (
            <g transform={`scale(${flip} 1)`}>
              <path
                className="rail-botanical-stem"
                d="M-24 0Q-10 2-3-2L8-13 M-3-2Q3 4 11 10 M10 0Q17-4 24-3"
              />
              <path
                className="rail-ginkgo-leaf"
                d="M11 10Q1 9-2 19Q1 26 8 23L12 20 15 24Q24 25 28 18Q24 8 11 10Z"
              />
              <path
                className="rail-ginkgo-vein"
                d="M11 10 2 20 M11 10 8 21 M11 10 15 22 M11 10 24 18"
              />
              <path
                className="rail-autumn-leaf"
                d="M24-3Q29-13 36-8Q34 0 24-3Z M-15 0Q-22-11-29-6Q-28 1-15 0Z"
              />
              <path
                className="rail-botanical-vein"
                d="M26-4 33-7 M-18-1-26-5"
              />
              <circle className="rail-autumn-berry" cx="8" cy="-12" r="2.7" />
              <circle
                className="rail-autumn-berry-light"
                cx="7.2"
                cy="-13"
                r=".7"
              />
            </g>
          )}
        </g>
      ))}
    </g>
  );
}
