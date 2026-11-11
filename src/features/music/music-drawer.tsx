import {
  ListMusic,
  MicVocal,
  Settings2,
  X,
  Pin,
  PinOff,
} from "lucide-react";
import { MusicButton as Button } from "./music-hint";
import { MusicLyrics } from "./music-lyrics";
import { MusicQueue } from "./music-queue";
import { MusicSettings } from "./music-settings";
import type { Playback } from "./types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUiPreference } from "../settings/use-ui-preference";
import { fadeUpdate } from "@/components/ui/fade-update";
export type MusicPanel = "queue" | "lyrics" | "settings";
export function useMusicPanel(allowDock = true) {
  const [panel, changePanel] = useState<MusicPanel | null>(null);
  const [preferredDocked, setDocked] = useUiPreference(
    "soundspectra.music-panel-docked",
    true,
    (v): v is boolean => typeof v === "boolean",
  );
  const docked = allowDock && preferredDocked;
  const opener = useRef<HTMLElement | null>(null);
  const setPanel = useCallback((next: MusicPanel | null) => {
    const active = document.activeElement;
    if (
      next &&
      active instanceof HTMLElement &&
      active.matches("[data-music-panel-toggle]")
    )
      opener.current = active;
    fadeUpdate(".library-panel", () => {
      changePanel(next);
      if (!next && active instanceof Element && active.closest(".library-panel"))
        requestAnimationFrame(() => {
          if (opener.current?.isConnected)
            opener.current.focus({ preventScroll: true });
        });
    });
  }, []);
  useEffect(() => {
    if (!panel) return;
    const outside = (event: PointerEvent) => {
      if (
        panel !== "settings" &&
        docked &&
        matchMedia("(min-width: 1200px)").matches
      )
        return;
      if (
        event.target instanceof Element &&
        !event.target.closest(
          ".library-panel, [data-music-panel-toggle], .library-choice-menu",
        )
      )
        setPanel(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !(
          event.target instanceof Element &&
          event.target.closest(".library-choice-menu")
        )
      )
        setPanel(null);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [panel, docked, setPanel]);
  return {
    panel,
    setPanel,
    docked,
    setDocked: allowDock ? setDocked : undefined,
  };
}
export function MusicDrawer({
  panel,
  setPanel,
  docked,
  setDocked,
  playback: p,
  command,
  perform,
}: {
  panel: MusicPanel;
  setPanel: (panel: MusicPanel | null) => void;
  docked?: boolean;
  setDocked?: (value: boolean) => void;
  playback: Playback;
  command: (action: string, value?: number) => void;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <aside
      className="library-panel"
      data-panel={panel}
      data-docked={docked || undefined}
      aria-label={
        panel === "queue"
          ? "播放队列面板"
          : panel === "lyrics"
            ? "歌曲歌词面板"
            : "音乐库设置面板"
      }
    >
      <header>
        <div className="library-panel-title">
          <span className="library-panel-icon">
            {panel === "settings" ? (
              <Settings2 size={19} />
            ) : panel === "queue" ? (
              <ListMusic size={19} />
            ) : (
              <MicVocal size={19} />
            )}
          </span>
          <div>
            <strong>
              {panel === "queue"
                ? `播放队列 · ${p.queue.length} 首`
                : panel === "lyrics"
                  ? "歌曲歌词"
                  : "音乐库设置"}
            </strong>
            <small>
              {panel === "settings"
                ? "容量、播放与工具"
                : panel === "queue"
                  ? "接下来，听这些"
                  : "每一句，都跟上旋律"}
            </small>
          </div>
        </div>
        <div>
          {panel !== "settings" && setDocked && (
            <Button
              variant={docked ? "secondary" : "ghost"}
              size="sm"
              className="library-dock-toggle"
              aria-label={docked ? "取消固定面板" : "固定面板"}
              title={
                docked
                  ? "取消固定后，点击面板外部会收起"
                  : "固定后，点击面板外部仍保持打开"
              }
              aria-pressed={docked}
              onClick={() => setDocked(!docked)}
            >
              {docked ? <Pin size={14} /> : <PinOff size={14} />}
              {docked ? "已固定" : "固定"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="收起面板"
            onClick={() => setPanel(null)}
          >
            <X size={16} />
          </Button>
        </div>
      </header>
      {panel === "lyrics" ? (
        <MusicLyrics playback={p} command={command} />
      ) : panel === "queue" ? (
        <MusicQueue playback={p} command={command} perform={perform} />
      ) : (
        <MusicSettings playback={p} command={command} perform={perform} />
      )}
    </aside>
  );
}
