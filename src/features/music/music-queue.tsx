import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ArrowDown, LocateFixed, Trash2, X } from "lucide-react";
import { MusicButton as Button, MusicHint } from "./music-hint";
import { musicClient } from "./client";
import { MusicCover } from "./music-cover";
import { VirtualRows } from "./virtual-rows";
import type { Playback } from "./types";
import "./music-queue.css";

const rowHeight = 61;

export function MusicQueue({
  playback: p,
  command,
  perform,
}: {
  playback: Playback;
  command: (action: string, value?: number) => void;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [managing, setManaging] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const located = useRef(false);
  const entries = useMemo(() =>
    p.entryIds?.length === p.queue.length
      ? p.entryIds
      : p.queue.map((_, i) => `legacy-${i}`), [p.entryIds, p.queue]);
  useEffect(() => {
    const removable = new Set(entries);
    removable.delete(entries[p.index]);
    setSelected((previous) => {
      const next = previous.filter((id) => removable.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [entries, p.index]);
  const locateCurrent = () => {
    const host = list.current;
    if (!host || !p.queue[p.index]) return;
    host.scrollTop = Math.max(0, p.index * rowHeight - (host.clientHeight - rowHeight) * 0.35);
    // VirtualRows shares this scroll surface and must materialize distant rows.
    host.dispatchEvent(new Event("scroll"));
  };
  useLayoutEffect(() => {
    if (located.current || !p.queue[p.index]) return;
    locateCurrent();
    located.current = true;
    // Opening owns the initial position; playback updates never interrupt browsing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.index, p.queue.length]);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= entries.length) return;
    const order = [...entries];
    order.splice(to, 0, order.splice(from, 1)[0]);
    void perform(() => musicClient.edit({ action: "reorder", entries: order }));
  };
  return (
    <>
      <div className="music-queue-toolbar">
        <Button
          size="sm"
          variant="ghost"
          disabled={!p.queue[p.index]}
          onClick={locateCurrent}
        >
          <LocateFixed size={14} />
          定位当前歌曲
        </Button>
        <Button
          size="sm"
          variant={managing ? "secondary" : "ghost"}
          aria-label="管理播放队列"
          aria-pressed={managing}
          disabled={!p.queue.length && !managing}
          onClick={() => {
            setManaging(!managing);
            setSelected([]);
          }}
        >
          {managing ? "完成" : "管理"}
        </Button>
      </div>
      {managing && (
        <div className="library-queue-actions music-queue-management" aria-label="队列管理操作">
          <Button size="sm" variant="ghost" disabled={p.index <= 0}
            onClick={() => void perform(() => musicClient.edit({ action: "clear-played" }))}>
            清除已播放
          </Button>
          <Button size="sm" variant="ghost" disabled={!selected.length}
            onClick={() => void perform(async () => {
              await musicClient.edit({ action: "remove", entries: selected });
              setSelected([]);
            })}>
            移除所选 ({selected.length})
          </Button>
          <Button size="sm" variant="ghost" disabled={!p.queue.length} onClick={() => command("clear")}>
            <Trash2 size={13} />清空
          </Button>
        </div>
      )}
      <div ref={list} className="library-queue-list music-queue-list" data-managing={managing || undefined}>
        {!p.queue.length && (
          <div className="library-empty">队列为空，选择歌曲开始播放</div>
        )}
        <VirtualRows
          count={p.queue.length}
          height={rowHeight}
          row={(i) => {
            const t = p.queue[i],
              id = entries[i];
            return (
              <div
                className={`library-queue-row music-queue-row ${i === p.index ? "current" : ""}`}
                draggable={managing}
                onDragStart={(e) => e.dataTransfer.setData("text/plain", id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!managing) return;
                  const from = entries.indexOf(
                    e.dataTransfer.getData("text/plain"),
                  );
                  if (from >= 0) move(from, i);
                }}
              >
                {managing && <input
                  type="checkbox"
                  aria-label={`选择 ${t.title}`}
                  checked={selected.includes(id)}
                  disabled={i === p.index}
                  onChange={(e) =>
                    setSelected((s) =>
                      e.target.checked ? [...s, id] : s.filter((v) => v !== id),
                    )
                  }
                />}
                <button
                  className="library-queue-song"
                  aria-current={i === p.index ? "true" : undefined}
                  onClick={() => command("queue-jump", i)}
                >
                  <span>{i + 1}</span>
                  <MusicCover src={t.cover} small />
                  <div>
                    <MusicHint text={t.title}>
                      <strong>{t.title}</strong>
                    </MusicHint>
                    <small>{t.artist}</small>
                  </div>
                  {i === p.index ? <span className="music-queue-position">当前</span> :
                    (p.mode === "sequence" || p.mode === "loop") && i === p.index + 1 ?
                      <span className="music-queue-position">下一首</span> : null}
                </button>
                {managing && <div className="library-queue-move">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`上移 ${t.title}`}
                    disabled={!i}
                    onClick={() => move(i, i - 1)}
                  >
                    <ArrowUp size={11} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`下移 ${t.title}`}
                    disabled={i === p.queue.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    <ArrowDown size={11} />
                  </Button>
                </div>}
                <Button
                  className="music-queue-remove"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`从队列移除 ${t.title}`}
                  disabled={i === p.index}
                  onClick={() =>
                    void perform(() =>
                      musicClient.edit({ action: "remove", entries: [id] }),
                    )
                  }
                >
                  <X size={13} />
                </Button>
              </div>
            );
          }}
        />
      </div>
    </>
  );
}
