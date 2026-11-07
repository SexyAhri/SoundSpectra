import type { RefObject } from "react";
import { Expand, Monitor } from "lucide-react";
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
  status,
  loaded,
  busy,
  saveState,
  update,
  onArrange,
  previewArrange,
  active,
  bands,
  receivedAt,
  demo,
  rail,
}: {
  settings: SpectrumSettings;
  status: RuntimeStatus;
  loaded: boolean;
  busy: boolean;
  saveState: string;
  update: SettingsUpdate;
  onArrange: () => void;
  previewArrange: boolean;
  active: boolean;
  bands: RefObject<Float32Array>;
  receivedAt: RefObject<number>;
  demo: boolean;
  rail?: RailController;
}) {
  return (
    <footer className="workspace-footer" aria-label="播放与桌面控制">
      <AudioSourcePanel status={status} active={active} />
      <div className="workspace-meter" aria-hidden="true">
        <LiveMeter
          bands={bands}
          receivedAt={receivedAt}
          demo={demo}
          active={active}
        />
      </div>
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
        {rail && <label className="desktop-toggle" htmlFor="rail-desktop-switch">
          <span>拾光绳</span>
          <Switch id="rail-desktop-switch" aria-label="显示桌面拾光绳" checked={rail.settings.enabled}
            disabled={!rail.loaded || !rail.supported || rail.pending > 0}
            onCheckedChange={enabled => { void rail.change({ type: 'enable', enabled }).catch(() => {}) }} />
        </label>}
        {(
          <Button
            variant="outline"
            disabled={
              !loaded ||
              busy ||
              saveState !== "saved" ||
              (!native && !previewArrange)
            }
            onClick={onArrange}
          >
            <Expand size={13} />
            {busy
              ? "正在切换…"
              : status.editing
                ? "完成调整"
                : previewArrange
                  ? "在预览中布置"
                  : "调整桌面位置"}
          </Button>
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
    </footer>
  );
}
