import { useUiPreference } from "../settings/use-ui-preference";
import { ModalContent } from "@/components/ui/modal";
import { IconButton } from "@/components/ui/icon-button";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { Dialog } from "radix-ui";
import {
  ImagePlus,
  Maximize2,
  Monitor,
  Move,
  RefreshCw,
  Scan,
  Sparkles,
  Undo2,
  X,
  Bookmark,
  AudioLines,
  Grid2X2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { native } from "../spectrum/bridge";
import type { SpectrumSettings, SettingsUpdate } from "../spectrum/model";
import type { AnalysisSnapshot } from "../spectrum/spectrum-canvas";
import { SpectrumCanvas } from "../spectrum/spectrum-canvas";
import {
  referenceScreen,
  wallpaperStyle,
  type DesktopBackground,
  type PreviewImage,
  type ScreenRect,
} from "./background";
import {
  moveBounds,
  resizeBounds,
  snapBounds,
  type Bounds,
} from "./preview-geometry";
import { PreviewObjectList } from "./preview-object-list";
import { useBackground } from "./use-background";
import { LayoutPresets } from "./layout-presets";
import {
  sceneRegions,
  regionPatch,
  settingsForRegion,
} from "../spectrum/regions";
import { MaskEditor } from "./mask-editor";
import { MaskControls } from "./mask-controls";
import { AutoSceneDialog } from "./auto-scene-dialog";
import {
  composition,
  rememberChoice,
  type SceneComposition,
} from "./scene-suggestions";
import { SceneLibraryDialog } from "./scene-library-dialog";
import { layout, type SceneLayout } from "./scene-library";
import { desktopLayout } from "./desktop-scenes";
import { CardLayer } from "../desktop-card/card-layer";
import {
  emptyNowPlaying,
  type NowPlaying,
} from "../desktop-card/use-now-playing";
import {
  WallpaperSurface,
  wallpaperFilter,
} from "../wallpaper-depth/wallpaper-surface";
import { WallpaperAreaEditor } from "../wallpaper-depth/wallpaper-area-editor";
import { useDepthImage } from "../wallpaper-depth/image-store";
import { customWallpaperBackground } from "../wallpaper-depth/wallpaper-layout";
import { LyricLayer } from "../lyrics/lyric-layer";
import { emptyLyrics, type LyricDocument } from "../lyrics/model";
import { RailLayer } from "../rail/rail-layer";
import type { RailController } from "../rail/use-rail";
import { useCoverColors } from "../desktop-card/use-cover-colors";
import { CoverColorControl } from "../desktop-card/cover-color-control";
import { useSceneShortcuts } from "./use-scene-shortcuts";
import { ContextMenu } from "@/components/ui/context-menu";
import { layerIndex } from "./scene-layers";
import { previewObjectActions } from "./preview-object-actions";
import { railObstacles } from "../lyrics/avoid-rail";
import { railPlacementActions } from "../rail/rail-placement-actions";
import { SceneFocusProvider } from "../spectrum/scene-focus";
import { AtmosphereControls } from "./atmosphere-controls";
import { useSceneTransition } from "./use-scene-transition";
import { demoSceneSettings, demoWallpaper, demoBackground, demoRail, demoRailMedia } from "./demo-scene";
import { RailMediaSources } from "../rail/rail-media";

interface Props {
  presentation?: "editor" | "ambient";
  settings: SpectrumSettings;
  update: SettingsUpdate;
  commitScene: (patch: Partial<SceneLayout>) => Promise<SpectrumSettings>;
  bands: RefObject<Float32Array>;
  receivedAt: RefObject<number>;
  analysis: RefObject<AnalysisSnapshot>;
  demo: boolean;
  onDemoChange: (value: boolean) => void;
  running: boolean;
  audioState?: string;
  disabled: boolean;
  active: boolean;
  suspended?: boolean;
  ready: boolean;
  selectedRegion: string;
  onSelectRegion: (id: string) => void;
  arrangeRequest: number;
  nowPlaying?: NowPlaying;
  lyricDocument?: LyricDocument;
  onEditLyrics?: () => void;
  onEditCard?: () => void;
  onEditWallpaper?: () => void;
  rail?: RailController;
  selectedRail?: string | null;
  railEditing?: boolean;
  onSelectRail?: (groupId: string, itemId?: string) => void;
  onShow?: () => void;
  wallpaperEditing?: boolean;
  activePanel?: string;
  libraryRequest?: number;
  editActions?: ReactNode;
  sceneActions?: ReactNode;
}
interface StageProps extends Props {
  viewPreviewOnly?: boolean;
  screen: ScreenRect;
  desktop: DesktopBackground | null;
  image: PreviewImage | null;
  arranging: boolean;
  expanded: boolean;
  masking: boolean;
  selectedMask: string | null;
  onSelectMask: (id: string) => void;
  wallpaperGuides: boolean;
  locks: string[];
  selection: string;
  selectObject: (key: string, itemId?: string) => void;
}

function PreviewStage(props: StageProps) {
  const holder = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const settings = useSceneTransition(
    props.settings,
    props.presentation === "ambient" || !!props.viewPreviewOnly,
    surface,
  );
  const {
    update,
    screen,
    desktop,
    image,
    arranging,
    expanded,
    disabled,
  } = props;
  const colors = useCoverColors(
    settings,
    props.nowPlaying ?? emptyNowPlaying,
    props.active,
  );
  const selectedObject = props.selection;
  // Event callbacks use the latest navigation without invalidating the rail's memo.
  const selectCurrent = useRef(props.selectObject);
  selectCurrent.current = props.selectObject;
  const selectRail = useCallback(
    (groupId: string, itemId?: string) => {
      selectCurrent.current(`rail:${groupId}`, itemId);
    },
    [],
  );
  const lockedRails = useMemo(
    () => props.locks
      .filter((key) => key.startsWith("rail:"))
      .map((key) => key.slice(5)),
    [props.locks],
  );
  const selectObject = props.selectObject;
  const menu =
    selectedObject.startsWith("rail:") && props.rail
      ? railPlacementActions(props.rail, selectedObject.slice(5), () =>
          selectObject(selectedObject),
        )
      : previewObjectActions(settings, selectedObject, update, selectObject);
  if (props.locks.includes(selectedObject))
    menu.actions = menu.actions.map((action) => ({
      ...action,
      disabled: action.id !== "settings" || action.disabled,
    }));
  const logicalScreen = {
    width: screen.width / window.devicePixelRatio,
    height: screen.height / window.devicePixelRatio,
  };
  const obstacles = railObstacles(props.rail?.settings, logicalScreen);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fitted, setFitted] = useState(false);
  const [draft, setDraft] = useState<{ region: string; bounds: Bounds } | null>(
    null,
  );
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });
  const gesture = useRef<{
    id: number;
    region: string;
    x: number;
    y: number;
    width: number;
    height: number;
    start: Bounds;
    next: Bounds;
    resize: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    let frame = 0;
    let revealFrame = 0;
    let disposed = false;
    setFitted(false);
    const measure = () => {
      const available = holder.current!.clientWidth;
      const maxHeight =
        expanded || window.innerWidth > 760
          ? Math.max(1, holder.current!.clientHeight)
          : Infinity;
      const width = Math.min(
        available,
        (maxHeight * screen.width) / screen.height,
      );
      const height = (width * screen.height) / screen.width;
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    // The holder is the source of truth. A window listener also measured the
    // same layout and synchronously rendered the whole preview a second time.
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(holder.current!);
    measure();
    // Sibling layout effects and font metrics can change the available width
    // after the first measurement. Fit once more before revealing the surface.
    void document.fonts.ready.then(() => {
      if (disposed) return;
      let previous = "";
      let stableFrames = 0;
      const reveal = () => {
        const bounds = holder.current!.getBoundingClientRect();
        const geometry = `${bounds.width}:${bounds.height}`;
        stableFrames = geometry === previous ? stableFrames + 1 : 0;
        previous = geometry;
        measure();
        if (stableFrames >= 2) setFitted(props.ready);
        else revealFrame = requestAnimationFrame(reveal);
      };
      revealFrame = requestAnimationFrame(reveal);
    });
    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(revealFrame);
    };
  }, [screen.width, screen.height, expanded, props.ready]);
  useEffect(() => {
    if (disabled || !arranging) {
      gesture.current = null;
      setDraft(null);
      setGuides({ x: null, y: null });
    }
  }, [disabled, arranging]);
  const begin = (
    event: PointerEvent<HTMLElement>,
    resize: boolean,
    region: string,
  ) => {
    if (
      !arranging ||
      disabled ||
      props.locks.includes(`effect:${region}`) ||
      event.button !== 0 ||
      gesture.current
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    const rect = surface.current!.getBoundingClientRect();
    const bounds = settingsForRegion(settings, region).bounds;
    selectObject(`effect:${region}`);
    gesture.current = {
      id: event.pointerId,
      region,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      start: { ...bounds },
      next: { ...bounds },
      resize,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = (event.clientX - current.x) / current.width,
      dy = (event.clientY - current.y) / current.height;
    const bounds = (current.resize ? resizeBounds : moveBounds)(
      current.start,
      dx,
      dy,
    );
    const targets = sceneRegions(settings)
      .filter((region) => region.id !== current.region && region.visible)
      .map((region) => region.bounds);
    if (settings.desktopCard.enabled) targets.push(settings.desktopCard.bounds);
    if (settings.lyrics.enabled) targets.push(settings.lyrics.bounds);
    const snapped =
      !current.resize && !event.altKey
        ? snapBounds(bounds, current.width, current.height, targets)
        : { bounds, x: null, y: null };
    current.next = snapped.bounds;
    setGuides({ x: snapped.x, y: snapped.y });
    setDraft({ region: current.region, bounds: current.next });
  };
  const finish = (event: PointerEvent<HTMLElement>, cancelled = false) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    setGuides({ x: null, y: null });
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled)
      update((latest) =>
        regionPatch(latest, current.region, { bounds: current.next }),
      );
    setDraft(null);
  };
  const keyboard = (
    event: KeyboardEvent<HTMLElement>,
    resize: boolean,
    region: string,
  ) => {
    if (event.key === "Escape" && gesture.current) {
      event.preventDefault();
      event.stopPropagation();
      gesture.current = null;
      setDraft(null);
      setGuides({ x: null, y: null });
      return;
    }
    if (
      disabled ||
      !arranging ||
      props.locks.includes(`effect:${region}`) ||
      gesture.current ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 0.02 : 0.002;
    props.onSelectRegion(region);
    const dx =
      event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy =
      event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    update((latest) =>
      regionPatch(latest, region, {
        bounds: (resize ? resizeBounds : moveBounds)(
          settingsForRegion(latest, region).bounds,
          dx,
          dy,
        ),
      }),
    );
  };
  const regions = sceneRegions(settings),
    count = Math.max(1, regions.filter((region) => region.visible).length);
  return (
    <SceneFocusProvider>
      <div className="preview-stage-holder" ref={holder} data-ambient={props.presentation === "ambient" || undefined}>
        {(!props.ready || !fitted) && <span className="preview-loading" role="status">正在准备预览…</span>}
        <ContextMenu
          {...menu}
          disabled={!arranging || disabled || props.viewPreviewOnly}
          onReturnFocus={() => {
            surface.current
              ?.querySelector<HTMLElement>(
                `[data-preview-object="${CSS.escape(selectedObject)}"]`,
              )
              ?.focus({ preventScroll: true });
          }}
        >
          <div
            className={`desktop-preview${arranging ? " arranging" : ""}`}
            data-ready={props.ready && fitted}
            data-scene-effect={settings.effect}
            aria-hidden={!props.ready || !fitted || undefined}
            ref={surface}
            style={{
              width: size.width || "100%",
              height: size.width ? size.height : undefined,
              aspectRatio: `${screen.width} / ${screen.height}`,
            }}
            onContextMenu={(event) => {
              const target = (event.target as Element).closest<HTMLElement>(
                "[data-preview-object]",
              );
              if (!arranging || disabled || !target || gesture.current) {
                event.preventDefault();
                return;
              }
              selectObject(target.dataset.previewObject!);
            }}
          >
            <div
              className="preview-wallpaper"
              data-testid="preview-wallpaper"
              style={{
                ...wallpaperStyle(image, desktop, screen, size.width),
                filter: wallpaperFilter(settings.wallpaperDepth),
              }}
            />
            <WallpaperSurface
              settings={settings.wallpaperDepth}
              masks={settings.masks}
              analysis={props.analysis}
              image={image}
              background={desktop}
              screen={screen}
              paintImage={false}
              active={props.active}
              demo={props.demo}
              host={surface}
            />
            <div className="preview-corner">
              <span
                className={
                  props.demo
                    ? "demo-dot"
                    : props.running
                      ? "live-dot"
                      : "idle-dot"
                }
              />
              {props.demo
                ? "模拟音频"
                : props.running
                  ? "实时输入"
                  : props.audioState === "silent"
                    ? "音源已连接 · 静音"
                    : "等待音乐播放"}
            </div>
            {regions
              .filter((region) => region.visible || arranging)
              .map((region) => {
                const bounds =
                  draft?.region === region.id ? draft.bounds : region.bounds;
                const selected = arranging
                  ? selectedObject === `effect:${region.id}`
                  : props.selectedRegion === region.id;
                return (
                  <div
                    key={region.id}
                    className={`preview-spectrum${selected ? " selected" : ""}${selected && regions.length > 1 && !arranging && !props.viewPreviewOnly && props.presentation !== "ambient" ? " region-edit-target" : ""}${region.visible ? "" : " region-hidden"}`}
                    data-region-id={region.id}
                    data-preview-object={`effect:${region.id}`}
                    data-selected={
                      selectedObject === `effect:${region.id}` || undefined
                    }
                    style={{
                      left: `${bounds.x * 100}%`,
                      top: `${bounds.y * 100}%`,
                      width: `${bounds.width * 100}%`,
                      height: `${bounds.height * 100}%`,
                      zIndex: layerIndex(settings, `effect:${region.id}`),
                      pointerEvents: arranging || selected ? undefined : "none",
                    }}
                    role={arranging ? "group" : undefined}
                    tabIndex={arranging && !disabled ? 0 : undefined}
                    aria-label={
                      arranging
                        ? `${regions.length > 1 ? region.name + "，" : ""}动效位置，方向键移动，Shift 加速`
                        : undefined
                    }
                    onFocus={() => {
                      if (arranging) selectObject(`effect:${region.id}`);
                    }}
                    onPointerDown={(event) => begin(event, false, region.id)}
                    onPointerMove={move}
                    onPointerUp={(event) => finish(event)}
                    onPointerCancel={(event) => finish(event, true)}
                    onLostPointerCapture={(event) => finish(event, true)}
                    onKeyDown={(event) => keyboard(event, false, region.id)}
                  >
                    {region.visible && (
                      <SpectrumCanvas
                        regionId={region.id}
                        settings={{
                          ...settingsForRegion(colors.settings, region.id),
                          bounds,
                        }}
                        regionCount={count}
                        bands={props.bands}
                        receivedAt={props.receivedAt}
                        analysis={props.analysis}
                        demo={props.demo}
                        active={props.active}
                        suspended={props.suspended}
                        interactive={
                          !disabled &&
                          props.presentation !== "ambient" &&
                          !arranging &&
                          !props.masking &&
                          selected &&
                          !props.locks.includes(`effect:${region.id}`)
                        }
                        onViewChange={
                          props.viewPreviewOnly
                            ? undefined
                            : (view) =>
                                update((latest) =>
                                  regionPatch(latest, region.id, { view }),
                                )
                        }
                      />
                    )}
                    {selected &&
                      regions.length > 1 &&
                      !arranging &&
                      !props.viewPreviewOnly && (
                        <span className="region-edit-label">
                          正在调整：{region.name}
                        </span>
                      )}
                    {arranging && (
                      <>
                        <span
                          className="preview-bounds-label"
                          aria-hidden="true"
                        >
                          {regions.length > 1
                            ? `${region.name}${region.visible ? "" : " · 隐藏"} · `
                            : ""}
                          {Math.round(bounds.width * 100)}% ×{" "}
                          {Math.round(bounds.height * 100)}%
                        </span>
                        <button
                          className="preview-resize"
                          aria-label="缩放动效"
                          title="以中心缩放；方向键微调"
                          disabled={disabled}
                          onPointerDown={(event) =>
                            begin(event, true, region.id)
                          }
                          onPointerMove={move}
                          onPointerUp={(event) => finish(event)}
                          onPointerCancel={(event) => finish(event, true)}
                          onLostPointerCapture={(event) => finish(event, true)}
                          onKeyDown={(event) =>
                            keyboard(event, true, region.id)
                          }
                        />
                      </>
                    )}
                  </div>
                );
              })}
            {settings.desktopCard.enabled && (
              <CardLayer
                onSnap={setGuides}
                zIndex={layerIndex(settings, "card")}
                selected={selectedObject === "card"}
                settings={settings.desktopCard}
                info={props.nowPlaying ?? emptyNowPlaying}
                color={colors.cardColor}
                bands={props.bands}
                receivedAt={props.receivedAt}
                demo={props.demo}
                active={props.active}
                previewSize={{
                  width:
                    logicalScreen.width * settings.desktopCard.bounds.width,
                  height:
                    logicalScreen.height * settings.desktopCard.bounds.height,
                  scale: size.width / logicalScreen.width,
                }}
                arranging={
                  arranging && !disabled && !props.locks.includes("card")
                }
                onSelect={() => selectObject("card")}
                onChange={(bounds) =>
                  update({ desktopCard: { ...settings.desktopCard, bounds } })
                }
              />
            )}
            {settings.lyrics.enabled && (
              <LyricLayer
                analysis={props.analysis}
                onSnap={arranging ? setGuides : undefined}
                settings={settings.lyrics}
                appearance={colors.settings}
                cardAccent={
                  settings.desktopCard.enabled
                    ? settings.desktopCard.accentColor
                    : undefined
                }
                document={props.lyricDocument ?? emptyLyrics}
                info={props.nowPlaying ?? emptyNowPlaying}
                demo={props.demo}
                active={props.active}
                obstacles={obstacles}
                zIndex={layerIndex(settings, "lyrics")}
                selected={selectedObject === "lyrics"}
                draggable={
                  !disabled &&
                  props.presentation !== "ambient" &&
                  !props.masking &&
                  !props.viewPreviewOnly &&
                  !props.locks.includes("lyrics")
                }
                onSelect={() => selectObject("lyrics")}
                onBoundsChange={(bounds, resized) =>
                  update((current) => ({
                    lyrics: {
                      ...current.lyrics,
                      bounds,
                      fontSize: resized
                        ? Math.round(
                            Math.max(
                              18,
                              Math.min(
                                72,
                                current.lyrics.fontSize *
                                  Math.sqrt(
                                    (bounds.width * bounds.height) /
                                      (current.lyrics.bounds.width *
                                        current.lyrics.bounds.height),
                                  ),
                              ),
                            ),
                          )
                        : current.lyrics.fontSize,
                    },
                  }))
                }
              />
            )}
            {props.rail && !props.viewPreviewOnly && (
              <RailLayer
                active={props.active}
                desktopWidth={logicalScreen.width}
                controller={props.rail}
                locked={lockedRails}
                selected={
                  arranging
                    ? selectedObject.startsWith("rail:")
                      ? selectedObject.slice(5)
                      : null
                    : (props.selectedRail ?? null)
                }
                arranging={arranging && !disabled}
                editing={!!props.railEditing && !disabled}
                interactive={!props.masking && !disabled && props.presentation !== "ambient"}
                onSelect={selectRail}
              />
            )}
            {props.masking && (
              <MaskEditor
                masks={settings.masks}
                selected={props.selectedMask}
                onSelect={props.onSelectMask}
                disabled={disabled}
                onChange={(masks) => update({ masks })}
              />
            )}
            {arranging && (guides.x !== null || guides.y !== null) && (
              <div className="preview-alignment-guides" aria-hidden="true">
                {guides.x !== null && (
                  <i
                    className="guide-x"
                    style={{ left: `${guides.x * 100}%` }}
                  />
                )}
                {guides.y !== null && (
                  <i
                    className="guide-y"
                    style={{ top: `${guides.y * 100}%` }}
                  />
                )}
              </div>
            )}
            {props.wallpaperEditing &&
              props.wallpaperGuides &&
              !props.viewPreviewOnly &&
              !arranging &&
              !props.masking && (
                <div
                  className="wallpaper-composition-guides"
                  aria-label="壁纸构图辅助"
                >
                  <i />
                  <i />
                  <i />
                  <i />
                  <span
                    style={{
                      left: `${settings.wallpaperDepth.focusX}%`,
                      top: `${settings.wallpaperDepth.focusY}%`,
                    }}
                  >
                    ＋
                  </span>
                </div>
              )}
            {props.wallpaperEditing &&
              props.wallpaperGuides &&
              settings.wallpaperDepth.ambientEnabled &&
              !disabled &&
              !arranging &&
              !props.masking &&
              !props.viewPreviewOnly && (
                <WallpaperAreaEditor
                  bounds={settings.wallpaperDepth.ambientBounds}
                  onChange={(ambientBounds) =>
                    update((latest) => ({
                      wallpaperDepth: {
                        ...latest.wallpaperDepth,
                        ambientBounds,
                      },
                    }))
                  }
                />
              )}
          </div>
        </ContextMenu>
      </div>
      {!props.viewPreviewOnly && props.presentation !== "ambient" && (
        <CoverColorControl
          settings={settings}
          display={colors.settings}
          message={colors.message}
          available={colors.available}
          disabled={disabled}
          update={update}
        />
      )}
    </SceneFocusProvider>
  );
}

export function DesktopPreview(props: Props) {
  const ambient = props.presentation === "ambient";
  const previewingDemo = ambient && props.demo;
  const previewSettings = useMemo(
    () => previewingDemo ? demoSceneSettings(props.settings) : props.settings,
    [previewingDemo, props.settings],
  );
  const previewRail = useMemo(
    () => previewingDemo && props.rail ? {
      ...props.rail, settings: demoRail, loaded: true, pending: 0, missing: [], error: null,
    } : props.rail,
    [previewingDemo, props.rail],
  );
  const background = useBackground();
  const wallpaper = props.settings.wallpaperDepth;
  const custom = useDepthImage(
    wallpaper.source === "custom" ? wallpaper.revision : "",
  );
  const [wallpaperGuides, setWallpaperGuides] = useState(true);
  const [arranging, setArranging] = useState(false),
    [expanded, setExpanded] = useState(false);
  const [locks, setLocks] = useUiPreference<string[]>(
    "soundspectra.preview-locks",
    [],
    (v): v is string[] =>
      Array.isArray(v) &&
      v.every((key) => typeof key === "string") &&
      v.length <= 100,
  );
  const [selection, setSelection] = useState(`effect:${props.selectedRegion}`);
  useEffect(() => {
    if (props.activePanel === "lyrics") setSelection("lyrics");
    else if (props.activePanel === "card") setSelection("card");
    else if (props.activePanel === "wallpaper") setSelection("wallpaper");
    else if (props.activePanel === "scene")
      setSelection(`effect:${props.selectedRegion}`);
  }, [props.activePanel, props.selectedRegion]);
  const selectObject = (key: string, itemId?: string) => {
    if (ambient) return;
    setSelection(key);
    if (key === "lyrics") props.onEditLyrics?.();
    else if (key === "card") props.onEditCard?.();
    else if (key === "wallpaper") props.onEditWallpaper?.();
    else if (key.startsWith("rail:"))
      props.onSelectRail?.(key.slice(5), itemId);
    else if (key.startsWith("effect:")) props.onSelectRegion(key.slice(7));
  };
  const [masking, setMasking] = useState(false),
    [selectedMask, selectMask] = useState<string | null>(null);
  useEffect(() => {
    if (ambient) {
      setArranging(false);
      setMasking(false);
    }
  }, [ambient]);
  const [autoOpen, setAutoOpen] = useState(false);
  const autoTrigger = useRef<HTMLButtonElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const libraryTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (props.libraryRequest) {
      if (ambient) props.onDemoChange(false);
      setExpanded(false);
      setAutoOpen(false);
      setLibraryOpen(true);
    }
  }, [props.libraryRequest]);
  const [history, setHistory] = useState<{
    before: SceneComposition | SceneLayout;
    after: string;
    masks: boolean;
    desktop?: boolean;
  } | null>(null);
  const [sceneNotice, setSceneNotice] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const canUndo =
    history &&
    history.after ===
      JSON.stringify(
        history.desktop
          ? desktopLayout(props.settings)
          : history.masks
            ? layout(props.settings)
            : composition(props.settings),
      );
  useEffect(() => {
    if (history && !canUndo && !undoing) {
      setHistory(null);
      setSceneNotice(null);
    }
  }, [history, canUndo, undoing]);
  const applyScene = async (
    scene: SceneComposition,
    choice: { key: string; id: string; strength: number },
  ) => {
    const before = composition(props.settings);
    const saved = await props.commitScene(scene);
    setHistory({
      before,
      after: JSON.stringify(composition(saved)),
      masks: false,
    });
    props.onSelectRegion("primary");
    setArranging(false);
    setMasking(false);
    try {
      rememberChoice(choice);
      setSceneNotice({ text: "搭配已应用，可撤销。", error: false });
    } catch {
      setSceneNotice({
        text: "搭配已应用，但未能记住这张壁纸的方案偏好。",
        error: true,
      });
    }
  };
  const applySavedScene = async (scene: SceneLayout, name?: string) => {
    const capture = scene.desktop ? desktopLayout : layout;
    const before = capture(props.settings);
    const saved = await props.commitScene(scene);
    if (ambient) props.onDemoChange(false);
    setHistory({
      before,
      after: JSON.stringify(capture(saved)),
      masks: true,
      desktop: !!scene.desktop,
    });
    props.onSelectRegion("primary");
    setArranging(false);
    setMasking(false);
    setSceneNotice({ text: name ? `「${name}」已应用，可撤销。` : "收藏场景已应用，可撤销。", error: false });
  };
  const undoScene = async () => {
    if (!history || !canUndo || undoing || props.disabled) return;
    setUndoing(true);
    try {
      await props.commitScene(history.before);
      setHistory(null);
      setSceneNotice({ text: "已恢复应用前的搭配。", error: false });
    } catch (error) {
      setSceneNotice({
        text: `撤销失败：${error instanceof Error ? error.message : String(error)}`,
        error: true,
      });
    } finally {
      setUndoing(false);
    }
  };
  useSceneShortcuts({
    disabled: props.disabled,
    apply: applySavedScene,
    show: () => props.onShow?.(),
    open: () => {
      if (ambient) props.onDemoChange(false);
      setExpanded(false);
      setAutoOpen(false);
      setLibraryOpen(true);
    },
    report: (text) => setSceneNotice({ text, error: true }),
  });
  const maskSelection = props.settings.masks.some(
    (mask) => mask.id === selectedMask,
  )
    ? selectedMask
    : (props.settings.masks[0]?.id ?? null);
  useEffect(() => {
    if (props.arrangeRequest) {
      setArranging(true);
      setMasking(false);
    }
  }, [props.arrangeRequest]);
  const fileInput = useRef<HTMLInputElement>(null);
  const screen = previewingDemo ? demoBackground.screen : background.desktop?.screen ?? referenceScreen;
  const systemPreview = props.wallpaperEditing || background.mode === "desktop";
  const image =
    previewingDemo ? demoWallpaper : wallpaper.source === "custom"
      ? custom.image
        ? {
            url: custom.image.dataUrl,
            width: custom.image.width,
            height: custom.image.height,
          }
        : null
      : systemPreview
        ? background.systemImage
        : background.image;
  const desktop =
    previewingDemo ? demoBackground : wallpaper.source === "custom"
      ? customWallpaperBackground(wallpaper, screen)
      : systemPreview
        ? background.desktop
        : null;
  const available =
    wallpaper.source === "custom"
      ? !!custom.image
      : systemPreview
        ? !!background.desktop && !background.error && !background.loading
        : background.mode === "plain" ||
          (background.mode === "custom" && !!background.image);
  const stageProps: StageProps = {
    ...props,
    settings: previewSettings,
    rail: previewRail,
    selectedRail: previewingDemo ? "demo-vscode" : props.selectedRail,
    selection,
    locks,
    wallpaperGuides: wallpaperGuides && !ambient,
    railEditing: props.railEditing && !ambient,
    selectObject,
    screen,
    desktop,
    image,
    arranging: arranging && !props.disabled && !ambient,
    expanded,
    masking: masking && !props.disabled && !ambient,
    selectedMask: maskSelection,
    onSelectMask: selectMask,
    ready: props.ready && (previewingDemo || !native || !!background.desktop || !!background.error),
    active: props.active && props.ready,
  };
  const status =
    wallpaper.source === "custom"
      ? custom.error
      : systemPreview
        ? !native
          ? props.wallpaperEditing
            ? "浏览器无法读取系统壁纸，请在右侧选择自选图片预览。"
            : "浏览器无法读取系统壁纸，可选择参考图片。"
          : background.error
        : background.mode === "custom" && !background.image
          ? "请选择参考图片。"
          : null;
  const stage = <RailMediaSources value={previewingDemo ? demoRailMedia : null}><PreviewStage {...stageProps} /></RailMediaSources>;
  const selectedSettings = settingsForRegion(
    props.settings,
    props.selectedRegion,
  );
  const updateSelected = (patch: Partial<SpectrumSettings>) =>
    props.update((latest) => regionPatch(latest, props.selectedRegion, patch));
  const arrangementButton = (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={arranging ? "完成布置" : "布置"}
      title={arranging ? "完成布置，收起对象编辑框" : "布置：拖动和缩放画面中的对象"}
      disabled={props.disabled}
      aria-pressed={arranging}
      onClick={() => {
        setArranging((value) => !value);
        setMasking(false);
      }}
    >
      <Move size={14} />
    </Button>
  );
  const maskButton = (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={masking ? "完成遮罩" : "遮罩"}
      title={masking ? "完成遮罩，收起遮罩编辑框" : "遮罩：让灯效避开桌面上的指定区域"}
      disabled={props.disabled}
      aria-pressed={masking}
      onClick={() => {
        setMasking((value) => !value);
        setArranging(false);
      }}
    >
      <Scan size={14} />
    </Button>
  );
  const presets = (
    <LayoutPresets
      bounds={selectedSettings.bounds}
      disabled={
        props.disabled || locks.includes(`effect:${props.selectedRegion}`)
      }
      onChange={(bounds) => updateSelected({ bounds })}
    />
  );
  const maskControls = (
    <MaskControls
      masks={props.settings.masks}
      selected={maskSelection}
      onSelect={selectMask}
      disabled={props.disabled}
      onChange={(masks) => props.update({ masks })}
    />
  );
  const objectControls = arranging && !props.disabled && (
    <div className="preview-arrange-toolbar">
      <PreviewObjectList
        settings={props.settings}
        update={props.update}
        rail={props.rail}
        selected={selection}
        locks={locks}
        onToggleLock={(key) =>
          setLocks((old) =>
            old.includes(key)
              ? old.filter((value) => value !== key)
              : [...old, key],
          )
        }
        onSelect={selectObject}
        disabled={props.disabled}
      />
      <span>方向键微调 · Alt 暂停吸附</span>
    </div>
  );
  return (
    <section
      className={`preview-section${ambient ? " atmosphere-preview" : ""}`}
      aria-label={ambient ? "氛围画面" : "效果预览"}
      aria-busy={wallpaper.source === "custom" ? custom.loading : background.loading}
    >
      {!ambient && <div className="section-toolbar">
        <div className="preview-title-actions">
          <h2>
            <Monitor size={16} />
            桌面预览
          </h2>
          <div className="auto-scene-entry">
            <Button
              ref={autoTrigger}
              size="icon-sm"
              variant="ghost"
              aria-label="自动搭配"
              title="自动搭配"
              disabled={props.disabled}
              onClick={() => {
                setExpanded(false);
                setAutoOpen(true);
              }}
            >
              <Sparkles size={14} />
            </Button>
            <Button
              ref={libraryTrigger}
              size="icon-sm"
              variant="ghost"
              aria-label="场景收藏"
              title="场景收藏"
              disabled={props.disabled}
              onClick={() => {
                setExpanded(false);
                setLibraryOpen(true);
              }}
            >
              <Bookmark size={14} />
            </Button>
          </div>
          {props.sceneActions}
        </div>
        <div className="preview-tools">
          {props.editActions}
          <Button
            size="icon-sm"
            variant="ghost"
            role="switch"
            aria-label="模拟预览"
            aria-checked={props.demo}
            title={props.demo ? "关闭模拟预览，恢复实时音频响应" : "开启模拟预览，无需播放音乐即可查看动效"}
            onClick={() => props.onDemoChange(!props.demo)}
          >
            <AudioLines size={15} />
          </Button>
          {props.wallpaperEditing && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={wallpaperGuides ? "完成构图" : "显示构图辅助"}
              title={wallpaperGuides ? "完成构图，隐藏辅助线" : "显示构图辅助，调整壁纸位置"}
              aria-pressed={wallpaperGuides}
              onClick={() => setWallpaperGuides((value) => !value)}
            >
              <Grid2X2 size={15} />
            </Button>
          )}
          {arrangementButton}
          {maskButton}
          <IconButton
            aria-label="放大预览"
            title="放大预览，查看完整画面"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 size={15} />
          </IconButton>
        </div>
      </div>
      }
      {!ambient && !expanded && objectControls}
      {!expanded && !autoOpen && !libraryOpen ? (
        stage
      ) : (
        <div className="preview-open-notice">
          {autoOpen
            ? "正在预览搭配"
            : libraryOpen
              ? "正在预览收藏"
              : "正在放大预览"}
        </div>
      )}
      {ambient && <AtmosphereControls
        settings={previewSettings} demo={props.demo}
        running={props.running} audioState={props.audioState} disabled={props.disabled}
        onDemo={props.onDemoChange} libraryRef={libraryTrigger}
        onLibrary={() => { if (props.demo) props.onDemoChange(false); setExpanded(false); setLibraryOpen(true); }}
        onExpand={() => setExpanded(true)}
      />}
      {ambient && props.editActions}
      {!ambient && !expanded && arranging && !props.disabled && presets}
      {!ambient && !expanded && masking && !props.disabled && maskControls}
      {!ambient && <div className="preview-footer">
        {wallpaper.source === "custom" || props.wallpaperEditing ? (
          <div className="preview-background-row">
            <span className="preview-background-label">
              {wallpaper.source === "custom" ? "自选壁纸" : "系统壁纸"} ·
              与桌面一致
            </span>
            {native && wallpaper.source === "system" && (
              <IconButton
                aria-label="刷新桌面壁纸"
                title="刷新桌面壁纸"
                disabled={background.loading}
                onClick={() => void background.refresh()}
              >
                <RefreshCw size={14} />
              </IconButton>
            )}
          </div>
        ) : (
          <div className="preview-background-row">
            <span className="preview-background-label">预览背景</span>
            <div
              className="preview-background-controls"
              role="group"
              aria-label="预览背景"
            >
              <button
                aria-pressed={background.mode === "desktop"}
                onClick={() => background.choose("desktop")}
              >
                桌面壁纸
              </button>
              <button
                aria-label="纯色预览背景"
                aria-pressed={background.mode === "plain"}
                onClick={() => background.choose("plain")}
              >
                纯色
              </button>
              {background.custom && (
                <button
                  aria-pressed={background.mode === "custom"}
                  onClick={() => background.choose("custom")}
                >
                  参考图片
                </button>
              )}
              <IconButton
                aria-label="选择参考图片"
                title="选择参考图片，仅用于预览"
                disabled={background.importing}
                onClick={() => fileInput.current?.click()}
              >
                <ImagePlus size={15} />
              </IconButton>
              {background.mode === "desktop" && native && (
                <IconButton
                  aria-label="刷新桌面壁纸"
                  title="刷新桌面壁纸"
                  disabled={background.loading}
                  onClick={() => void background.refresh()}
                >
                  <RefreshCw
                    size={14}
                    className={background.loading ? "spinning" : ""}
                  />
                </IconButton>
              )}
            </div>
          </div>
        )}
        <span className="preview-screen-info">
          {background.desktop ? "主屏幕" : "参考比例"} · {screen.width} ×{" "}
          {screen.height}
        </span>
      </div>
      }
      {(canUndo || sceneNotice) && (
        <div className="scene-feedback">
          {canUndo && (
            <Button
              size="sm"
              variant="ghost"
              disabled={props.disabled || undoing}
              onClick={() => void undoScene()}
            >
              <Undo2 size={14} />
              撤销搭配
            </Button>
          )}
          {sceneNotice && (
            <span role={sceneNotice.error ? "alert" : "status"}>
              {sceneNotice.text}
            </span>
          )}
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp"
        aria-label="参考图片文件"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void background.importFile(file);
        }}
      />
      {(!ambient || custom.error || background.error) && (status ||
        (wallpaper.source === "system" &&
          (background.fileError || background.importing))) && (
        <p
          className="preview-message"
          role={
            custom.error ||
            (wallpaper.source === "system" &&
              (background.fileError || (background.error && systemPreview)))
              ? "alert"
              : "status"
          }
        >
          {wallpaper.source === "custom"
            ? status
            : (background.fileError ??
              (background.importing ? "正在保存参考图片…" : status))}
        </p>
      )}
      {!ambient && arranging && !props.disabled && (
        <p className="preview-message">
          拖动位置，右下角缩放；右键调整图层、居中或复制。方向键微调，Shift
          加速。歌词自动避让拾光绳。
        </p>
      )}
      <Dialog.Root open={expanded} onOpenChange={setExpanded}>
        <ModalContent className={`preview-dialog${ambient ? " atmosphere-preview-dialog" : ""}`}>
          <div className="preview-dialog-heading">
            <Dialog.Title>{ambient ? "氛围画面" : "桌面预览"}</Dialog.Title>
            <div className="preview-tools">
              {!ambient && arrangementButton}
              {!ambient && maskButton}
              <Dialog.Close asChild>
                <IconButton aria-label="关闭放大预览">
                  <X size={18} />
                </IconButton>
              </Dialog.Close>
            </div>
          </div>
          <Dialog.Description className="sr-only">
            {ambient ? "欣赏完整场景，按 Escape 返回。" : "按主屏幕比例预览壁纸和动效，可布置位置与大小。"}
          </Dialog.Description>
          {!ambient && expanded && objectControls}
          {expanded && stage}
          {!ambient && arranging && !props.disabled && presets}
          {!ambient && masking && !props.disabled && maskControls}
          <div className="preview-dialog-footer">
            {arranging
              ? "拖动位置 · 右下角居中缩放 · 方向键微调"
              : `${screen.width} × ${screen.height}`}{" "}
            · Esc 关闭
          </div>
        </ModalContent>
      </Dialog.Root>
      {autoOpen && (
        <AutoSceneDialog
          settings={props.settings}
          image={image}
          desktop={desktop}
          screen={screen}
          available={available}
          unavailableReason={
            background.loading
              ? "正在读取桌面壁纸，请稍候。"
              : "请先读取桌面壁纸或选择参考图片，也可以使用纯色背景。"
          }
          demo={props.demo}
          disabled={props.disabled}
          onClose={() => setAutoOpen(false)}
          onReturnFocus={() => autoTrigger.current?.focus()}
          onApply={applyScene}
          renderPreview={(settings, demo) => (
            <PreviewStage
              {...stageProps}
              settings={settings}
              demo={demo}
              expanded
              active
              arranging={false}
              masking={false}
              selectedRegion="primary"
              viewPreviewOnly
            />
          )}
        />
      )}
      {libraryOpen && (
        <SceneLibraryDialog
          presentation={ambient ? "ambient" : "editor"}
          settings={props.settings}
          image={image}
          desktop={desktop}
          screen={screen}
          available={available}
          demo={props.demo}
          disabled={props.disabled}
          onClose={() => setLibraryOpen(false)}
          onReturnFocus={() => libraryTrigger.current?.focus()}
          onApply={applySavedScene}
          renderPreview={(settings, demo) => (
            <PreviewStage
              {...stageProps}
              settings={settings}
              demo={demo}
              expanded
              active
              arranging={false}
              masking={false}
              selectedRegion="primary"
              viewPreviewOnly
            />
          )}
        />
      )}
    </section>
  );
}
