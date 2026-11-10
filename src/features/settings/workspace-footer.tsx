import type { RefObject } from "react";
import { Popover } from "radix-ui";
import { Monitor, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ChoiceSelect } from "@/components/ui/choice-select";
import { AudioSourcePanel } from "../audio/audio-source-panel";
import { LiveMeter } from "../desktop-card/live-meter";
import { native } from "../spectrum/bridge";
import type {
  RenderQuality,
  RuntimeStatus,
  SettingsUpdate,
  SpectrumSettings,
} from "../spectrum/model";
import type { RailController } from "../rail/use-rail";

export function WorkspaceFooter({
  settings,
  compact = false,
  status,
  loaded,
  busy,
  saveState,
  update,
  active,
  bands,
  receivedAt,
  demo,
  rail,
}: {
  settings: SpectrumSettings;
  compact?: boolean;
  status: RuntimeStatus;
  loaded: boolean;
  busy: boolean;
  saveState: string;
  update: SettingsUpdate;
  active: boolean;
  bands: RefObject<Float32Array>;
  receivedAt: RefObject<number>;
  demo: boolean;
  rail?: RailController;
}) {
  const controls = (
    <div className="workspace-output-controls">
      <section className="desktop-actions" aria-label="桌面效果控制">
        <label className="desktop-toggle" htmlFor="desktop-switch">
          <Monitor size={16} />
          <span>显示到桌面</span>
          <Switch
            id="desktop-switch"
            disabled={
              !native ||
              !loaded ||
              busy ||
              saveState === "saving" ||
              status.editing
            }
            checked={settings.enabled}
            aria-description="控制灯效、歌词、音乐卡片和立体壁纸的桌面输出"
            onCheckedChange={(enabled) => update({ enabled })}
          />
        </label>
        {rail && (
          <label className="desktop-toggle" htmlFor="rail-desktop-switch">
            <span>拾光绳</span>
            <Switch
              id="rail-desktop-switch"
              aria-label="显示桌面拾光绳"
              checked={rail.settings.enabled}
              disabled={!rail.loaded || !rail.supported || rail.pending > 0}
              onCheckedChange={(enabled) => {
                void rail.change({ type: "enable", enabled }).catch(() => {});
              }}
            />
          </label>
        )}
      </section>
      <div className="quality-control inspector-performance">
        <ChoiceSelect
          label="渲染性能"
          value={settings.quality}
          disabled={!loaded || busy}
          onChange={(value) => update({ quality: value as RenderQuality })}
          options={[
            { value: "eco", label: "省电 · 30 帧" },
            { value: "balanced", label: "均衡 · 60 帧" },
            { value: "smooth", label: "流畅 · 120 帧" },
            {
              value: "unlimited",
              label: "不限制",
              description: "跟随屏幕刷新，不额外限帧",
            },
          ]}
        />
      </div>
    </div>
  );
  return (
    <footer
      className={`workspace-footer${compact ? " workspace-footer-compact" : ""}`}
      aria-label="播放与桌面控制"
    >
      <AudioSourcePanel status={status} active={active} />
      <div className="workspace-meter" aria-hidden="true">
        <LiveMeter
          bands={bands}
          receivedAt={receivedAt}
          demo={demo}
          active={active}
        />
      </div>
      {compact ? (
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button variant="outline" size="sm" aria-label="桌面与性能">
              <SlidersHorizontal size={14} />
              桌面与性能
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="workspace-output-popover"
              side="top"
              align="end"
              sideOffset={12}
              collisionPadding={12}
            >
              <header>
                <strong>桌面与性能</strong>
                <Popover.Close asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="收起桌面控制"
                  >
                    <X size={15} />
                  </Button>
                </Popover.Close>
              </header>
              {controls}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : (
        controls
      )}
    </footer>
  );
}
