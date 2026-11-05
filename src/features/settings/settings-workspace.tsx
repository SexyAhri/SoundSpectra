import { useState } from "react";
import { AudioLines, Check, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SceneInspector } from "./scene-inspector";
import { useSettings } from "./use-settings";
import { native } from "../spectrum/bridge";
import { DesktopPreview } from "../preview/desktop-preview";
import { regionPatch, settingsForRegion } from "../spectrum/regions";
import type { SpectrumSettings } from "../spectrum/model";
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

export function SettingsWorkspace() {
  const {
    settings: sceneSettings,
    status,
    loaded,
    busy,
    saveState,
    error,
    update: updateScene,
    edit,
    recover,
    flush,
    commitScene,
  } = useSettings();
  const [selectedRegion, selectRegion] = useState("primary");
  const selected =
    selectedRegion === "primary" ||
    sceneSettings.regions.some((region) => region.id === selectedRegion)
      ? selectedRegion
      : "primary";
  const settings = settingsForRegion(sceneSettings, selected);
  const update = (patch: Partial<SpectrumSettings>) =>
    updateScene((current) => regionPatch(current, selected, patch));
  const [arrangeRequest, requestArrange] = useState(0);
  const [demo, setDemo] = useState(!native);
  const [applicationOpen, setApplicationOpen] = useState(false);
  const navigation = useWorkspaceNavigation();
  const rail = useRail();
  const [selectedRail, selectRail] = useState<string | null>("apps");
  const [selectedRailItem, selectRailItem] = useState<string | null>(null);
  const onSelectRail = (groupId: string, itemId?: string) => {
    selectRail(groupId);
    selectRailItem(itemId ?? null);
    navigation.selectPanel("rail");
  };
  useRailDrop(rail, selectedRail, navigation.panel === "rail");
  const { bands, receivedAt, analysis, error: spectrumError } = useSpectrum();
  const running = status.state === "listening";
  const nowPlaying = useNowPlaying(!applicationOpen);
  const lyricDocument = useLyrics(
    sceneSettings.lyrics,
    nowPlaying,
    !applicationOpen,
  );
  const previewArrange =
    sceneSettings.regions.length ||
    !sceneSettings.regionVisible ||
    sceneSettings.desktopCard.enabled ||
    sceneSettings.lyrics.enabled;
  return (
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
          <h1 className="workspace-title" data-tauri-drag-region>
            SoundSpectra<span className="workspace-edition">STUDIO</span>
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
              beforeClose={async () => {
                await flush();
                await rail.flush();
              }}
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
        <div className="workspace-body">
          <main className="main-pane" id="spectrum-workspace">
            {(error || spectrumError || status.desktopError) && (
              <div className="error-banner" role="alert">
                <span>{error || spectrumError || status.desktopError}</span>
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
              settings={sceneSettings}
              nowPlaying={nowPlaying}
              lyricDocument={lyricDocument}
              commitScene={commitScene}
              rail={rail}
              selectedRail={selectedRailItem ?? selectedRail}
              railEditing={navigation.panel === "rail"}
              onSelectRail={onSelectRail}
              selectedRegion={selected}
              onSelectRegion={(id) => {
                selectRegion(id);
                navigation.selectPanel("scene");
              }}
              onEditLyrics={() => navigation.selectPanel("lyrics")}
              onEditCard={() => navigation.selectPanel("card")}
              arrangeRequest={arrangeRequest}
              update={updateScene}
              bands={bands}
              receivedAt={receivedAt}
              analysis={analysis}
              demo={demo}
              onDemoChange={setDemo}
              running={running}
              disabled={!loaded || busy || status.editing}
              active={!applicationOpen}
            />
          </main>
          <SceneInspector
            sceneSettings={sceneSettings}
            settings={settings}
            lyricDocument={lyricDocument}
            selected={selected}
            onSelect={selectRegion}
            rail={rail}
            selectedRail={selectedRail}
            selectedRailItem={selectedRailItem}
            onSelectRail={onSelectRail}
            panel={navigation.panel}
            tab={navigation.tab}
            onTabChange={navigation.selectTab}
            disabled={!loaded || busy}
            editing={status.editing}
            updateScene={updateScene}
            update={update}
          />
        </div>
        <WorkspaceFooter
          settings={sceneSettings}
          status={status}
          loaded={loaded}
          busy={busy}
          saveState={saveState}
          update={updateScene}
          onArrange={
            status.editing || !previewArrange
              ? edit
              : () => requestArrange((value) => value + 1)
          }
          previewArrange={!!previewArrange}
          active={!applicationOpen}
          bands={bands}
          receivedAt={receivedAt}
          demo={demo}
        />
      </div>
    </div>
  );
}
