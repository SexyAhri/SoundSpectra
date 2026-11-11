import type { NowPlaying } from "../desktop-card/use-now-playing";
import { memo } from "react";
import { sceneRegions } from "../spectrum/regions";
import { Tabs } from "radix-ui";
import { MusicControls } from "./music-controls";
import {
  SlidersHorizontal,
  Sparkles,
  Palette,
  Move,
  Disc3,
  Type,
  Image,
  GalleryHorizontalEnd,
} from "lucide-react";
import { RailControls } from "../rail/rail-controls";
import type { RailController } from "../rail/use-rail";
import type { SpectrumSettings, SettingsUpdate } from "../spectrum/model";
import { RegionPanel } from "./region-panel";
import { EffectPanel } from "./effect-panel";
import { AppearancePanel } from "./appearance-panel";
import { PositionPanel } from "./position-panel";
import { CardControls } from "../desktop-card/card-controls";
import { LyricControls, type LyricSettingsTab } from "../lyrics/lyric-controls";
import { emptyLyrics, type LyricDocument } from "../lyrics/model";
import { WallpaperDepthControls } from "../wallpaper-depth/wallpaper-depth-controls";
import type { WorkspacePanel } from "./workspace-navigation";
import { MappingControls } from "../performance/mapping-controls";
import "./module-settings.css";

interface Props {
  lyricDocument: LyricDocument;
  nowPlaying?: NowPlaying;
  sceneSettings: SpectrumSettings;
  settings: SpectrumSettings;
  selected: string;
  onSelect: (id: string) => void;
  disabled: boolean;
  editing: boolean;
  updateScene: SettingsUpdate;
  update: (patch: Partial<SpectrumSettings>) => void;
  tab: string;
  onTabChange: (value: string) => void;
  lyricTab: LyricSettingsTab;
  onLyricTabChange: (value: LyricSettingsTab) => void;
  panel: Exclude<WorkspacePanel, "music">;
  rail: RailController;
  selectedRail: string | null;
  selectedRailItem: string | null;
  railSelectionRevision: number;
  onSelectRail: (groupId: string, itemId?: string) => void;
}

function SceneInspectorContent({
  sceneSettings,
  settings,
  lyricDocument,
  nowPlaying,
  selected,
  onSelect,
  disabled,
  editing,
  updateScene,
  update,
  panel,
  tab,
  onTabChange,
  lyricTab,
  onLyricTabChange,
  rail,
  selectedRail,
  selectedRailItem,
  railSelectionRevision,
  onSelectRail,
}: Props) {
  const heading = {
    scene: "灯效设置",
    lyrics: "歌词动效",
    card: "音乐卡片",
    wallpaper: "壁纸与氛围",
    rail: "桌面拾光绳",
  }[panel];
  const Icon = {
    scene: SlidersHorizontal,
    lyrics: Type,
    card: Disc3,
    wallpaper: Image,
    rail: GalleryHorizontalEnd,
  }[panel];
  const description = {
    scene: "选择灯效，调整当前区域的画面",
    lyrics: "选择文字编排，调整阅读与同步",
    card: "选择卡片样式，布置歌曲信息",
    wallpaper: "调整壁纸构图，点缀局部音乐微光",
    rail: "把应用、照片与便签挂在桌面上",
  }[panel];
  return (
    <aside
      className={`inspector module-inspector${panel === "scene" ? " effect-inspector" : ""}`}
      aria-label="对象属性"
    >
      {panel !== "rail" && (
        <div className="inspector-heading">
          <Icon size={16} />
          <div className="inspector-heading-copy">
            <h2>{heading}</h2>
            <p>
              {panel === "scene"
                ? `正在编辑：${sceneRegions(sceneSettings).find((r) => r.id === selected)?.name ?? "主区域"}`
                : description}
            </p>
          </div>
        </div>
      )}
      {panel === "scene" ? (
        <>
          <RegionPanel
            settings={sceneSettings}
            selected={selected}
            onSelect={onSelect}
            disabled={disabled || editing}
            update={updateScene}
          />
          <Tabs.Root
            className="module-scene-tabs"
            value={tab}
            onValueChange={onTabChange}
          >
            <Tabs.List className="module-section-nav" aria-label="灯效设置分类">
              {(
                [
                  ["effect", "动效", Sparkles],
                  ["appearance", "外观", Palette],
                  ["position", "位置", Move],
                ] as const
              ).map(([value, label, Icon]) => (
                <Tabs.Trigger key={value} value={value}>
                  <Icon size={14} />
                  {label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Tabs.Content value="effect" className="module-tab-panel">
              <div className="inspector-scroll" key={`effect-${selected}`}>
                <div className="module-settings-content">
                  <EffectPanel
                    scope={selected}
                    settings={settings}
                    update={update}
                    disabled={disabled}
                    positionDisabled={editing}
                  />
                  <MusicControls
                    settings={settings}
                    update={update}
                    disabled={disabled}
                  />
                </div>
              </div>
            </Tabs.Content>
            <Tabs.Content value="appearance" className="module-tab-panel">
              <div className="inspector-scroll" key={`appearance-${selected}`}>
                <div className="module-settings-content">
                  <AppearancePanel
                    settings={settings}
                    region={selected}
                    update={update}
                    disabled={disabled}
                  />
                  <details className="module-advanced">
                    <summary>音乐响应映射</summary>
                    <MappingControls
                      settings={settings}
                      region={selected}
                      disabled={disabled}
                    />
                  </details>
                </div>
              </div>
            </Tabs.Content>
            <Tabs.Content value="position" className="module-tab-panel">
              <div className="inspector-scroll" key={`position-${selected}`}>
                <div className="module-settings-content">
                  <PositionPanel
                    settings={settings}
                    update={update}
                    disabled={disabled || editing}
                  />
                </div>
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </>
      ) : panel === "lyrics" ? (
        <LyricControls
          tab={lyricTab}
          onTabChange={onLyricTabChange}
          info={nowPlaying}
          settings={sceneSettings}
          document={lyricDocument}
          update={updateScene}
          disabled={disabled || editing}
        />
      ) : (
        <div
          className={`inspector-scroll global-inspector-scroll${panel === "rail" ? " rail-inspector-pane" : ""}`}
          key={panel}
        >
          {panel === "rail" && (
            <RailControls
              controller={rail}
              selectedGroup={selectedRail}
              selectedItem={selectedRailItem}
              selectionRevision={railSelectionRevision}
              onSelect={onSelectRail}
            />
          )}
          {panel === "card" && (
            <CardControls
              info={nowPlaying}
              settings={sceneSettings}
              update={updateScene}
              disabled={disabled || editing}
            />
          )}
          {panel === "wallpaper" && (
            <div className="inspector-content">
              <WallpaperDepthControls
                settings={sceneSettings.wallpaperDepth}
                disabled={disabled || editing}
                onChange={(wallpaperDepth) => updateScene({ wallpaperDepth })}
              />
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

const MemoSceneInspector = memo(SceneInspectorContent);

export function SceneInspector(props: Props) {
  return (
    <MemoSceneInspector
      {...props}
      nowPlaying={
        props.panel === "lyrics" || props.panel === "card"
          ? props.nowPlaying
          : undefined
      }
      lyricDocument={props.panel === "lyrics" ? props.lyricDocument : emptyLyrics}
    />
  );
}
