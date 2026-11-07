import React from 'react'
import { createRoot } from 'react-dom/client'
import { MusicCard } from '../../src/features/desktop-card/music-card'
import { CardLayer } from '../../src/features/desktop-card/card-layer'
import { useCoverColors } from '../../src/features/desktop-card/use-cover-colors'
import { CardControls } from '../../src/features/desktop-card/card-controls'
import { defaults, normalizeSettings, type SpectrumSettings } from '../../src/features/spectrum/model'
import { emptyNowPlaying, type NowPlaying } from '../../src/features/desktop-card/use-now-playing'
import { desktopLayout, parseDesktopScene, scenePatch } from '../../src/features/preview/desktop-scenes'
import '../../src/index.css'
import '../../src/features/settings/studio.css'
const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#567b78"/><circle cx="86" cy="40" r="37" fill="#f2d4a1"/><path d="M0 90Q32 45 70 96T128 80V128H0" fill="#233c41"/></svg>')
let info: NowPlaying = { ...emptyNowPlaying, title: '沿着海岸慢慢走', artist: '林间来信 / Field Notes', album: '海风手记', cover, playing: true, timelineAvailable: true, position: 72, duration: 236, source: 'QQ 音乐', processId: 10, updated: Date.now(), trackId: 'source:track-a' }
let settings = structuredClone(defaults)
let width = 480, height = 152, active = true, sound = true, desktop = false
const bands = { current: new Float32Array(96) }, receivedAt = { current: 0 }
const root = createRoot(document.getElementById('root')!)
document.body.style.cssText = 'margin:0;background:#182125;color:#f3f1ea'
function CardSample() {
  const colors = useCoverColors(settings, info, active)
  return <MusicCard {...{ info, bands, receivedAt, active, desktop }} settings={settings.desktopCard} color={colors.cardColor} />
}
function render() { root.render(<><div id="card-frame" style={{ width, height, margin: 28 }}><CardSample /></div>{new URLSearchParams(location.search).has('parity') && <div id="parity-frame" style={{ position: 'relative', width: width / 2, height: height / 2, margin: 28 }}><CardLayer {...{ info, bands, receivedAt, active, desktop }} settings={{ ...settings.desktopCard, bounds: { x: 0, y: 0, width: 1, height: 1 } }} color={settings.color} previewSize={{ width, height, scale: .5 }} /></div>}<div style={{ width: 360, marginLeft: 28 }}><CardControls settings={settings} disabled={false} update={patch => { settings = normalizeSettings({ ...settings, ...patch }); render() }} /></div></>) }
Object.assign(window, { cardProbe: {
  set(patch: Partial<NowPlaying>) { info = { ...info, ...patch, updated: patch.updated ?? Date.now() }; render() },
  layout(patch: { width?: number; height?: number; active?: boolean; sound?: boolean; desktop?: boolean; variant?: 'record' | 'compact' | 'afternoon'; background?: string }) { width = patch.width ?? width; height = patch.height ?? height; active = patch.active ?? active; sound = patch.sound ?? sound; desktop = patch.desktop ?? desktop; if (patch.variant) settings.desktopCard.variant = patch.variant; if (patch.background) document.body.style.background = patch.background; render() },
  settings: () => settings, cover,
  configure(patch: Partial<SpectrumSettings>) { settings = normalizeSettings({ ...settings, ...patch }); render() },
  compatibility: (value: unknown) => normalizeSettings(value),
  roundTrip: () => scenePatch(settings, { desktop: parseDesktopScene(desktopLayout(settings).desktop) }),
} })
setInterval(() => { if (!sound) return; receivedAt.current = performance.now(); for (let index = 0; index < 96; index++) bands.current[index] = .2 + .35 * Math.max(0, Math.sin(performance.now() / 420 + index * .35)) }, 50)
render()
