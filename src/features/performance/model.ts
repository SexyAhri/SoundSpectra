import {
  defaults,
  effectIds,
  normalizeSettings,
  type SpectrumSettings,
} from "../spectrum/model";
import type { NowPlaying } from "../desktop-card/use-now-playing";

export type TransitionKind = "dissolve" | "particles" | "travel";
export interface TransitionSettings {
  kind: TransitionKind;
  durationMs: number;
}
export type MappingSource = "bass" | "middle" | "treble" | "transient";
export type MappingTarget = "bend" | "unfold";
export interface Mapping {
  preset: "original" | "bend" | "unfold" | "custom";
  source: MappingSource;
  target: MappingTarget;
  amount: number;
  curve: "linear" | "square";
}
export const originalMapping: Mapping = {
  preset: "original",
  source: "bass",
  target: "bend",
  amount: 0.8,
  curve: "linear",
};
export const mappingCapabilities: Partial<
  Record<SpectrumSettings["effect"], { bend: string; unfold: string }>
> = {
  tidal_knot: {
    bend: "粒子流经线弯曲（±0.7 弧度）",
    unfold: "内外粒子层分离（0–1.6 单位）",
  },
  layered_tides: {
    bend: "波面横向弯曲（±1.8 单位）",
    unfold: "上下波面展开（0–2.4 单位）",
  },
  echo_corridor: {
    bend: "廊道路径弯曲（±1.8 单位）",
    unfold: "六股轨道局部展开（0–1.8 单位）",
  },
};
export const snapshotKeys = [
  "effect",
  "sceneMode",
  "music",
  "color",
  "opacity",
  "reflection",
  "glow",
  "atmosphere",
  "view",
] as const;
export type VisualSnapshot = Pick<
  SpectrumSettings,
  (typeof snapshotKeys)[number]
>;
export const visualSnapshot = (settings: SpectrumSettings): VisualSnapshot =>
  structuredClone(
    Object.fromEntries(snapshotKeys.map((key) => [key, settings[key]])),
  ) as VisualSnapshot;
export type CueAction =
  | {
      type: "scene";
      snapshot: VisualSnapshot;
      name: string;
      libraryId?: string;
      transition: TransitionSettings;
    }
  | { type: "palette"; palette: SpectrumSettings["music"]["fieldPalette"] }
  | { type: "camera"; durationMs: number; yaw: number; push: number };
export interface Cue {
  id: string;
  timeMs: number;
  action: CueAction;
}
export interface Show {
  id: string;
  name: string;
  track: string | null;
  region: string;
  cues: Cue[];
}
export interface PerformanceConfig {
  version: 1;
  transition: TransitionSettings;
  mappings: Record<string, Mapping>;
  shows: Show[];
  selected: string;
}
export const emptyPerformance: PerformanceConfig = {
  version: 1,
  transition: { kind: "dissolve", durationMs: 1400 },
  mappings: {},
  shows: [],
  selected: "",
};
// Never identify a recording using its title alone. No metadata => explicit binding unavailable.
export function recordingKey(info: NowPlaying): string | null {
  if (!info.source || info.playbackAvailable === false || info.issue)
    return null;
  if (info.trackId) return JSON.stringify([info.source, info.trackId]);
  return info.title && info.artist && info.duration > 0
    ? JSON.stringify([
        info.source,
        info.title,
        info.artist,
        info.album,
        Math.round(info.duration),
      ])
    : null;
}
const sorted = (cues: Cue[]) =>
  cues
    .map((cue, index) => ({ cue, index }))
    .sort((a, b) => a.cue.timeMs - b.cue.timeMs || a.index - b.index)
    .map((item) => item.cue);
export interface ShowState {
  scene?: Extract<CueAction, { type: "scene" }>;
  sceneTime?: number;
  palette?: SpectrumSettings["music"]["fieldPalette"];
  camera?: { yaw: number; push: number };
  signature: string;
}
/** Pure absolute-time reconstruction: pauses, corrections, loops and seeks have the same result. */
export function showState(
  show: Show,
  timeMs: number,
  reduced = false,
): ShowState {
  const result: ShowState = { signature: "" };
  for (const cue of sorted(show.cues)) {
    if (cue.timeMs > timeMs) break;
    const a = cue.action;
    if (a.type === "scene") {
      result.scene = a;
      result.sceneTime = cue.timeMs;
      result.palette = undefined;
      result.camera = undefined;
      result.signature = cue.id;
    }
    if (a.type === "palette") result.palette = a.palette;
    if (a.type === "camera" && !reduced) {
      const p = (timeMs - cue.timeMs) / a.durationMs;
      result.camera =
        p >= 0 && p < 1
          ? {
              yaw: a.yaw * Math.sin(Math.PI * p) ** 2,
              push: a.push * Math.sin(Math.PI * p) ** 2,
            }
          : undefined;
    }
  }
  return result;
}
export function applyShow(
  base: SpectrumSettings,
  state: ShowState,
): SpectrumSettings {
  const s = state.scene ? { ...base, ...state.scene.snapshot } : base;
  return {
    ...s,
    music: state.palette
      ? { ...s.music, fieldPalette: state.palette }
      : s.music,
    view: state.camera
      ? {
          ...s.view,
          yaw: s.view.yaw + state.camera.yaw,
          distance: Math.max(0.25, s.view.distance * (1 - state.camera.push)),
        }
      : s.view,
  };
}
export function exampleShow(): Show {
  const scene = (effect: SpectrumSettings["effect"]): VisualSnapshot =>
    visualSnapshot({
      ...defaults,
      effect,
      sceneMode: "immersive",
      music: { ...defaults.music, fieldHeight: 1 },
    });
  return {
    id: crypto.randomUUID(),
    name: "回声航线 · 原创 36 秒",
    track: null,
    region: "primary",
    cues: [
      {
        id: "knot",
        timeMs: 0,
        action: {
          type: "scene",
          name: "潮汐开场",
          snapshot: scene("tidal_knot"),
          transition: { kind: "dissolve", durationMs: 1400 },
        },
      },
      {
        id: "tides",
        timeMs: 7000,
        action: {
          type: "scene",
          name: "粒子散入层海",
          snapshot: scene("layered_tides"),
          transition: { kind: "particles", durationMs: 1800 },
        },
      },
      {
        id: "dusk",
        timeMs: 11000,
        action: { type: "palette", palette: "ember" },
      },
      {
        id: "corridor",
        timeMs: 15000,
        action: {
          type: "scene",
          name: "进入回声廊道",
          snapshot: scene("echo_corridor"),
          transition: { kind: "dissolve", durationMs: 1600 },
        },
      },
      {
        id: "orbit",
        timeMs: 19000,
        action: { type: "camera", durationMs: 5000, yaw: 12, push: 0.14 },
      },
      {
        id: "flight",
        timeMs: 25000,
        action: {
          type: "scene",
          name: "穿向星河",
          snapshot: scene("star_flight"),
          transition: { kind: "travel", durationMs: 2000 },
        },
      },
      {
        id: "home",
        timeMs: 32000,
        action: {
          type: "scene",
          name: "回到潮汐",
          snapshot: scene("tidal_knot"),
          transition: { kind: "dissolve", durationMs: 1600 },
        },
      },
    ],
  };
}
const finite = (n: unknown, min: number, max: number) =>
  typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
const fail = (): never => {
  throw Error("演出文件参数无效，未应用任何更改。");
};
const equal = (a: unknown, b: unknown): boolean => {
  if (a && typeof a === "object")
    return (
      !!b &&
      typeof b === "object" &&
      Object.keys(a).length === Object.keys(b).length &&
      Object.entries(a).every(([key, value]) =>
        equal(value, (b as Record<string, unknown>)[key]),
      )
    );
  return a === b;
};
function transition(value: TransitionSettings) {
  if (
    !value ||
    !["dissolve", "particles", "travel"].includes(value.kind) ||
    !finite(value.durationMs, 200, 6000)
  )
    fail();
}
export function parsePerformance(raw: unknown): PerformanceConfig {
  const v = raw as PerformanceConfig;
  if (
    !v ||
    v.version !== 1 ||
    !Array.isArray(v.shows) ||
    v.shows.length > 24 ||
    typeof v.selected !== "string" ||
    !v.mappings ||
    typeof v.mappings !== "object" ||
    Array.isArray(v.mappings)
  )
    fail();
  transition(v.transition);
  if (Object.keys(v.mappings).length > 64) fail();
  for (const [key, m] of Object.entries(v.mappings))
    if (
      !/^[\w-]{1,64}$/.test(key) ||
      !m ||
      !["original", "bend", "unfold", "custom"].includes(m.preset) ||
      !["bass", "middle", "treble", "transient"].includes(m.source) ||
      !["bend", "unfold"].includes(m.target) ||
      !finite(m.amount, 0, 1) ||
      !["linear", "square"].includes(m.curve)
    )
      fail();
  const ids = new Set<string>();
  for (const s of v.shows) {
    if (
      !s ||
      typeof s.id !== "string" ||
      ids.has(s.id) ||
      !s.id ||
      s.id.length > 64 ||
      typeof s.name !== "string" ||
      !s.name.trim() ||
      s.name.length > 80 ||
      typeof s.region !== "string" ||
      !s.region ||
      s.region.length > 64 ||
      (s.track !== null &&
        (typeof s.track !== "string" || s.track.length > 2048)) ||
      !Array.isArray(s.cues) ||
      s.cues.length > 200
    )
      fail();
    ids.add(s.id);
    const cues = new Set<string>();
    for (const c of s.cues) {
      if (
        !c ||
        typeof c.id !== "string" ||
        !c.id ||
        c.id.length > 64 ||
        cues.has(c.id) ||
        !finite(c.timeMs, 0, 86400000) ||
        !c.action
      )
        fail();
      cues.add(c.id);
      const a = c.action;
      if (a.type === "scene") {
        transition(a.transition);
        if (
          typeof a.name !== "string" ||
          !a.name ||
          a.name.length > 80 ||
          (a.libraryId !== undefined &&
            (typeof a.libraryId !== "string" || a.libraryId.length > 64)) ||
          !a.snapshot ||
          Object.keys(a.snapshot).length !== snapshotKeys.length ||
          !effectIds.includes(a.snapshot.effect)
        )
          fail();
        const normalized = visualSnapshot(
          normalizeSettings({ ...defaults, ...a.snapshot }),
        );
        if (!equal(normalized, a.snapshot)) fail();
      } else if (a.type === "palette") {
        if (!["iris", "ember", "lake"].includes(a.palette)) fail();
      } else if (a.type === "camera") {
        if (
          !finite(a.durationMs, 500, 15000) ||
          !finite(a.yaw, -25, 25) ||
          !finite(a.push, 0, 0.25)
        )
          fail();
      } else fail();
    }
  }
  if (
    (v.selected !== "" && !ids.has(v.selected)) ||
    (v.shows.length > 0 && v.selected === "")
  )
    fail();
  return structuredClone(v);
}
