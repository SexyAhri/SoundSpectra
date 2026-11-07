import type { WallpaperDepthSettings } from '../spectrum/model'
import type { DesktopBackground, ScreenRect } from '../preview/background'

export const wallpaperNeedsSurface = (settings: WallpaperDepthSettings) => settings.source === 'custom' || settings.enabled || settings.ambientEnabled || settings.brightness !== 100 || settings.saturation !== 100

export function customWallpaperBackground(settings: WallpaperDepthSettings, screen: ScreenRect): DesktopBackground {
  return { screen, virtualScreen: screen, color: '#15191e', image: null, revision: settings.revision, issue: null,
    position: settings.fit === 'contain' ? 'fit' : 'fill', anchor: { x: settings.focusX / 100, y: settings.focusY / 100 } }
}
