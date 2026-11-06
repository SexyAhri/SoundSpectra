import { defaults, normalizeDesktopCard, normalizeLyrics, normalizeLayerOrder, type DesktopCardSettings, type LyricSettings, type SpectrumSettings } from '../spectrum/model'
import { composition } from './scene-suggestions'
import type { SceneLayout } from './scene-library'

export interface DesktopScene {
  version: 1;
  card: DesktopCardSettings;
  lyrics: Omit<LyricSettings, 'folder' | 'offsetMs'>;
  followCover: boolean;
  layerOrder?: string[];
}
export function desktopLayout(settings: SpectrumSettings): SceneLayout {
  const { folder: _folder, offsetMs: _offset, ...lyrics } = settings.lyrics
  return structuredClone({ ...composition(settings), masks: settings.masks,
    desktop: { version: 1, card: settings.desktopCard, lyrics, followCover: settings.followCover, layerOrder: settings.layerOrder } })
}
export function parseDesktopScene(value: unknown): DesktopScene {
  if (!value || typeof value !== 'object') throw Error('桌面方案格式无效。')
  const source = value as DesktopScene
  const { folder: _folder, offsetMs: _offset, ...lyrics } = normalizeLyrics(source.lyrics)
  const result: DesktopScene = { version: 1, card: normalizeDesktopCard(source.card), lyrics, followCover: source.followCover }
  if ('layerOrder' in source) result.layerOrder = normalizeLayerOrder(source.layerOrder)
  const same = (a: unknown, b: unknown): boolean => {
    if (a && typeof a === 'object') return !!b && typeof b === 'object'
      && Object.keys(a).length === Object.keys(b).length
      && Object.entries(a).every(([key, value]) => same(value, (b as Record<string, unknown>)[key]))
    return a === b
  }
  if (typeof source.followCover !== 'boolean' || !same(result, source)) throw Error('桌面方案版本或展示参数无效。')
  return result
}
// One settings transaction; private lyric paths/timing and rail mounts stay owned
// by their original modules. Legacy effects-only scenes leave these fields alone.
export function scenePatch(current: SpectrumSettings, scene: Partial<SceneLayout>): Partial<SpectrumSettings> {
  const { desktop, ...effects } = scene
  return desktop ? { ...effects, ...(desktop.layerOrder ? { layerOrder: [...desktop.layerOrder] } : {}), desktopCard: structuredClone(desktop.card),
    lyrics: { ...current.lyrics, ...structuredClone(desktop.lyrics) }, followCover: desktop.followCover } : effects
}
export const desktopPresets = [
  { id: 'warm-sand', name: '暖砂日常', description: '温暖的小卡片，轻轻浮动的光', color: '#dfbd90', scene: desktopLayout({
    ...structuredClone(defaults), effect: 'volume_rain', color: '#dfbd90', opacity: 52, glow: 18,
    bounds: { x: .44, y: .56, width: .50, height: .34 }, music: { ...defaults.music, speed: 1 },
    desktopCard: { enabled: true, variant: 'compact', bounds: { x: .035, y: .81, width: .26, height: .13 } },
    lyrics: { ...defaults.lyrics, enabled: false },
  }) },
  { id: 'dusk-blue', name: '暮蓝听歌', description: '清晰的歌词，随旋律舒展的蓝', color: '#9bbdd4', scene: desktopLayout({
    ...structuredClone(defaults), effect: 'ripple', color: '#9bbdd4', opacity: 68, glow: 25,
    bounds: { x: .08, y: .60, width: .84, height: .30 }, music: { ...defaults.music, speed: 2 },
    desktopCard: { enabled: true, variant: 'record', bounds: { x: .035, y: .81, width: .26, height: .13 } },
    lyrics: { ...defaults.lyrics, enabled: true, motion: 'stage', fontSize: 44, backgroundOpacity: 24,
      bounds: { x: .12, y: .22, width: .76, height: .33 } },
  }) },
  { id: 'quiet-mint', name: '清浅专注', description: '收起大幅运动，留一点音乐陪伴', color: '#a6c3b5', scene: desktopLayout({
    ...structuredClone(defaults), effect: 'rhythm_balls', regionVisible: false, color: '#a6c3b5', opacity: 40, glow: 0,
    desktopCard: { enabled: true, variant: 'compact', bounds: { x: .035, y: .84, width: .23, height: .10 } },
    lyrics: { ...defaults.lyrics, enabled: false }, music: { ...defaults.music, speed: 0 },
  }) },
]
