import { Profiler, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { defaults, type SpectrumSettings } from '../../src/features/spectrum/model'
import { useSceneTransition } from '../../src/features/preview/use-scene-transition'
import { WallpaperAmbience } from '../../src/features/wallpaper-depth/wallpaper-ambience'
import { LyricLayer } from '../../src/features/lyrics/lyric-layer'
import { emptyLyrics } from '../../src/features/lyrics/model'
import { emptyNowPlaying } from '../../src/features/desktop-card/use-now-playing'
import { avoidRail } from '../../src/features/lyrics/avoid-rail'
import { useRailPresence } from '../../src/features/rail/use-rail-presence'

let settings: SpectrumSettings = structuredClone(defaults)
let enabled = false
let obstacles = [{ x: .35, y: .55, width: .3, height: .45 }]
let presence: { name: string } | null = { name: 'initial' }
const root = createRoot(document.getElementById('root')!)
const probe = {
  commits: [] as string[], presenceCommits: 0, masks: 0, searches: 0,
  presence(value: string | null) { presence = value === null ? null : { name: value }; render() },
  cloneObstacles() { obstacles = obstacles.map(b => ({ ...b })); render() },
  moveObstacle() { obstacles = [{ ...obstacles[0], x: .4 }]; render() },
  searchBaseline() { for (let i = 0; i < 6; i++) avoidRail(settings.lyrics.bounds, obstacles) },
  update(patch: Partial<SpectrumSettings>, transition = enabled) {
    settings = { ...settings, ...patch }; enabled = transition; render()
  },
  ambient(patch: Partial<SpectrumSettings['wallpaperDepth']>) {
    settings = { ...settings, wallpaperDepth: { ...settings.wallpaperDepth, ...patch } }; render()
  },
  cloneGeometry() {
    settings = { ...settings, wallpaperDepth: { ...settings.wallpaperDepth, ambientBounds: { ...settings.wallpaperDepth.ambientBounds } }, masks: settings.masks.map(mask => ({ ...mask, bounds: { ...mask.bounds } })) }
    render()
  },
}
Object.assign(window, { sceneWork: probe })
const hypot = Math.hypot
Math.hypot = (...values: number[]) => { probe.searches++; return hypot(...values) }
const createImageData = CanvasRenderingContext2D.prototype.createImageData
CanvasRenderingContext2D.prototype.createImageData = function (...args: any[]) {
  probe.masks++
  return (createImageData as any).apply(this, args)
}
let shown = ''
function PresenceProbe() {
  const retained = useRailPresence(presence)
  return <output className="presence-work">{retained?.name ?? 'closed'}</output>
}
function Probe() {
  const surface = useRef<HTMLDivElement>(null)
  const analysis = useRef({ rms: 0, receivedAt: 0 } as any)
  const current = useSceneTransition(settings, enabled, surface)
  shown = current.color
  return <><div ref={surface} data-color={shown} style={{ width: 100, height: 100 }}>{shown}</div>
    <WallpaperAmbience settings={settings.wallpaperDepth} masks={settings.masks} analysis={analysis} demo />
    <LyricLayer settings={settings.lyrics} document={emptyLyrics} info={emptyNowPlaying} obstacles={obstacles} active={false} />
    <Profiler id="presence" onRender={() => probe.presenceCommits++}><PresenceProbe /></Profiler>
  </>
}
function render() {
  flushSync(() => root.render(<Profiler id="scene" onRender={() => probe.commits.push(shown)}><Probe /></Profiler>))
}
render()
