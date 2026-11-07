import { type SpectrumSettings, type SpectrumRegion, type RegionStyle, type SceneBounds } from './model'
import { wallpaperNeedsSurface } from '../wallpaper-depth/wallpaper-layout'

export const styleKeys = ['effect', 'sceneMode', 'view', 'color', 'opacity', 'sensitivity', 'decay', 'reflection', 'glow', 'bounds', 'atmosphere', 'music'] as const
export const regionStyle = (settings: RegionStyle): RegionStyle => Object.fromEntries(styleKeys.map(key => [key, settings[key]])) as RegionStyle
export const sceneRegions = (settings: SpectrumSettings): SpectrumRegion[] => [
  { id: 'primary', name: settings.regionName, visible: settings.regionVisible, ...regionStyle(settings) }, ...settings.regions,
]
export function settingsForRegion(settings: SpectrumSettings, id: string): SpectrumSettings {
  const region = settings.regions.find(region => region.id === id)
  return region ? { ...settings, ...regionStyle(region) } : settings
}
export function regionPatch(settings: SpectrumSettings, id: string, patch: Partial<SpectrumSettings>): Partial<SpectrumSettings> {
  if (id === 'primary') return patch
  // A late gesture from a removed region must never become a primary edit.
  if (!settings.regions.some(region => region.id === id)) return {}
  const global = { ...patch }, style: Partial<RegionStyle> = {}
  for (const key of styleKeys) if (key in patch) { Object.assign(style, { [key]: patch[key] }); delete global[key] }
  return { ...global, regions: settings.regions.map(region => region.id === id ? { ...region, ...style } : region) }
}
export function displayBounds(settings: SpectrumSettings): SceneBounds {
  if(wallpaperNeedsSurface(settings.wallpaperDepth) || settings.lyrics.enabled)return {x:0,y:0,width:1,height:1}
  const visible = sceneRegions(settings).filter(region => region.visible)
  if (settings.desktopCard.enabled) visible.push({ ...sceneRegions(settings)[0], bounds: settings.desktopCard.bounds })
  if (settings.lyrics.enabled) visible.push({ ...sceneRegions(settings)[0], bounds: settings.lyrics.bounds })
  if (!visible.length) return settings.bounds
  const x = Math.min(...visible.map(region => region.bounds.x)), y = Math.min(...visible.map(region => region.bounds.y))
  return { x, y, width: Math.max(...visible.map(region => region.bounds.x + region.bounds.width)) - x, height: Math.max(...visible.map(region => region.bounds.y + region.bounds.height)) - y }
}
export function relativeBounds(bounds: SceneBounds, host: SceneBounds): SceneBounds {
  return { x: (bounds.x - host.x) / host.width, y: (bounds.y - host.y) / host.height, width: bounds.width / host.width, height: bounds.height / host.height }
}
