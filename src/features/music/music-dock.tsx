import { MusicMessage, MusicMessages } from "./music-message";
import { native } from "../spectrum/bridge";
import { useMusic } from "./use-music";
import { MusicTransport } from "./music-transport";
import { MusicDrawer, useMusicPanel } from "./music-drawer";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./music.css";

export function MusicDock() {
  const { snapshot, busy, command, perform, error } = useMusic();
  const panels = useMusicPanel(false);
  if (!native || !snapshot.playback.queue.length) return null;
  return (
    <TooltipProvider>
      <MusicMessages>
      <div className="music-global-dock" aria-label="全局音乐控制">
        {error && (
          <MusicMessage key={error} message={error} />
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
      </MusicMessages>
    </TooltipProvider>
  );
}
