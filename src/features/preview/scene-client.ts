import { invoke } from '@tauri-apps/api/core'
import { native, saveSettings } from '../spectrum/bridge'
import { normalizeSettings, type SpectrumSettings } from '../spectrum/model'
import type { SceneLayout } from './scene-library'
import { scenePatch } from './desktop-scenes'

export async function applyDesktopScene(scene: Partial<SceneLayout>, current: SpectrumSettings): Promise<SpectrumSettings> {
  if (native) return normalizeSettings(await invoke('apply_scene', { scene }))
  return saveSettings({ ...current, ...scenePatch(current, scene) })
}
