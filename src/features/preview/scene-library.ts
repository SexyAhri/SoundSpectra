import { invoke } from '@tauri-apps/api/core'
import { native } from '../spectrum/bridge'
import { defaults, normalizeSettings, migrateEffectId, type SpectrumSettings } from '../spectrum/model'
import { composition, type SceneComposition } from './scene-suggestions'

export type SceneLayout = SceneComposition & Pick<SpectrumSettings, 'masks'>
export interface SavedScene { id: string; name: string; wallpaper: string | null; updated: number; scene: SceneLayout }
export const libraryKey = 'soundspectra.scene-library.v1'
export const layout = (settings: SpectrumSettings): SceneLayout => ({ ...composition(settings), masks: structuredClone(settings.masks) })

function matches(expected: unknown, value: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(value)
      && value.length === expected.length
      && expected.every((item, i) => matches(item, value[i]))
  }
  if (expected && typeof expected === 'object') {
    if (!value || typeof value !== 'object') return false
    return Object.entries(expected).every(([key, item]) => {
      // Older saved scenes inherit the neutral atmosphere controls.
      if ((key === 'atmosphere' || key === 'music' || key === 'view') && !(key in value)) return true
      // Scenes exported before the 3D field inherit its neutral defaults.
      if (key.startsWith('field') && !(key in value)) return true
      if ((key === 'ambientDensity' || key === 'ambientSpread') && !(key in value)) return true
      return matches(item, (value as Record<string, unknown>)[key])
    })
  }
  return expected === value
}
export function parseLayout(value: unknown): SceneLayout {
  // Only known retired effect IDs are migrated. Unknown IDs and malformed values still fail.
  const migrate = (item: unknown) => item && typeof item === 'object'
    ? { ...item, effect: migrateEffectId((item as { effect?: unknown }).effect) } : item
  const source = migrate(value)
  const prepared = source && typeof source === 'object' && 'regions' in source
    ? { ...source, regions: Array.isArray(source.regions) ? source.regions.map(migrate) : source.regions } : source
  const result = layout(normalizeSettings(prepared))
  if (!matches(result, prepared)) throw new Error('场景参数无效，或包含当前版本不支持的动效。')
  return result
}
export function readLibrary(): SavedScene[] {
  const raw: unknown = JSON.parse(localStorage.getItem(libraryKey) ?? '[]')
  if (!Array.isArray(raw) || raw.length > 40) throw new Error('场景库格式无效。')
  const ids = new Set<string>()
  return raw.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id)
      || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 40 || !Number.isFinite(item.updated)
      || item.wallpaper !== null && (typeof item.wallpaper !== 'string' || item.wallpaper.length > 120)) throw new Error('场景库记录无效。')
    ids.add(item.id)
    return { id: item.id, name: item.name, wallpaper: item.wallpaper, updated: item.updated, scene: parseLayout(item.scene) }
  })
}
export function writeLibrary(items: SavedScene[]) {
  if (items.length > 40) throw new Error('最多保存 40 个场景，请先删除不需要的收藏。')
  localStorage.setItem(libraryKey, JSON.stringify(items))
}
export function recoverLibrary() {
  const raw = localStorage.getItem(libraryKey)
  if (raw !== null) localStorage.setItem(`${libraryKey}.backup.${Date.now()}`, raw)
  writeLibrary([])
}
export function sceneDocument(scene: Pick<SavedScene, 'name' | 'scene'>) {
  return JSON.stringify({ format: 'SoundSpectra.scene', version: 1, name: scene.name, scene: scene.scene }, null, 2)
}
export function importScene(text: string): Pick<SavedScene, 'name' | 'scene'> {
  if (text.length > 262144) throw new Error('场景文件超过 256 KB。')
  const data = JSON.parse(text)
  if (data?.format !== 'SoundSpectra.scene' || data.version !== 1 || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 40) throw new Error('不是受支持的 SoundSpectra 场景文件。')
  return { name: data.name.trim(), scene: parseLayout(data.scene) }
}
export async function exportScene(item: Pick<SavedScene, 'name' | 'scene'>) {
  if (native) return invoke<string>('export_scene', { name: item.name, settings: { ...defaults, ...item.scene } })
  const url = URL.createObjectURL(new Blob([sceneDocument(item)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = 'SoundSpectra.scene.json'; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return '场景文件已下载，不含壁纸图片。'
}
