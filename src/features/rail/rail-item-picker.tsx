import { useEffect, useMemo, useRef, useState } from "react";
import { Link2, Search, X } from "lucide-react";
import { kindLabels, type RailItem } from "./model";
import { RailMedia } from "./rail-media";

export function RailItemPicker({
  items,
  activeId,
  missing,
  dragging,
  target,
  side,
  onChoose,
}: {
  items: RailItem[];
  activeId: string | null;
  missing: string[];
  dragging: string | null;
  target: string | null;
  side: "before" | "after" | null;
  onChoose: (item: RailItem) => void;
}) {
  const [query, setQuery] = useState("");
  const previousIds = useRef(items.map((item) => item.id));
  useEffect(() => {
    if (items.some((item) => !previousIds.current.includes(item.id)))
      setQuery("");
    previousIds.current = items.map((item) => item.id);
  }, [items]);
  const filtered = useMemo(() => {
    const words = query
      .normalize("NFKC")
      .toLocaleLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return items.filter((item) => {
      const label = `${item.name} ${item.path} ${kindLabels[item.kind]}`
        .normalize("NFKC")
        .toLocaleLowerCase();
      return words.every((word) => label.includes(word));
    });
  }, [items, query]);
  return (
    <>
      <div className="rail-picker-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          aria-label="搜索挂件"
          placeholder="搜索名称或路径"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              event.preventDefault();
              setQuery("");
            }
          }}
        />
        {query && (
          <button
            type="button"
            aria-label="清空挂件搜索"
            onClick={() => setQuery("")}
          >
            <X size={14} />
          </button>
        )}
        <small aria-live="polite">
          {filtered.length} / {items.length}
        </small>
      </div>
      <div className="rail-overflow-items">
        {filtered.map((item) => {
          const unavailable = missing.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              className="rail-overflow-entry"
              data-rail-list-item={item.id}
              data-dragging={dragging === item.id || undefined}
              data-reorder-side={target === item.id ? side : undefined}
              draggable={false}
              aria-label={`选择${item.name}，${kindLabels[item.kind]}${unavailable ? "，目标失效" : ""}`}
              aria-pressed={activeId === item.id}
              title={`${item.name}${item.path ? `\n${item.path}` : ""}${unavailable ? "\n目标已移动或删除" : ""}`}
              onClick={() => onChoose(item)}
            >
              <span className="rail-overflow-media">
                <RailMedia item={item} unavailable={unavailable} />
                {unavailable && (
                  <span className="rail-overflow-missing" aria-hidden="true">
                    <Link2 size={12} />
                  </span>
                )}
              </span>
              <span>{item.name}</span>
            </button>
          );
        })}
        {!filtered.length && (
          <p className="rail-picker-empty" role="status">
            {query.trim()
              ? "没有找到匹配的挂件"
              : "还没有挂件，拖入桌面项目即可添加"}
          </p>
        )}
      </div>
    </>
  );
}
