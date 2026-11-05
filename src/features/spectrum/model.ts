import { musicEffects, defaultMusicSettings, normalizeMusicSettings, type MusicEffect, type MusicSettings } from './music-engine/catalog';
import { defaultSceneView, normalizeSceneView, type SceneView } from './three/view';
export const BAND_COUNT = 96;
export const effectIds = musicEffects.map(effect => effect.value);
export type SpectrumEffect = MusicEffect;
const replacedEffects: Record<string, SpectrumEffect> = {
  bars: 'rhythm_bars', ribbon: 'ripple', stars: 'dream_stars', night: 'dream_stars',
  ring: 'pulse_ring', rain: 'volume_rain', orbit: 'vortex', flock: 'rhythm_balls',
  bloom: 'water_ripple', valley: 'water_ripple',
};
export const migrateEffectId = (value: unknown): unknown => typeof value === 'string' && Object.hasOwn(replacedEffects, value) ? replacedEffects[value] : value;
export type RenderQuality = "eco" | "balanced" | "smooth" | "unlimited";
export type SceneMode = "daily" | "immersive";
export interface SceneBounds { x: number; y: number; width: number; height: number }
export interface DesktopCardSettings { enabled: boolean; variant: 'record' | 'compact' | 'afternoon'; bounds: SceneBounds }
export const defaultDesktopCard: DesktopCardSettings = { enabled: false, variant: 'record', bounds: { x: .035, y: .81, width: .23, height: .13 } }
export interface AtmosphereSettings { direction: number; wind: number; fog: number; lights: number; choreography: boolean }
export interface WallpaperDepthSettings { enabled: boolean; amount: number; profile: 'landscape' | 'left-foreground'; revision: string }
export const defaultWallpaperDepth: WallpaperDepthSettings = { enabled: false, amount: 25, profile: 'landscape', revision: '' }
export const defaultAtmosphere: AtmosphereSettings = { direction: 15, wind: 40, fog: 45, lights: 60, choreography: true }
export type RegionStyle = Pick<SpectrumSettings, 'effect' | 'sceneMode' | 'color' | 'opacity' | 'sensitivity' | 'decay' | 'reflection' | 'glow' | 'bounds' | 'atmosphere' | 'music' | 'view'>
export interface SpectrumRegion extends RegionStyle { id: string; name: string; visible: boolean }
export interface SceneMask { id: string; bounds: SceneBounds; feather: number }
export interface LyricSettings { enabled: boolean; folder: string; fontSize: number; backgroundOpacity: number; offsetMs: number; motion: 'depth' | 'stardust' | 'stage'; bounds: SceneBounds }
export const defaultLyrics: LyricSettings = { enabled: false, folder: '', fontSize: 64, backgroundOpacity: 30, offsetMs: 0, motion: 'depth', bounds: { x: .06, y: .20, width: .88, height: .56 } }
export const MAX_REGIONS = 4, MAX_MASKS = 8

export interface SpectrumSettings {
  version: 1;
  enabled: boolean;
  effect: SpectrumEffect;
  music: MusicSettings;
  quality: RenderQuality;
  sceneMode: SceneMode;
  view: SceneView;
  color: string;
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

export type SettingsUpdate = (patch: Partial<SpectrumSettings> | ((current: SpectrumSettings) => Partial<SpectrumSettings>)) => void;

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
  effect: 'rhythm_balls',
  music: { ...defaultMusicSettings },
  quality: "balanced",
  sceneMode: "daily",
  view: { ...defaultSceneView },
  color: "#d4c3ff",
  opacity: 85,
  sensitivity: 100,
  decay: 65,
  reflection: 32,
  glow: 35,
  bounds: { x: 0.12, y: 0.7, width: 0.76, height: 0.22 },
  regionName: '主区域', regionVisible: true, regions: [], masks: [],
  atmosphere: { ...defaultAtmosphere },
  desktopCard: structuredClone(defaultDesktopCard),
  wallpaperDepth: { ...defaultWallpaperDepth },
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
    effect: effectIds.includes(source.effect as SpectrumEffect) ? source.effect! : Object.hasOwn(replacedEffects, source.effect ?? '') ? replacedEffects[source.effect!] : defaults.effect,
    music: normalizeMusicSettings(source.music),
    quality: ["eco", "balanced", "smooth", "unlimited"].includes(source.quality ?? "") ? source.quality! : defaults.quality,
    sceneMode: source.sceneMode === "immersive" ? "immersive" : "daily",
    view: normalizeSceneView(source.view),
    color:
      typeof source.color === "string" && /^#[0-9a-f]{6}$/i.test(source.color)
        ? source.color
        : defaults.color,
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
    regionName: typeof source.regionName === 'string' && source.regionName.trim() ? source.regionName.trim().slice(0, 24) : defaults.regionName,
    regionVisible: typeof source.regionVisible === 'boolean' ? source.regionVisible : true,
    regions: normalizeRegions(source.regions),
    masks: normalizeMasks(source.masks),
    atmosphere: normalizeAtmosphere(source.atmosphere),
    desktopCard: normalizeDesktopCard(source.desktopCard),
    wallpaperDepth: normalizeWallpaperDepth(source.wallpaperDepth),
    lyrics: normalizeLyrics(source.lyrics),
  };
}

export function normalizeLyrics(value: unknown): LyricSettings {
  const source = value && typeof value === 'object' ? value as Partial<LyricSettings> : {}
  const b = source.bounds ?? defaultLyrics.bounds
  const width = clamp(b.width, .88, .25, 1), height = clamp(b.height, .56, .1, .75)
  return { enabled: source.enabled === true, folder: typeof source.folder === 'string' ? source.folder.trim().slice(0, 1024) : defaultLyrics.folder,
    backgroundOpacity: clamp(source.backgroundOpacity, 30, 0, 100),
    fontSize: clamp((source as { motion?: string }).motion === 'float' && source.fontSize === 36 ? 64 : source.fontSize, 64, 18, 72), offsetMs: clamp(source.offsetMs, 0, -10000, 10000), motion: source.motion === 'stardust' || source.motion === 'stage' ? source.motion : 'depth',
    bounds: { x: clamp(b.x, .06, 0, 1 - width), y: clamp(b.y, .20, 0, 1 - height), width, height } }
}

export function normalizeWallpaperDepth(value: unknown): WallpaperDepthSettings {
  const source = value && typeof value === 'object' ? value as Partial<WallpaperDepthSettings> : {}
  return { enabled: source.enabled === true, amount: clamp(source.amount,25,0,100), profile: source.profile === 'left-foreground' ? 'left-foreground' : 'landscape', revision: typeof source.revision === 'string' && /^[a-f0-9]{1,32}$/.test(source.revision) ? source.revision : '' }
}

export function normalizeDesktopCard(value: unknown): DesktopCardSettings {
  const source = value && typeof value === 'object' ? value as Partial<DesktopCardSettings> : {}
  const b = source.bounds ?? defaultDesktopCard.bounds
  const width = clamp(b.width, .23, .15, .45), height = clamp(b.height, .13, .08, .24)
  return { enabled: source.enabled === true, variant: source.variant === 'afternoon' ? 'afternoon' : source.variant === 'compact' ? 'compact' : 'record', bounds: { x: clamp(b.x, .035, 0, 1 - width), y: clamp(b.y, .81, 0, 1 - height), width, height } }
}

const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value) && value !== 'primary'
function normalizeRegions(value: unknown): SpectrumRegion[] {
  const seen = new Set<string>()
  return (Array.isArray(value) ? value : []).filter(item => item && validId(item.id) && !seen.has(item.id) && !!seen.add(item.id)).slice(0, MAX_REGIONS - 1).map(item => {
    // Strip collections before reusing the legacy appearance normalization.
    const style = normalizeSettings({ ...item, regions: [], masks: [] })
    return { id: item.id, name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 24) : '装饰区域', visible: item.visible !== false,
      effect: style.effect, sceneMode: style.sceneMode, view: style.view, color: style.color, opacity: style.opacity, sensitivity: style.sensitivity, decay: style.decay, reflection: style.reflection, glow: style.glow, bounds: style.bounds, atmosphere: style.atmosphere, music: style.music }
  })
}

function normalizeAtmosphere(value: unknown): AtmosphereSettings {
  const a = (value && typeof value === 'object' ? value : {}) as Partial<AtmosphereSettings>
  return {
    direction: clamp(a.direction, defaultAtmosphere.direction, -180, 180),
    wind: clamp(a.wind, defaultAtmosphere.wind, 0, 100),
    fog: clamp(a.fog, defaultAtmosphere.fog, 0, 100),
    lights: clamp(a.lights, defaultAtmosphere.lights, 0, 100),
    choreography: typeof a.choreography === 'boolean' ? a.choreography : defaultAtmosphere.choreography,
  }
}
function normalizeMasks(value: unknown): SceneMask[] {
  const seen = new Set<string>()
  return (Array.isArray(value) ? value : []).filter(item => item && validId(item.id) && !seen.has(item.id) && !!seen.add(item.id)).slice(0, MAX_MASKS).map(item => {
    const b = item.bounds ?? {}, width = clamp(b.width, .2, .02, 1), height = clamp(b.height, .3, .02, 1)
    return { id: item.id, bounds: { x: clamp(b.x, .4, 0, 1 - width), y: clamp(b.y, .3, 0, 1 - height), width, height }, feather: clamp(item.feather, .015, 0, .08) }
  })
}

export const browserStatus: RuntimeStatus = {
  state: "waiting",
  message: "浏览器预览 · 尚未连接桌面客户端",
  processId: null,
  desktopAttached: false,
  editing: false,
};
