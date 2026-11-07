import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { SceneMask, WallpaperDepthSettings } from '../spectrum/model'
import type { AnalysisSnapshot } from '../spectrum/spectrum-canvas'
import { wallpaperStyle, referenceScreen, type DesktopBackground, type PreviewImage, type ScreenRect } from '../preview/background'
import { useBackground } from '../preview/use-background'
import { DepthWallpaper } from './wallpaper-depth-layer'
import { useDepthImage } from './image-store'
import { customWallpaperBackground } from './wallpaper-layout'
import { WallpaperAmbience } from './wallpaper-ambience'
import './wallpaper-depth.css'

export const wallpaperFilter = (settings: WallpaperDepthSettings) => `brightness(${settings.brightness / 100}) saturate(${settings.saturation / 100})`

interface Props {
  settings: WallpaperDepthSettings; masks: SceneMask[]; analysis: RefObject<AnalysisSnapshot>;
  image: PreviewImage | null; background: DesktopBackground | null; screen: ScreenRect;
  paintImage?: boolean; active?: boolean; desktop?: boolean; demo?: boolean; host?: RefObject<HTMLElement | null>;
}
export function WallpaperSurface({ settings, masks, analysis, image, background, screen, paintImage = true, active = true, desktop = false, demo = false, host }: Props) {
  const surface = useRef<HTMLDivElement>(null), [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!paintImage) return
    const measure = () => setWidth(surface.current?.clientWidth ?? 0)
    const observer = new ResizeObserver(measure); observer.observe(surface.current!); measure()
    return () => observer.disconnect()
  }, [paintImage])
  return <div className="wallpaper-surface" ref={surface} data-testid="wallpaper-surface" data-source={settings.source}>
    {paintImage && (image || settings.source === 'system' && background) && <div className="wallpaper-static" data-testid="wallpaper-static" style={{ ...wallpaperStyle(image, background, screen, width), filter: wallpaperFilter(settings) }} />}
    {settings.source === 'custom' && settings.enabled && settings.fit === 'cover' && <div className="wallpaper-surface" style={{ filter: wallpaperFilter(settings) }}><DepthWallpaper settings={settings} active={active} desktop={desktop} host={host} /></div>}
    {settings.ambientEnabled && <WallpaperAmbience settings={settings} masks={masks} analysis={analysis} active={active} demo={demo} />}
  </div>
}

export function DesktopWallpaper(props: Pick<Props, 'settings' | 'masks' | 'analysis' | 'active'>) {
  const { settings } = props
  const custom = useDepthImage(settings.source === 'custom' ? settings.revision : '')
  const needsSystemImage = settings.source === 'system' && (settings.brightness !== 100 || settings.saturation !== 100)
  const system = useBackground(needsSystemImage)
  const screen = system.desktop?.screen ?? { ...referenceScreen, width: innerWidth, height: innerHeight }
  const image = settings.source === 'custom' ? custom.image ? { url: custom.image.dataUrl, width: custom.image.width, height: custom.image.height } : null : needsSystemImage ? system.systemImage : null
  const background = settings.source === 'custom' ? customWallpaperBackground(settings, screen) : needsSystemImage ? system.desktop : null
  return <WallpaperSurface {...props} image={image} background={background} screen={screen} desktop />
}
