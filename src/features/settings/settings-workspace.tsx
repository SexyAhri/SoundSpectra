import { useCallback, useMemo, useState } from "react";
import { AudioLines, Check, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DrawerHost } from "@/components/ui/drawer";
import { SceneInspector } from "./scene-inspector";
import { useSettings } from "./use-settings";
import { native } from "../spectrum/bridge";
import { DesktopPreview } from "../preview/desktop-preview";
import { regionPatch, settingsForRegion } from "../spectrum/regions";
import type { SpectrumSettings, SettingsUpdate } from "../spectrum/model";
import { useSpectrum } from "../spectrum/use-spectrum";
import { ApplicationToolbar } from "../application/application-toolbar";
import packageInfo from "../../../package.json";
import { useNowPlaying } from "../desktop-card/use-now-playing";
import { useLyrics } from "../lyrics/use-lyrics";
import {
  WorkspaceNavigation,
  useWorkspaceNavigation,
} from "./workspace-navigation";
import { WorkspaceFooter } from "./workspace-footer";
import { useRail } from "../rail/use-rail";
import { useRailDrop } from "../rail/use-rail-drop";
import { useRailPaste } from "../rail/use-rail-paste";
import { WorkspaceTools } from "./workspace-tools";
import { PerformanceProvider } from "../performance/runtime";
import { PerformancePanel } from "../performance/panel";
import { Wordmark } from "./wordmark";
import { MusicProvider } from "../music/use-music";
import { MusicDock } from "../music/music-dock";
import { useUiPreference } from "./use-ui-preference";
import type { LyricSettingsTab } from "../lyrics/lyric-controls";
import { InspectorLayout } from "./inspector-layout";
import { MusicLibrary } from "../music/music-library";

export function SettingsWorkspace() {
  return (
    <MusicProvider>
      <Workspace />
    </MusicProvider>
  );
}
function Workspace() {
  const {
    settings: sceneSettings,
    status,
    loaded,
    busy,
    saveState,
    error,
    update: persistScene,
    recover,
    flush,
    commitScene,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useSettings();
  const updateScene: SettingsUpdate = useCallback(
    (change) =>
      persistScene((current) => {
        const patch = typeof change === "function" ? change(current) : change;
        return "color" in patch && !("followCover" in patch)
          ? { ...patch, followCover: false }
          : patch;
      }),
    [persistScene],
  );
  const [selectedRegion, selectRegion] = useState("primary");
  const selected =
    selectedRegion === "primary" ||
    sceneSettings.regions.some((region) => region.id === selectedRegion)
      ? selectedRegion
      : "primary";
  const settings = useMemo(
    () => settingsForRegion(sceneSettings, selected),
    [sceneSettings, selected],
  );
  const update = useCallback(
    (patch: Partial<SpectrumSettings>) =>
      updateScene((current) =>
        regionPatch(
          current,
          selected,
          "color" in patch && !("followCover" in patch)
            ? { ...patch, followCover: false }
            : patch,
        ),
      ),
    [updateScene, selected],
  );
  const [arrangeRequest, requestArrange] = useState(0);
  const [libraryRequest, requestLibrary] = useState(0);
  const [demo, setDemo] = useState(false);
  const [applicationOpen, setApplicationOpen] = useState(false);
  const navigation = useWorkspaceNavigation();
  const [lyricTab, selectLyricTab] = useUiPreference<LyricSettingsTab>(
    "soundspectra.lyrics-tab",
    "effect",
    (value): value is LyricSettingsTab =>
      value === "effect" || value === "appearance" || value === "position",
  );
  const inspectorTab =
    navigation.panel === "lyrics" ? lyricTab : navigation.tab;
  const rail = useRail();
  const [selectedRail, selectRail] = useState<string | null>("apps");
  const [selectedRailItem, selectRailItem] = useState<string | null>(null);
  const [railSelectionRevision, setRailSelectionRevision] = useState(0);
  const onSelectRail = useCallback(
    (groupId: string, itemId?: string) => {
      selectRail(groupId);
      selectRailItem(itemId ?? null);
      if (itemId) setRailSelectionRevision((value) => value + 1);
      navigation.selectPanel("rail");
    },
    [navigation.selectPanel],
  );
  const beforeClose = useCallback(async () => {
    await flush();
    await rail.flush();
  }, [flush, rail.flush]);
  const railDropError = useRailDrop(
    rail,
    selectedRail,
    navigation.panel === "rail" && !applicationOpen,
  );
  useRailPaste(
    rail,
    selectedRail,
    navigation.panel === "rail" && !applicationOpen,
  );
  const { bands, receivedAt, analysis, error: spectrumError } = useSpectrum();
  const running = status.state === "listening";
  const nowPlaying = useNowPlaying(!applicationOpen);
  const lyricDocument = useLyrics(
    sceneSettings.lyrics,
    nowPlaying,
    !applicationOpen,
  );
  return (
    <PerformanceProvider info={nowPlaying}>
      <div className="app-shell studio-shell">
        <aside className="sidebar" aria-label="主导航">
          <div
            className="brand-mark"
            title="SoundSpectra"
            aria-label="SoundSpectra"
          >
            <AudioLines size={24} />
            <span className="brand-monogram">SS</span>
          </div>
          <WorkspaceNavigation
            panel={navigation.panel}
            onChange={navigation.selectPanel}
          />
          <div className="sidebar-bottom">
            <button
              className="sidebar-settings"
              aria-label="应用设置与更新"
              title="应用设置与更新"
              onClick={() => setApplicationOpen(true)}
            >
              <Settings2 size={20} />
              <span>设置</span>
            </button>
            <span className="sidebar-version">{packageInfo.version}</span>
          </div>
        </aside>
        <div className="workspace-shell">
          <header className="topbar" data-tauri-drag-region>
            <h1
              className="workspace-title"
              aria-label="SoundSpectra"
              data-tauri-drag-region
            >
              <Wordmark />
            </h1>
            <div className="topbar-actions">
              <div
                className={`save-status ${saveState === "error" ? "is-error" : ""}`}
                role="status"
              >
                {saveState === "saved" && loaded && <Check size={13} />}
                {!loaded
                  ? error
                    ? "设置读取失败"
                    : "正在读取设置…"
                  : saveState === "saving"
                    ? "正在保存…"
                    : saveState === "error"
                      ? "保存失败"
                      : native
                        ? "设置已保存"
                        : "已保存到此浏览器"}
              </div>
              <ApplicationToolbar
                beforeClose={beforeClose}
                open={applicationOpen}
                onOpenChange={setApplicationOpen}
              />
            </div>
          </header>
          <WorkspaceNavigation
            panel={navigation.panel}
            onChange={navigation.selectPanel}
            mobile
          />
          <DrawerHost
            className="workspace-body"
            scope={`${navigation.panel}:${inspectorTab}:${applicationOpen}`}
          >
            {navigation.panel === "music" ? (
              <MusicLibrary />
            ) : (
              <>
                <main className="main-pane" id="spectrum-workspace">
                  {(error ||
                    spectrumError ||
                    status.desktopError ||
                    (navigation.panel === "rail" && railDropError)) && (
                    <div className="error-banner" role="alert">
                      <span>
                        {error ||
                          spectrumError ||
                          status.desktopError ||
                          railDropError}
                      </span>
                      {!loaded && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={recover}
                        >
                          备份并恢复默认设置
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          loaded ? update({}) : window.location.reload()
                        }
                      >
                        重试
                      </Button>
                    </div>
                  )}
                  <DesktopPreview
                    sceneActions={
                      <PerformancePanel
                        settings={settings}
                        region={selected}
                        disabled={!loaded || busy || status.editing}
                      />
                    }
                    activePanel={navigation.panel}
                    libraryRequest={libraryRequest}
                    editActions={
                      <WorkspaceTools
                        settings={sceneSettings}
                        status={status}
                        rail={rail}
                        lyrics={lyricDocument}
                        loaded={loaded}
                        busy={busy}
                        saveState={saveState}
                        disabled={!loaded || busy || status.editing}
                        update={updateScene}
                        commitScene={commitScene}
                        undo={undo}
                        redo={redo}
                        canUndo={canUndo}
                        canRedo={canRedo}
                        onLibrary={() => requestLibrary((value) => value + 1)}
                        onArrange={() => requestArrange((value) => value + 1)}
                      />
                    }
                    onShow={() => setApplicationOpen(false)}
                    settings={sceneSettings}
                    nowPlaying={nowPlaying}
                    lyricDocument={lyricDocument}
                    commitScene={commitScene}
                    rail={rail}
                    selectedRail={selectedRailItem ?? selectedRail}
                    railEditing={navigation.panel === "rail"}
                    wallpaperEditing={navigation.panel === "wallpaper"}
                    onSelectRail={onSelectRail}
                    selectedRegion={selected}
                    onSelectRegion={(id) => {
                      selectRegion(id);
                      navigation.selectPanel("scene");
                    }}
                    onEditLyrics={() => navigation.selectPanel("lyrics")}
                    onEditCard={() => navigation.selectPanel("card")}
                    onEditWallpaper={() => navigation.selectPanel("wallpaper")}
                    arrangeRequest={arrangeRequest}
                    update={updateScene}
                    bands={bands}
                    receivedAt={receivedAt}
                    analysis={analysis}
                    demo={demo}
                    onDemoChange={setDemo}
                    running={running}
                    audioState={status.state}
                    disabled={!loaded || busy || status.editing}
                    active={!applicationOpen}
                  />
                </main>
                <InspectorLayout
                  scope={`${navigation.panel}:${inspectorTab}:${selected}`}
                >
                  <SceneInspector
                    sceneSettings={sceneSettings}
                    settings={settings}
                    lyricDocument={lyricDocument}
                    nowPlaying={nowPlaying}
                    selected={selected}
                    onSelect={selectRegion}
                    rail={rail}
                    selectedRail={selectedRail}
                    selectedRailItem={selectedRailItem}
                    railSelectionRevision={railSelectionRevision}
                    onSelectRail={onSelectRail}
                    panel={navigation.panel}
                    tab={inspectorTab}
                    onTabChange={navigation.selectTab}
                    lyricTab={lyricTab}
                    onLyricTabChange={selectLyricTab}
                    disabled={!loaded || busy}
                    editing={status.editing}
                    updateScene={updateScene}
                    update={update}
                  />
                </InspectorLayout>
              </>
            )}
          </DrawerHost>
          {navigation.panel !== "music" && <MusicDock />}
          <WorkspaceFooter
            compact={navigation.panel === "music"}
            rail={rail}
            settings={sceneSettings}
            status={status}
            loaded={loaded}
            busy={busy}
            saveState={saveState}
            update={updateScene}
            active={!applicationOpen}
            bands={bands}
            receivedAt={receivedAt}
            demo={demo}
          />
        </div>
      </div>
    </PerformanceProvider>
  );
}
