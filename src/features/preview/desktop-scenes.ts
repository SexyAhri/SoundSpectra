import {
  defaults,
  normalizeDesktopCard,
  normalizeLyrics,
  normalizeLayerOrder,
  type DesktopCardSettings,
  type LyricSettings,
  type SpectrumSettings,
} from "../spectrum/model";
import { composition } from "./scene-suggestions";
import { recommendedMusic } from "../spectrum/effect-presets";
import type { SceneLayout } from "./scene-library";

export interface DesktopScene {
  version: 1;
  card: DesktopCardSettings;
  lyrics: Omit<LyricSettings, "folder" | "offsetMs" | "fontStyle"> &
    Partial<Pick<LyricSettings, "fontStyle">>;
  followCover: boolean;
  layerOrder?: string[];
}
export function desktopLayout(settings: SpectrumSettings): SceneLayout {
  const { folder: _folder, offsetMs: _offset, ...lyrics } = settings.lyrics;
  return structuredClone({
    ...composition(settings),
    masks: settings.masks,
    desktop: {
      version: 1,
      card: settings.desktopCard,
      lyrics,
      followCover: settings.followCover,
      layerOrder: settings.layerOrder,
    },
  });
}
export function parseDesktopScene(value: unknown): DesktopScene {
  if (!value || typeof value !== "object") throw Error("桌面方案格式无效。");
  const source = value as DesktopScene;
  const {
    folder: _folder,
    offsetMs: _offset,
    ...lyrics
  } = normalizeLyrics(source.lyrics);
  const result: DesktopScene = {
    version: 1,
    card: normalizeDesktopCard(source.card),
    lyrics,
    followCover: source.followCover,
  };
  if ("layerOrder" in source)
    result.layerOrder = normalizeLayerOrder(source.layerOrder);
  const same = (a: unknown, b: unknown): boolean => {
    if (a && typeof a === "object")
      return (
        !!b &&
        typeof b === "object" &&
        Object.keys(a).length === Object.keys(b).length &&
        Object.entries(a).every(([key, value]) =>
          same(value, (b as Record<string, unknown>)[key]),
        )
      );
    return a === b;
  };
  const comparable = {
    ...source,
    card: { ...source.card },
    lyrics: { ...source.lyrics },
  };
  // Older desktop scenes preserve the user's current font selection on apply.
  if (!Object.prototype.hasOwnProperty.call(source.lyrics, "fontStyle"))
    delete result.lyrics.fontStyle;
  if ("accentColor" in comparable.card && !result.card.accentColor)
    delete comparable.card.accentColor;
  if (typeof source.followCover !== "boolean" || !same(result, comparable))
    throw Error("桌面方案版本或展示参数无效。");
  return result;
}
// One settings transaction; private lyric paths/timing and rail mounts stay owned
// by their original modules. Legacy effects-only scenes leave these fields alone.
export function scenePatch(
  current: SpectrumSettings,
  scene: Partial<SceneLayout>,
): Partial<SpectrumSettings> {
  const { desktop, ...effects } = scene;
  return desktop
    ? {
        ...effects,
        ...(desktop.layerOrder ? { layerOrder: [...desktop.layerOrder] } : {}),
        desktopCard: structuredClone(desktop.card),
        lyrics: { ...current.lyrics, ...structuredClone(desktop.lyrics) },
        followCover: desktop.followCover,
      }
    : effects;
}
export const desktopPresets = [
  {
    id: "warm-sand",
    name: "暖砂日常",
    description: "暖纸票根，蒲公英随音乐轻轻浮动",
    color: "#dfbd90",
    scene: desktopLayout({
      ...structuredClone(defaults),
      effect: "volume_rain",
      color: "#dfbd90",
      opacity: 62,
      glow: 12,
      bounds: { x: 0.4, y: 0.52, width: 0.56, height: 0.38 },
      music: { ...recommendedMusic("volume_rain"), fieldPalette: "ember", speed: 1 },
      desktopCard: {
        enabled: true,
        variant: "afternoon",
        accentColor: "#dfbd90",
        bounds: { x: 0.04, y: 0.79, width: 0.27, height: 0.15 },
      },
      lyrics: { ...defaults.lyrics, enabled: false },
    }),
  },
  {
    id: "dusk-blue",
    name: "暮蓝听歌",
    description: "歌词居中，蓝雪轻落在一旁",
    color: "#9bbdd4",
    scene: desktopLayout({
      ...structuredClone(defaults),
      effect: "ripple",
      color: "#9bbdd4",
      opacity: 48,
      glow: 14,
      bounds: { x: 0.36, y: 0.57, width: 0.6, height: 0.33 },
      music: { ...recommendedMusic("ripple"), fieldPalette: "lake", speed: 1, rippleLights: 1, rippleTwist: 0.2 },
      desktopCard: {
        enabled: true,
        variant: "record",
        accentColor: "#9bbdd4",
        bounds: { x: 0.04, y: 0.79, width: 0.27, height: 0.15 },
      },
      lyrics: {
        ...defaults.lyrics,
        enabled: true,
        motion: "stage",
        fontSize: 48,
        backgroundOpacity: 18,
        bounds: { x: 0.14, y: 0.2, width: 0.72, height: 0.32 },
      },
    }),
  },
  {
    id: "quiet-mint",
    name: "清浅专注",
    description: "收起大幅运动，留一点音乐陪伴",
    color: "#a6c3b5",
    scene: desktopLayout({
      ...structuredClone(defaults),
      effect: "rhythm_balls",
      regionVisible: false,
      color: "#a6c3b5",
      opacity: 40,
      glow: 0,
      desktopCard: {
        enabled: true,
        variant: "compact",
        accentColor: "#a6c3b5",
        bounds: { x: 0.04, y: 0.83, width: 0.24, height: 0.11 },
      },
      lyrics: { ...defaults.lyrics, enabled: false },
      music: { ...defaults.music, speed: 0 },
    }),
  },
];
