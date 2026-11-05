import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  browserStatus,
  defaults,
  normalizeSettings,
  type RuntimeStatus,
  type SpectrumSettings,
} from "./model";

export const native = isTauri();
const storageKey = "soundspectra.settings.v1";

export async function loadSettings(): Promise<SpectrumSettings> {
  if (native) return normalizeSettings(await invoke("get_settings"));
  const stored = localStorage.getItem(storageKey);
  if (!stored) return structuredClone(defaults);
  return { ...normalizeSettings(JSON.parse(stored)), enabled: false };
}

export async function saveSettings(
  settings: SpectrumSettings,
): Promise<SpectrumSettings> {
  if (native)
    return normalizeSettings(await invoke("update_settings", { settings }));
  const previewSettings = { ...settings, enabled: false };
  localStorage.setItem(storageKey, JSON.stringify(previewSettings));
  return previewSettings;
}

export async function getStatus(): Promise<RuntimeStatus> {
  return native ? invoke("get_status") : browserStatus;
}

export async function resetSettings(): Promise<SpectrumSettings> {
  if (native) return normalizeSettings(await invoke("reset_settings"));
  const previous = localStorage.getItem(storageKey);
  if (previous !== null) localStorage.setItem(`${storageKey}.backup`, previous);
  return saveSettings(structuredClone(defaults));
}

export async function setEditing(editing: boolean) {
  if (!native) throw new Error("请在桌面客户端中调整实际桌面位置。");
  return invoke<SpectrumSettings>("set_editing", { editing });
}

export async function subscribeBands(onBands: (bands: number[]) => void) {
  if (!native) return () => {};
  return listen<number[]>("spectrum", (event) => onBands(event.payload));
}

export async function subscribeSettings(
  onSettings: (settings: SpectrumSettings) => void,
) {
  if (!native) return () => {};
  return listen<SpectrumSettings>("settings-changed", (event) =>
    onSettings(normalizeSettings(event.payload)),
  );
}

export function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function subscribeGeometry(onSettings: (settings: SpectrumSettings) => void) {
  if (!native) return () => {};
  return listen<SpectrumSettings>("geometry-changed", (event) => onSettings(normalizeSettings(event.payload)));
}
