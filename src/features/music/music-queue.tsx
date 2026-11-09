import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { musicClient } from "./client";
import { MusicCover } from "./music-cover";
import { VirtualRows } from "./virtual-rows";
import type { Playback } from "./types";

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
  const entries =
    p.entryIds?.length === p.queue.length
      ? p.entryIds
      : p.queue.map((_, i) => `legacy-${i}`);
  useEffect(
    () =>
      setSelected((s) =>
        s.filter((id) => entries.includes(id) && id !== entries[p.index]),
      ),
    [p.queueRevision, p.index],
  );
  const move = (from: number, to: number) => {
    if (to < 0 || to >= entries.length) return;
    const order = [...entries];
    order.splice(to, 0, order.splice(from, 1)[0]);
    void perform(() => musicClient.edit({ action: "reorder", entries: order }));
  };
  return (
    <>
      <div className="library-queue-actions">
        <Button
          size="sm"
          variant="ghost"
          disabled={!p.index}
          onClick={() =>
            void perform(() => musicClient.edit({ action: "clear-played" }))
          }
        >
          清除已播放
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!selected.length}
          onClick={() =>
            void perform(async () => {
              await musicClient.edit({ action: "remove", entries: selected });
              setSelected([]);
            })
          }
        >
          移除所选 ({selected.length})
        </Button>
      </div>
      <div className="library-queue-list">
        {!p.queue.length && (
          <div className="library-empty">队列为空，选择歌曲开始播放</div>
        )}
        <VirtualRows
          count={p.queue.length}
          height={61}
          row={(i) => {
            const t = p.queue[i],
              id = entries[i];
            return (
              <div
                className={`library-queue-row ${i === p.index ? "current" : ""}`}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = entries.indexOf(
                    e.dataTransfer.getData("text/plain"),
                  );
                  if (from >= 0) move(from, i);
                }}
              >
                <input
                  type="checkbox"
                  aria-label={`选择 ${t.title}`}
                  checked={selected.includes(id)}
                  disabled={i === p.index}
                  onChange={(e) =>
                    setSelected((s) =>
                      e.target.checked ? [...s, id] : s.filter((v) => v !== id),
                    )
                  }
                />
                <button
                  className="library-queue-song"
                  aria-current={i === p.index ? "true" : undefined}
                  onClick={() => command("queue-jump", i)}
                >
                  <span>{i + 1}</span>
                  <MusicCover src={t.cover} small />
                  <div>
                    <strong title={t.title}>{t.title}</strong>
                    <small>{t.artist}</small>
                  </div>
                </button>
                <div className="library-queue-move">
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
                </div>
                <Button
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
