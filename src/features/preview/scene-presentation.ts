import type { SpectrumSettings } from "../spectrum/model";
import { musicEffects } from "../spectrum/music-engine/catalog";
import { desktopLayout, desktopPresets, scenePatch } from "./desktop-scenes";
import type { SavedScene, SceneLayout } from "./scene-library";
import { sceneSignature } from "./scene-signature";

export function sceneName(
  settings: SpectrumSettings,
  saved: SavedScene[],
  recentId: string | null,
) {
  const signature = sceneSignature(desktopLayout(settings));
  const matches = (item: { scene: SceneLayout }) =>
    !!item.scene.desktop &&
    sceneSignature(
      desktopLayout({ ...settings, ...scenePatch(settings, item.scene) }),
    ) === signature;
  const choices = [...desktopPresets, ...saved];
  const recent = choices.find((item) => item.id === recentId && matches(item));
  const matched = recent ?? choices.find(matches);
  if (matched) return matched.name;
  const effects = [
    settings.regionVisible,
    ...settings.regions.map((region) => region.visible),
  ].filter(Boolean).length;
  if (settings.desktopCard.enabled || settings.lyrics.enabled || effects > 1)
    return "自定义搭配";
  return effects
    ? (musicEffects.find(
        (item) =>
          item.value ===
          (settings.regionVisible
            ? settings.effect
            : settings.regions.find((region) => region.visible)!.effect),
      )?.label ?? "我的场景")
    : "我的场景";
}

export function sceneStatus(
  settings: SpectrumSettings,
  demo: boolean,
  running: boolean,
  audioState?: string,
) {
  if (audioState === "error")
    return `${demo ? "演示画面 · " : ""}音源连接异常，请检查音源与桌面`;
  const visible =
    settings.regionVisible || settings.regions.some((region) => region.visible);
  if (!visible) {
    const mode =
      settings.desktopCard.enabled && settings.lyrics.enabled
        ? "卡片与歌词模式"
        : settings.desktopCard.enabled
          ? "音乐卡片模式"
          : settings.lyrics.enabled
            ? "歌词模式"
            : settings.wallpaperDepth.enabled ||
                settings.wallpaperDepth.ambientEnabled
              ? "壁纸氛围模式"
              : null;
    if (!mode) return "当前搭配未开启显示内容，可在编辑场景中调整";
    return `${demo ? "演示画面 · " : ""}${mode}`;
  }
  return running
    ? "正在随音乐响应"
    : demo
      ? "演示画面 · 接入音乐后自动跟随"
      : "等待音乐播放";
}
