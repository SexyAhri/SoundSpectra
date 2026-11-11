import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type {
  LyricSettings,
  SceneBounds,
  SpectrumSettings,
} from "../spectrum/model";
import { relativeBounds } from "../spectrum/regions";
import type { NowPlaying } from "../desktop-card/use-now-playing";
import {
  activeLine,
  demoLyrics,
  playbackPosition,
  trackKey,
  lyricDisplayText,
  type LyricDocument,
} from "./model";
import "./lyrics.css";
import { KineticLyrics } from "./kinetic-lyrics";
import { useLyricPlacement } from "./use-lyric-placement";
import { avoidRail } from "./avoid-rail";
import { lyricPalette } from "./lyric-palette";
import { LyricSceneFocus } from "../spectrum/scene-focus";
import type { AnalysisSnapshot } from "../spectrum/spectrum-canvas";
import { readLyricAudio } from "./lyric-audio";

const FoldedLyrics = lazy(() =>
  import("./folded-lyrics").then((module) => ({
    default: module.FoldedLyrics,
  })),
);

export function LyricLayer({
  settings,
  document,
  info,
  demo = false,
  active = true,
  desktop = false,
  host,
  onBoundsChange,
  draggable = false,
  onSelect,
  obstacles = [],
  zIndex,
  selected,
  appearance,
  cardAccent,
  analysis,
  onSnap,
}: {
  settings: LyricSettings;
  document: LyricDocument;
  info: NowPlaying;
  demo?: boolean;
  active?: boolean;
  desktop?: boolean;
  host?: SceneBounds;
  onBoundsChange?: (bounds: SceneBounds, resized?: boolean) => void;
  draggable?: boolean;
  onSelect?: () => void;
  obstacles?: SceneBounds[];
  zIndex?: number;
  selected?: boolean;
  appearance?: Pick<SpectrumSettings, "effect" | "music" | "color"> &
    Partial<Pick<SpectrumSettings, "quality">>;
  cardAccent?: string;
  analysis?: RefObject<AnalysisSnapshot>;
  onSnap?: (guides: { x: number | null; y: number | null }) => void;
}) {
  const movable = draggable && !desktop && !!onBoundsChange;
  // Media polling rebuilds obstacle arrays in both desktop and preview hosts.
  // Reuse the placement search until the actual rectangles change.
  const placementKey = JSON.stringify([settings.bounds, obstacles]);
  const safe = useMemo(() => {
    const [bounds, obstacles] = JSON.parse(placementKey) as [
      SceneBounds,
      SceneBounds[],
    ];
    return avoidRail(bounds, obstacles);
  }, [placementKey]);
  const placement = useLyricPlacement(
    safe.bounds,
    movable,
    onBoundsChange,
    onSnap,
  );
  const [, refreshLine] = useState(0),
    [demoStart] = useState(Date.now);
  const simulated = demo && !desktop;
  const valid = document.key === trackKey(info) && document.status === "ready";
  const lines = simulated ? demoLyrics : valid ? document.lines : [];
  const demoDuration = (demoLyrics.at(-1)?.end ?? 19200) + 800;
  const readDisplay = (now: number) => {
    const synced = playbackPosition(info, now);
    const time =
      (simulated ? (now - demoStart) % demoDuration : (synced ?? 0)) +
      settings.offsetMs;
    return {
      synced,
      time,
      index: activeLine(lines, time),
      canShow: simulated || (valid && synced !== null),
    };
  };
  // Parent updates (seek, offsets, track changes) always use the current clock.
  const { synced, time, index, canShow } = readDisplay(Date.now());
  const display = useRef({ readDisplay, index, canShow });
  display.current = { readDisplay, index, canShow };
  const palette = useMemo(
    () => lyricPalette(appearance, cardAccent),
    [
      appearance?.effect,
      appearance?.music.fieldPalette,
      appearance?.color,
      cardAccent,
    ],
  );
  useEffect(() => {
    if (!active || !settings.enabled) return;
    // Only line/status changes need React; glyphs and particles keep their own clock.
    const timer = setInterval(() => {
      const current = display.current;
      const next = current.readDisplay(Date.now());
      if (next.index !== current.index || next.canShow !== current.canShow)
        refreshLine((revision) => revision + 1);
    }, 250);
    return () => clearInterval(timer);
  }, [active, settings.enabled]);
  if (!settings.enabled || !active) return null;
  const readAudio = () =>
    readLyricAudio(
      analysis?.current,
      performance.now(),
      appearance?.music,
      simulated || info.playing,
      simulated,
    );
  const line = lines[index];
  if (desktop && (!canShow || safe.crowded)) return null;
  const b = host ? relativeBounds(placement.bounds, host) : placement.bounds;
  const displayFontSize = Math.max(
    18,
    Math.min(
      72,
      settings.fontSize *
        Math.sqrt(
          (placement.bounds.width * placement.bounds.height) /
            (settings.bounds.width * settings.bounds.height),
        ),
    ),
  );
  const render = {
    quality: appearance?.quality,
    flow:
      appearance?.effect === "star_flight"
        ? ("flight" as const)
        : appearance?.effect === "aurora_flow"
          ? ("aurora" as const)
          : ("drift" as const),
  };
  return (
    <div
      className={`lyric-layer lyric-motion-${settings.motion}${movable ? " is-draggable" : ""}`}
      data-testid="lyric-layer"
      data-preview-object="lyrics"
      data-selected={selected || undefined}
      data-rail-crowded={safe.crowded || undefined}
      data-light-palette={palette.prism.join(",")}
      style={
        {
          zIndex,
          left: `${b.x * 100}%`,
          top: `${b.y * 100}%`,
          width: `${b.width * 100}%`,
          height: `${b.height * 100}%`,
        } as CSSProperties
      }
      role={movable ? "group" : undefined}
      tabIndex={movable ? 0 : undefined}
      aria-label={movable ? "歌词位置，拖动或方向键移动" : undefined}
      onFocus={movable ? onSelect : undefined}
      onPointerDown={(event) => placement.begin(event)}
      onPointerMove={placement.moving}
      onPointerUp={(event) => placement.end(event)}
      onPointerCancel={(event) => placement.end(event, true)}
      onLostPointerCapture={(event) => placement.end(event, true)}
      onKeyDown={placement.keyboard}
    >
      {canShow && !safe.crowded ? (
        <>
          {line && lyricDisplayText(line.text).trim() && (
            <LyricSceneFocus
              bounds={placement.bounds}
              lineKey={`${simulated ? "demo" : document.key}:${index}:${line.start}`}
              backgroundOpacity={settings.backgroundOpacity}
            />
          )}
          {settings.motion === "folded" ? (
            <Suspense fallback={null}>
              <FoldedLyrics
                {...render}
                lines={lines}
                time={time}
                readAudio={readAudio}
                readTime={() =>
                  (simulated
                    ? (Date.now() - demoStart) % demoDuration
                    : (playbackPosition(info, Date.now()) ?? 0)) +
                  settings.offsetMs
                }
                playing={simulated || info.playing}
                desktop={desktop}
                fontStyle={settings.fontStyle}
                fontSize={displayFontSize}
                regionWidth={placement.bounds.width}
                reduced={false}
                backgroundOpacity={settings.backgroundOpacity}
                palette={palette}
                readability={settings.readability}
              />
            </Suspense>
          ) : (
            <KineticLyrics
              {...render}
              lines={lines}
              index={index}
              time={time}
              readAudio={readAudio}
              readTime={() =>
                (simulated
                  ? (Date.now() - demoStart) % demoDuration
                  : (playbackPosition(info, Date.now()) ?? 0)) +
                settings.offsetMs
              }
              playing={simulated || info.playing}
              desktop={desktop}
              fontStyle={settings.fontStyle}
              fontSize={displayFontSize}
              regionWidth={placement.bounds.width}
              mode={settings.motion}
              reduced={false}
              backgroundOpacity={settings.backgroundOpacity}
              palette={palette}
              readability={settings.readability}
            />
          )}
          <span className="sr-only" aria-label="当前歌词">
            {line ? lyricDisplayText(line.text) : "前奏"}
          </span>
          {simulated && <span className="lyric-demo-label">模拟歌词</span>}
          {!simulated &&
            !desktop &&
            info.timelineSource === "kugou-checkpoint" && (
              <span className="lyric-demo-label">
                酷狗兼容进度 · 切歌或拖动后可能等待约 30 秒
              </span>
            )}
          {!simulated && !desktop && info.timelineSource === "kugou-native" && (
            <span className="lyric-demo-label">
              酷狗增强同步 · 实时播放进度
            </span>
          )}
          {!simulated &&
            !desktop &&
            info.timelineSource === "player-accessibility" && (
              <span className="lyric-demo-label">
                播放器界面进度 · 精度约 1 秒
              </span>
            )}
          {!simulated &&
            !desktop &&
            info.timelineSource === "netease-events" && (
              <span className="lyric-demo-label">网易云本地播放事件同步</span>
            )}
        </>
      ) : (
        !safe.crowded && (
          <p className="lyric-empty">
            {valid && synced === null
              ? info.sessionId?.toLowerCase().includes("kugou")
                ? "歌词已匹配，等待酷狗更新本地进度（约 30 秒），切歌后也需重新校准"
                : "歌词已匹配，等待播放器提供有效播放进度"
              : document.message}
          </p>
        )
      )}
      {movable && (
        <>
          <span className="lyric-drag-hint" aria-hidden="true">
            拖动歌词
          </span>
          <button
            className="lyric-resize"
            aria-label="缩放歌词"
            title="拖动缩放歌词区域"
            onPointerDown={(event) => placement.begin(event, true)}
          />
        </>
      )}
      {!desktop && safe.crowded && (
        <span className="lyric-space-hint" role="status">
          拾光绳占用过多空间，请移动或收起部分拾光绳。
        </span>
      )}
    </div>
  );
}
