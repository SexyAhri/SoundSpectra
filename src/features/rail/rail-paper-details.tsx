import type { RailItem } from "./model";

/** A keepsake keeps its print and suspension length when moved or reloaded. */
export function railPaperSeed(id: string) {
  return Array.from(id).reduce(
    (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
    7,
  );
}

/** Original pressed flowers; the artwork stays behind the usable content. */
export function RailPaperDetails({
  item,
  materialId: id,
}: {
  item: RailItem;
  materialId: string;
}) {
  const print = railPaperSeed(item.id) % 3;
  return (
    <span className="rail-paper-details" aria-hidden="true">
      <svg className="rail-paper-fibers" width="100%" height="100%">
        <rect width="100%" height="100%" fill={`url(#${id}-fibers)`} />
      </svg>
      <svg className="rail-paper-botanical" viewBox="0 0 80 150" fill="none">
        <g
          style={
            {
              "--rail-pressed-leaf": `url(#${id}-leaf)`,
              "--rail-pressed-petal": `url(#${id}-petal)`,
              "--rail-pressed-daisy": `url(#${id}-daisy)`,
            } as import("react").CSSProperties
          }
        >
          {print === 0 ? (
            <g>
              <path d="M30 144Q41 107 44 38M41 78 21 61M38 103 62 83" />
              <path
                className="rail-paper-leaf"
                d="M41 78Q16 77 17 56Q33 56 41 78ZM38 103Q43 80 65 80Q62 100 38 103Z"
              />
              <path className="rail-paper-vein" d="M19 59 40 77M62 83 40 101" />
              <g transform="translate(44 31)" className="rail-paper-petals">
                {[0, 51, 103, 154, 206, 257, 309].map((angle) => (
                  <g key={angle} transform={`rotate(${angle})`}>
                    <path d="M0 1C-10-3-12-17-5-19C2-21 6-8 0 1Z" />
                    <path
                      className="rail-petal-crease"
                      d="M-1-2Q-7-10-5-17M-2-4Q-3-12-4-18M-2-3Q-8-7-8-12"
                    />
                  </g>
                ))}
                <circle r="4.5" className="rail-paper-pollen" />
                <path
                  className="rail-pollen-grain"
                  d="M-2-2h.5M1-1h.5M-1 1h.5M1 2h.5M-3 0h.5"
                />
              </g>
              <path
                className="rail-paper-loose-petal"
                d="M66 113Q52 105 57 96Q68 93 66 113Z"
              />
            </g>
          ) : print === 1 ? (
            <g>
              <path d="M29 145 39 42M32 105 17 86M35 81 61 61M39 44 23 24M39 44 55 26" />
              <path
                className="rail-paper-leaf"
                d="M32 105Q13 104 12 83Q28 83 32 105ZM35 81Q44 59 65 58Q61 78 35 81Z"
              />
              <path className="rail-paper-vein" d="M15 86 31 103M60 62 37 79" />
              {[
                [22, 23],
                [38, 17],
                [55, 25],
                [39, 35],
              ].map(([x, y], i) => (
                <g
                  key={i}
                  transform={`translate(${x} ${y})`}
                  className="rail-paper-daisies"
                >
                  {[0, 60, 120, 180, 240, 300].map((angle) => (
                    <g key={angle} transform={`rotate(${angle})`}>
                      <ellipse cy="-5" rx="3.1" ry="5.4" />
                      <path className="rail-petal-crease" d="M0-2-.5-9" />
                    </g>
                  ))}
                  <circle r="3.2" className="rail-paper-pollen" />
                </g>
              ))}
            </g>
          ) : (
            <g>
              <path d="M27 145Q54 93 43 18" />
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <g
                  key={i}
                  transform={`translate(${43 + Math.sin(i) * 3} ${28 + i * 16})`}
                >
                  <path
                    className="rail-paper-leaf"
                    d="M0 0Q-19-20-24-9Q-17 3 0 0M1 4Q18-12 23-3Q18 8 1 4"
                  />
                  <path className="rail-paper-vein" d="M-22-9 0 0 21-3" />
                </g>
              ))}
            </g>
          )}
        </g>
      </svg>
      <span className="rail-paper-edge" />
      <span className="rail-paper-hole" />
    </span>
  );
}
