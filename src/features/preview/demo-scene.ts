import { defaults, type SpectrumSettings } from "../spectrum/model";
import type { RailSettings } from "../rail/model";
import type { DesktopBackground, PreviewImage } from "./background";
import terrace from "../../assets/demo-scene/terrace.webp";
import terracePhoto from "../../assets/demo-scene/terrace-photo.webp";
import village from "../../assets/demo-scene/village.webp";
import uu from "../../assets/demo-scene/uu-remote.png";
import utools from "../../assets/demo-scene/utools.png";
import youdao from "../../assets/demo-scene/youdao.png";
import vscode from "../../assets/demo-scene/vscode.png";
import doubao from "../../assets/demo-scene/doubao.png";
import ccSwitch from "../../assets/demo-scene/cc-switch.png";

// Preview-only composition. Never persist it or resolve its items as local files.
export function demoSceneSettings(current: SpectrumSettings): SpectrumSettings {
  return {
    ...defaults,
    quality: current.quality,
    effect: "ripple",
    sceneMode: "immersive",
    regionName: "山间晴雪",
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    view: { yaw: -0.3813559322, pitch: 7.6836158192, roll: 0, x: 0, y: 0, distance: 1.7571718951 },
    opacity: 100,
    sensitivity: 106,
    decay: 76,
    reflection: 11,
    glow: 61,
    music: { ...defaults.music, fieldBrightness: 45, sensitivity: 0.65, response: "soft", rippleWidth: 1, rippleTwist: 0.3, rippleLights: 2 },
    atmosphere: { direction: 15, wind: 42, fog: 55, lights: 73, choreography: true },
    lyrics: {
      ...defaults.lyrics,
      enabled: true,
      motion: "stardust",
      fontSize: 18,
      backgroundOpacity: 6,
      bounds: { x: 0.1493644068, y: 0.7983419809, width: 0.6578389831, height: 0.2016580191 },
    },
  };
}

export const demoWallpaper: PreviewImage = { url: terrace, width: 1920, height: 1080 };
export const demoBackground: DesktopBackground = {
  screen: { x: 0, y: 0, width: 2560, height: 1440 },
  virtualScreen: { x: 0, y: 0, width: 2560, height: 1440 },
  position: "fill",
  color: "#bcc8b9",
  image: null,
  revision: "demo-terrace",
  issue: null,
};

export const demoRail: RailSettings = {
  version: 1,
  enabled: true,
  groups: [{
    id: "demo-terrace-rail",
    name: "山间拾光",
    x: 0, y: 0, width: 1,
    collapsed: false,
    skin: "autumn",
    items: [
      { id: "demo-uu", name: "UU远程", kind: "app", path: "", crop: "cover" },
      { id: "demo-terrace", name: "山间露台", kind: "image", path: "", crop: "cover" },
      { id: "demo-utools", name: "uTools", kind: "app", path: "", crop: "cover" },
      { id: "demo-youdao", name: "YoudaoDict", kind: "app", path: "", crop: "cover" },
      { id: "demo-vscode", name: "Visual Studio Code", kind: "app", path: "", crop: "cover" },
      { id: "demo-doubao", name: "豆包", kind: "app", path: "", crop: "cover" },
      { id: "demo-village", name: "村间小景", kind: "image", path: "", crop: "cover" },
      { id: "demo-cc", name: "CC Switch", kind: "app", path: "", crop: "cover" },
    ],
  }],
};

export const demoRailMedia: Readonly<Record<string, string>> = {
  "demo-uu": uu,
  "demo-terrace": terracePhoto,
  "demo-utools": utools,
  "demo-youdao": youdao,
  "demo-vscode": vscode,
  "demo-doubao": doubao,
  "demo-village": village,
  "demo-cc": ccSwitch,
};
