import { MusicButton } from "./music-hint";
import { X } from "lucide-react";
import { native } from "../spectrum/bridge";
import { useMusic } from "./use-music";
import { MusicTransport } from "./music-transport";
import { MusicDrawer, useMusicPanel } from "./music-drawer";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./music.css";

export function MusicDock() {
  const { snapshot, busy, command, perform, error, setError } = useMusic();
  const panels = useMusicPanel(false);
  if (!native || !snapshot.playback.queue.length) return null;
  return (
    <TooltipProvider>
      <div className="music-global-dock" aria-label="全局音乐控制">
        {error && (
          <div className="library-dock-error" role="alert">
            {error}
            <MusicButton
              variant="ghost"
              size="icon-sm"
              aria-label="收起播放错误"
              onClick={() => setError(null)}
            >
              <X size={14} />
            </MusicButton>
          </div>
        )}
        <MusicTransport
          compact
          playback={snapshot.playback}
          busy={busy}
          command={command}
          panel={panels.panel === "settings" ? null : panels.panel}
          onPanel={(next) =>
            panels.setPanel(panels.panel === next ? null : next)
          }
        />
        {panels.panel && (
          <MusicDrawer
            {...panels}
            panel={panels.panel}
            playback={snapshot.playback}
            command={command}
            perform={perform}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
