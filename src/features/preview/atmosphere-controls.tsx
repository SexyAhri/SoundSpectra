import type { RefObject } from "react";
import { AudioLines, Bookmark, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SpectrumSettings } from "../spectrum/model";
import { useSceneName } from "./use-scene-presentation";
import { sceneStatus } from "./scene-presentation";

export function AtmosphereControls({
  settings,
  demo,
  running,
  audioState,
  disabled,
  onDemo,
  onLibrary,
  onExpand,
  libraryRef,
}: {
  settings: SpectrumSettings;
  demo: boolean;
  running: boolean;
  audioState?: string;
  disabled: boolean;
  onDemo: (value: boolean) => void;
  onLibrary: () => void;
  onExpand: () => void;
  libraryRef: RefObject<HTMLButtonElement | null>;
}) {
  const scene = useSceneName(settings);
  const status = sceneStatus(settings, demo, running, audioState);
  return (
    <div className="atmosphere-controls">
      <div className="atmosphere-context">
        <h2 className="atmosphere-scene-name">{scene}</h2>
        <span
          className="atmosphere-status"
          role="status"
          data-error={audioState === "error" || undefined}
        >
          {status}
        </span>
      </div>
      <div className="atmosphere-actions">
        <Button
          variant="ghost"
          size="sm"
          role="switch"
          aria-label="演示动效"
          aria-checked={demo}
          disabled={disabled || running}
          disabledReason={running ? "正在使用真实音频" : undefined}
          title="演示动效：没有音乐时也能欣赏画面"
          onClick={() => onDemo(!demo)}
        >
          <AudioLines size={15} />
          演示动效
        </Button>
        <Button
          ref={libraryRef}
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onLibrary}
        >
          <Bookmark size={15} />
          场景收藏
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="放大画面"
          title="放大画面"
          onClick={onExpand}
        >
          <Maximize2 size={16} />
        </Button>
      </div>
    </div>
  );
}
