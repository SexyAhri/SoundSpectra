import type { CSSProperties, ReactNode } from "react";
import type { RailItem } from "./model";
import { railPaperSeed } from "./rail-paper-details";
import { RailWoodPin } from "./rail-wood-pin";

/** Clip and card share the same pivot; content keeps its existing semantics. */
export function RailItemFrame({
  item,
  materialId,
  children,
}: {
  item: RailItem;
  materialId: string;
  children: ReactNode;
}) {
  const seed = railPaperSeed(item.id);
  return (
    <div
      className="rail-sway"
      data-paper-print={seed % 3}
      style={{ "--rail-string-length": 20 + (seed % 3) * 5 } as CSSProperties}
    >
      <span className="rail-clip" aria-hidden="true"><RailWoodPin materialId={materialId} /></span>
      <span className="rail-tether" aria-hidden="true" />
      <span className="rail-slot-ghost" aria-hidden="true" />
      <div className="rail-keepsake">{children}</div>
    </div>
  );
}
