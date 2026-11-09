import type { RailItem } from "./model";

/** Keep a file's suffix visible even when its display name needs truncating. */
export function RailItemLabel({ item }: { item: RailItem }) {
  const file = item.kind === "file"
    ? /^(.+)(\.[a-z\d][a-z\d_-]{0,11})$/i.exec(item.name)
    : null;
  return (
    <span className={`rail-item-name${file ? " rail-item-name-with-extension" : ""}`}>
      {file ? <>
        <span className="rail-item-name-text">{file[1]}</span>
        <span className="rail-item-extension">{file[2]}</span>
      </> : item.name}
    </span>
  );
}
