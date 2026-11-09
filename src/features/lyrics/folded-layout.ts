/** Lay out phrase panels in a small number of balanced, offset reading rows. */
export interface FoldedLayout {
  scale: number;
  panels: {
    x: number;
    y: number;
    row: number;
    rowScale: number;
    order: number;
    rowWidth: number;
  }[];
  rows: number;
}

export function foldedLayout(
  widths: number[],
  width: number,
  height: number,
  fontSize: number,
  regionWidth: number,
): FoldedLayout {
  const total = widths.reduce((sum, w) => sum + w, 0);
  const screenScale = (width / (1920 * regionWidth)) * 2.35;
  const roomy = height > width * 0.2;
  const count = Math.min(
    widths.length,
    roomy ? (total > 23 ? 3 : total > 7.5 ? 2 : 1) : 1,
  );
  const rows: number[][] = [];
  let start = 0;
  for (let r = 0; r < count; r++) {
    const remaining = widths.slice(start).reduce((sum, w) => sum + w, 0);
    const target = remaining / (count - r);
    let cut = start,
      used = 0;
    while (cut < widths.length - (count - r - 1)) {
      const next = used + widths[cut];
      if (
        cut > start &&
        r < count - 1 &&
        Math.abs(used - target) < Math.abs(next - target)
      )
        break;
      used = next;
      cut++;
      if (r < count - 1 && used >= target) break;
    }
    rows.push(Array.from({ length: cut - start }, (_, i) => start + i));
    start = cut;
  }
  const factors =
    rows.length === 1
      ? [1]
      : rows.length === 2
        ? [0.9, 1.04]
        : [0.88, 1.04, 0.92];
  const rowWidths = rows.map(
    (row, r) => row.reduce((sum, i) => sum + widths[i], 0) * factors[r],
  );
  const fit = Math.min(
    (width * 0.79) / Math.max(1, ...rowWidths),
    (height * 0.86) / (1.5 + (rows.length - 1) * 1.75),
  );
  // Compress the full slider range into the space available. A hard clamp on the
  // selected size made almost every value above 18 identical in shallow regions.
  const largest = Math.min(72 * screenScale, fit);
  const smallest = Math.min(18 * screenScale, largest * 0.65);
  const amount = Math.max(0, Math.min(1, (fontSize - 18) / 54));
  const scale = smallest + (largest - smallest) * amount;
  const panels: FoldedLayout["panels"] = [];
  rows.forEach((row, r) => {
    const rowScale = factors[r],
      w = rowWidths[r];
    // Opposing edges and unequal type sizes create a readable typographic composition.
    let x =
      rows.length === 1
        ? -w / 2
        : r % 2 === 0
          ? -Math.max(...rowWidths) * 0.53
          : Math.max(...rowWidths) * 0.53 - w;
    row.forEach((i, order) => {
      panels[i] = {
        x,
        y: ((rows.length - 1) / 2 - r) * 1.75,
        row: r,
        rowScale,
        order,
        rowWidth: w,
      };
      x += widths[i] * rowScale;
    });
  });
  return { scale, panels, rows: rows.length };
}
