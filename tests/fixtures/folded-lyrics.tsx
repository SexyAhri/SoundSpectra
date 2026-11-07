import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { FoldedLyrics } from '../../src/features/lyrics/folded-lyrics'
import { demoLyrics } from '../../src/features/lyrics/model'
import { defaultLyricPalette } from '../../src/features/lyrics/lyric-palette'
import { LyricLayer } from '../../src/features/lyrics/lyric-layer'
import { defaultLyrics } from '../../src/features/spectrum/model'
import { emptyNowPlaying } from '../../src/features/desktop-card/use-now-playing'
import { trackKey } from '../../src/features/lyrics/model'
import '../../src/features/lyrics/lyrics.css'

document.body.style.cssText = 'margin:0;background:#111b24;overflow:hidden'
const host = document.createElement('div'); host.style.cssText = 'position:absolute;inset:8% 6%'
document.body.append(host)
const root = createRoot(host)
let state = { fontStyle: 'modern' as 'modern' | 'poetry', time: 2600, reduced: false, lines: demoLyrics, fontSize: 64, regionWidth: .88, backgroundOpacity: 0, playing: false, desktop: false, readability: 'soft' as 'soft' | 'contrast', palette: defaultLyricPalette, layer: false, offsetMs: 0, available: true, bounds: { ...defaultLyrics.bounds } }
function render() {
  const snapshot = state, start = performance.now()
  const info = { ...emptyNowPlaying, title: 'Transport fixture', artist: 'Test', playing: snapshot.playing, position: snapshot.time / 1000, duration: 100, updated: Date.now(), timelineAvailable: snapshot.available }
  const settings = { ...defaultLyrics, fontStyle: snapshot.fontStyle, enabled: true, motion: 'folded' as const, fontSize: snapshot.fontSize, backgroundOpacity: snapshot.backgroundOpacity, readability: snapshot.readability, offsetMs: snapshot.offsetMs, bounds: snapshot.bounds }
  root.render(<StrictMode>{state.layer ? <LyricLayer settings={settings} document={{ key: trackKey(info), status: 'ready', message: '', file: null, lines: snapshot.lines }} info={info} desktop /> : <FoldedLyrics {...snapshot} readTime={() => snapshot.time + (snapshot.playing ? performance.now() - start : 0)} />}</StrictMode>)
}
;(window as any).foldedProbe = { set(patch: Partial<typeof state>) { state = { ...state, ...patch }; render() } }
render()
