import {
  musicEffects,
  defaultMusicSettings,
  normalizeMusicSettings,
  type MusicEffect,
  type MusicSettings,
} from "./music-engine/catalog";
import {
  defaultSceneView,
  normalizeSceneView,
  type SceneView,
} from "./three/view";
export const BAND_COUNT = 96;
export const effectIds = musicEffects.map((effect) => effect.value);
export type SpectrumEffect = MusicEffect;
const replacedEffects: Record<string, SpectrumEffect> = {
  ember_flow: "caustic_light",
  prism_cluster: "caustic_light",
  kinetic_mobile: "ginkgo_leaves",
  solar_corona: "cosmic_web",
  ink_marbling: "caustic_light",
  harmonic_strings: "ginkgo_leaves",
  koi_dance: "ginkgo_leaves",
  ferrofluid: "caustic_light",
  bars: "sound_field",
  ribbon: "ripple",
  stars: "dream_stars",
  night: "dream_stars",
  ring: "vortex",
  rain: "volume_rain",
  orbit: "vortex",
  flock: "rhythm_balls",
  bloom: "ripple",
  valley: "ripple",
  spectrum_bars: "sound_field",
  rhythm_bars: "sound_field",
  pulse_ring: "vortex",
  rhythm_fluid: "rhythm_skin",
  water_ripple: "ripple",
};
export const migrateEffectId = (value: unknown): unknown =>
  typeof value === "string" && Object.hasOwn(replacedEffects, value)
    ? replacedEffects[value]
    : value;
export type RenderQuality = "eco" | "balanced" | "smooth" | "unlimited";
export type SceneMode = "daily" | "immersive";
export interface SceneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface DesktopCardSettings {
  enabled: boolean;
  variant: "record" | "compact" | "afternoon" | "floating";
  bounds: SceneBounds;
  accentColor?: string;
}
export const defaultDesktopCard: DesktopCardSettings = {
  enabled: false,
  variant: "record",
  bounds: { x: 0.035, y: 0.81, width: 0.23, height: 0.13 },
};
export interface AtmosphereSettings {
  direction: number;
  wind: number;
  fog: number;
  lights: number;
  choreography: boolean;
}
// Keep the existing storage key so imported images and old parallax settings survive.
export interface WallpaperDepthSettings {
  enabled: boolean;
  amount: number;
  profile: "landscape" | "left-foreground";
  revision: string;
  source: "system" | "custom";
  fit: "cover" | "contain";
  focusX: number;
  focusY: number;
  brightness: number;
  saturation: number;
  ambientEnabled: boolean;
  ambientAmount: number;
  ambientColor: string;
  ambientBounds: SceneBounds;
}
export const defaultWallpaperDepth: WallpaperDepthSettings = {
  enabled: false,
  amount: 25,
  profile: "landscape",
  revision: "",
  source: "system",
  fit: "cover",
  focusX: 50,
  focusY: 50,
  brightness: 100,
  saturation: 100,
  ambientEnabled: false,
  ambientAmount: 30,
  ambientColor: "#c5dfdf",
  ambientBounds: { x: 0.08, y: 0.08, width: 0.84, height: 0.44 },
};
export const defaultAtmosphere: AtmosphereSettings = {
  direction: 15,
  wind: 40,
  fog: 45,
  lights: 60,
  choreography: true,
};
export type RegionStyle = Pick<
  SpectrumSettings,
  | "effect"
  | "sceneMode"
  | "color"
  | "opacity"
  | "sensitivity"
  | "decay"
  | "reflection"
  | "glow"
  | "bounds"
  | "atmosphere"
  | "music"
  | "view"
>;
export interface SpectrumRegion extends RegionStyle {
  id: string;
  name: string;
  visible: boolean;
}
export interface SceneMask {
  id: string;
  bounds: SceneBounds;
  feather: number;
}
export interface LyricSettings {
  fontStyle: "modern" | "poetry";
  readability: "soft" | "contrast";
  enabled: boolean;
  folder: string;
  fontSize: number;
  backgroundOpacity: number;
  offsetMs: number;
  motion: "depth" | "stardust" | "stage" | "folded";
  bounds: SceneBounds;
}
export const defaultLyrics: LyricSettings = {
  fontStyle: "modern",
  readability: "soft",
  enabled: false,
  folder: "",
  fontSize: 64,
  backgroundOpacity: 30,
  offsetMs: 0,
  motion: "depth",
  bounds: { x: 0.06, y: 0.2, width: 0.88, height: 0.56 },
};
export const MAX_REGIONS = 4,
  MAX_MASKS = 8;

export interface SpectrumSettings {
  version: 1;
  enabled: boolean;
  effect: SpectrumEffect;
  music: MusicSettings;
  quality: RenderQuality;
  sceneMode: SceneMode;
  view: SceneView;
  color: string;
  followCover: boolean;
  layerOrder: string[];
  opacity: number;
  sensitivity: number;
  decay: number;
  reflection: number;
  glow: number;
  bounds: SceneBounds;
  regionName: string;
  regionVisible: boolean;
  regions: SpectrumRegion[];
  masks: SceneMask[];
  atmosphere: AtmosphereSettings;
  desktopCard: DesktopCardSettings;
  wallpaperDepth: WallpaperDepthSettings;
  lyrics: LyricSettings;
}

export type SettingsUpdate = (
  patch:
    | Partial<SpectrumSettings>
    | ((current: SpectrumSettings) => Partial<SpectrumSettings>),
) => void;

export interface RuntimeStatus {
  state: "waiting" | "connecting" | "listening" | "silent" | "error";
  message: string;
  processId: number | null;
  sourceName?: string | null;
  desktopAttached: boolean;
  editing: boolean;
  desktopError?: string | null;
}

export const defaults: SpectrumSettings = {
  version: 1,
  enabled: false,
  effect: "rhythm_balls",
  music: { ...defaultMusicSettings },
  quality: "balanced",
  sceneMode: "daily",
  view: { ...defaultSceneView },
  color: "#d4c3ff",
  followCover: false,
  layerOrder: [],
  opacity: 85,
  sensitivity: 100,
  decay: 65,
  reflection: 32,
  glow: 35,
  bounds: { x: 0.12, y: 0.7, width: 0.76, height: 0.22 },
  regionName: "主区域",
  regionVisible: true,
  regions: [],
  masks: [],
  atmosphere: { ...defaultAtmosphere },
  desktopCard: structuredClone(defaultDesktopCard),
  wallpaperDepth: structuredClone(defaultWallpaperDepth),
  lyrics: structuredClone(defaultLyrics),
};

const clamp = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : Math.min(max, Math.max(min, fallback));

// Settings from disk/localStorage are untrusted and may come from an older build.
export function normalizeSettings(value: unknown): SpectrumSettings {
  const source = (
    value && typeof value === "object" ? value : {}
  ) as Partial<SpectrumSettings>;
  const bounds = source.bounds ?? defaults.bounds;
  const width = clamp(bounds.width, defaults.bounds.width, 0.2, 1);
  const height = clamp(bounds.height, defaults.bounds.height, 0.08, 1);
  return {
    version: 1,
    enabled: typeof source.enabled === "boolean" ? source.enabled : false,
    effect: effectIds.includes(source.effect as SpectrumEffect)
      ? source.effect!
      : Object.hasOwn(replacedEffects, source.effect ?? "")
        ? replacedEffects[source.effect!]
        : defaults.effect,
    music: normalizeMusicSettings(source.music),
    quality: ["eco", "balanced", "smooth", "unlimited"].includes(
      source.quality ?? "",
    )
      ? source.quality!
      : defaults.quality,
    sceneMode: source.sceneMode === "immersive" ? "immersive" : "daily",
    view: normalizeSceneView(source.view),
    color:
      typeof source.color === "string" && /^#[0-9a-f]{6}$/i.test(source.color)
        ? source.color
        : defaults.color,
    followCover: source.followCover === true,
    layerOrder: normalizeLayerOrder(source.layerOrder),
    opacity: clamp(source.opacity, defaults.opacity, 10, 100),
    sensitivity: clamp(source.sensitivity, defaults.sensitivity, 25, 200),
    decay: clamp(source.decay, defaults.decay, 0, 100),
    reflection: clamp(source.reflection, defaults.reflection, 0, 70),
    glow: clamp(source.glow, defaults.glow, 0, 100),
    bounds: {
      x: clamp(bounds.x, defaults.bounds.x, 0, 1 - width),
      y: clamp(bounds.y, defaults.bounds.y, 0, 1 - height),
      width,
      height,
    },
    regionName:
      typeof source.regionName === "string" && source.regionName.trim()
        ? source.regionName.trim().slice(0, 24)
        : defaults.regionName,
    regionVisible:
      typeof source.regionVisible === "boolean" ? source.regionVisible : true,
    regions: normalizeRegions(source.regions),
    masks: normalizeMasks(source.masks),
    atmosphere: normalizeAtmosphere(source.atmosphere),
    desktopCard: normalizeDesktopCard(source.desktopCard),
    wallpaperDepth: normalizeWallpaperDepth(source.wallpaperDepth),
    lyrics: normalizeLyrics(source.lyrics),
  };
}

export function normalizeLayerOrder(value: unknown): string[] {
  return [
    ...new Set(
      (Array.isArray(value) ? value : []).filter(
        (id): id is string =>
          typeof id === "string" &&
          /^(lyrics|card|effect:[a-zA-Z0-9_-]{1,64})$/.test(id),
      ),
    ),
  ].slice(0, MAX_REGIONS + 2);
}

export function normalizeLyrics(value: unknown): LyricSettings {
  const source =
    value && typeof value === "object" ? (value as Partial<LyricSettings>) : {};
  const b = source.bounds ?? defaultLyrics.bounds;
  const width = clamp(b.width, 0.88, 0.25, 1),
    height = clamp(b.height, 0.56, 0.1, 0.75);
  return {
    enabled: source.enabled === true,
    folder:
      typeof source.folder === "string"
        ? source.folder.trim().slice(0, 1024)
        : defaultLyrics.folder,
    backgroundOpacity: clamp(source.backgroundOpacity, 30, 0, 100),
    readability: source.readability === "contrast" ? "contrast" : "soft",
    fontStyle: source.fontStyle === "poetry" ? "poetry" : "modern",
    fontSize: clamp(
      (source as { motion?: string }).motion === "float" &&
        source.fontSize === 36
        ? 64
        : source.fontSize,
      64,
      18,
      72,
    ),
    offsetMs: clamp(source.offsetMs, 0, -10000, 10000),
    motion:
      source.motion === "stardust" ||
      source.motion === "stage" ||
      source.motion === "folded"
        ? source.motion
        : "depth",
    bounds: {
      x: clamp(b.x, 0.06, 0, 1 - width),
      y: clamp(b.y, 0.2, 0, 1 - height),
      width,
      height,
    },
  };
}

export function normalizeWallpaperDepth(
  value: unknown,
): WallpaperDepthSettings {
  const source =
    value && typeof value === "object"
      ? (value as Partial<WallpaperDepthSettings>)
      : {};
  const b = source.ambientBounds ?? defaultWallpaperDepth.ambientBounds;
  const width = clamp(b.width, 0.84, 0.2, 1),
    height = clamp(b.height, 0.44, 0.08, 1);
  const revision =
    typeof source.revision === "string" &&
    /^[a-f0-9]{1,32}$/.test(source.revision)
      ? source.revision
      : "";
  return {
    enabled: source.enabled === true,
    amount: clamp(source.amount, 25, 0, 100),
    profile:
      source.profile === "left-foreground" ? "left-foreground" : "landscape",
    revision,
    source:
      source.source === "custom" ||
      (source.source !== "system" && source.enabled === true && !!revision)
        ? "custom"
        : "system",
    fit: source.fit === "contain" ? "contain" : "cover",
    focusX: clamp(source.focusX, 50, 0, 100),
    focusY: clamp(source.focusY, 50, 0, 100),
    brightness: clamp(source.brightness, 100, 30, 130),
    saturation: clamp(source.saturation, 100, 0, 150),
    ambientEnabled: source.ambientEnabled === true,
    ambientAmount: clamp(source.ambientAmount, 30, 0, 100),
    ambientColor:
      typeof source.ambientColor === "string" &&
      /^#[a-f0-9]{6}$/i.test(source.ambientColor)
        ? source.ambientColor
        : defaultWallpaperDepth.ambientColor,
    ambientBounds: {
      x: clamp(b.x, 0.08, 0, 1 - width),
      y: clamp(b.y, 0.08, 0, 1 - height),
      width,
      height,
    },
  };
}

export function normalizeDesktopCard(value: unknown): DesktopCardSettings {
  const source =
    value && typeof value === "object"
      ? (value as Partial<DesktopCardSettings>)
      : {};
  const b = source.bounds ?? defaultDesktopCard.bounds;
  const width = clamp(b.width, 0.23, 0.15, 0.45),
    height = clamp(b.height, 0.13, 0.08, 0.24);
  const accent =
    typeof source.accentColor === "string" &&
    /^#[0-9a-f]{6}$/i.test(source.accentColor)
      ? { accentColor: source.accentColor }
      : {};
  return {
    enabled: source.enabled === true,
    variant:
      source.variant === "floating"
        ? "floating"
        : source.variant === "afternoon"
          ? "afternoon"
          : source.variant === "compact"
            ? "compact"
            : "record",
    ...accent,
    bounds: {
      x: clamp(b.x, 0.035, 0, 1 - width),
      y: clamp(b.y, 0.81, 0, 1 - height),
      width,
      height,
    },
  };
}

const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z0-9_-]{1,64}$/.test(value) &&
  value !== "primary";
function normalizeRegions(value: unknown): SpectrumRegion[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : [])
    .filter(
      (item) =>
        item && validId(item.id) && !seen.has(item.id) && !!seen.add(item.id),
    )
    .slice(0, MAX_REGIONS - 1)
    .map((item) => {
      // Strip collections before reusing the legacy appearance normalization.
      const style = normalizeSettings({ ...item, regions: [], masks: [] });
      return {
        id: item.id,
        name:
          typeof item.name === "string" && item.name.trim()
            ? item.name.trim().slice(0, 24)
            : "装饰区域",
        visible: item.visible !== false,
        effect: style.effect,
        sceneMode: style.sceneMode,
        view: style.view,
        color: style.color,
        opacity: style.opacity,
        sensitivity: style.sensitivity,
        decay: style.decay,
        reflection: style.reflection,
        glow: style.glow,
        bounds: style.bounds,
        atmosphere: style.atmosphere,
        music: style.music,
      };
    });
}

function normalizeAtmosphere(value: unknown): AtmosphereSettings {
  const a = (
    value && typeof value === "object" ? value : {}
  ) as Partial<AtmosphereSettings>;
  return {
    direction: clamp(a.direction, defaultAtmosphere.direction, -180, 180),
    wind: clamp(a.wind, defaultAtmosphere.wind, 0, 100),
    fog: clamp(a.fog, defaultAtmosphere.fog, 0, 100),
    lights: clamp(a.lights, defaultAtmosphere.lights, 0, 100),
    choreography:
      typeof a.choreography === "boolean"
        ? a.choreography
        : defaultAtmosphere.choreography,
  };
}
function normalizeMasks(value: unknown): SceneMask[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : [])
    .filter(
      (item) =>
        item && validId(item.id) && !seen.has(item.id) && !!seen.add(item.id),
    )
    .slice(0, MAX_MASKS)
    .map((item) => {
      const b = item.bounds ?? {},
        width = clamp(b.width, 0.2, 0.02, 1),
        height = clamp(b.height, 0.3, 0.02, 1);
      return {
        id: item.id,
        bounds: {
          x: clamp(b.x, 0.4, 0, 1 - width),
          y: clamp(b.y, 0.3, 0, 1 - height),
          width,
          height,
        },
        feather: clamp(item.feather, 0.015, 0, 0.08),
      };
    });
}

export const browserStatus: RuntimeStatus = {
  state: "waiting",
  message: "浏览器预览 · 尚未连接桌面客户端",
  processId: null,
  desktopAttached: false,
  editing: false,
};
