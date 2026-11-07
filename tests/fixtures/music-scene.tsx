import { StrictMode, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { SpectrumCanvas } from '../../src/features/spectrum/spectrum-canvas'
import { CardLayer } from '../../src/features/desktop-card/card-layer'
import { useCoverColors } from '../../src/features/desktop-card/use-cover-colors'
import { emptyNowPlaying } from '../../src/features/desktop-card/use-now-playing'
import { LyricLayer } from '../../src/features/lyrics/lyric-layer'
import { SceneFocusProvider } from '../../src/features/spectrum/scene-focus'
import { defaults, type SpectrumSettings } from '../../src/features/spectrum/model'
import { trackKey, type LyricLine } from '../../src/features/lyrics/model'
import '../../src/index.css'

document.body.style.cssText = 'margin:0;overflow:hidden;background:#080f16'
const host = document.createElement('div'); document.body.append(host)
const root = createRoot(host)
const artwork = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#3a958d"/><stop offset="1" stop-color="#172b42"/></linearGradient></defs><path fill="url(#g)" d="M0 0h256v256H0z"/><path d="M-40 190 110 50 300 175M-20 220 150 90 280 200" fill="none" stroke="#e2b882" stroke-width="2"/><circle cx="170" cy="75" r="23" fill="#e4c89e"/></svg>')
const lines: LyricLine[] = [
  { text: '风把晚霞 折成一页信', start: 1200, end: 5600, words: [
    { text: '风把', start: 1200, end: 1900 }, { text: '晚霞 ', start: 1900, end: 3000 },
    { text: '折成', start: 3000, end: 3800 }, { text: '一页信', start: 3800, end: 5600 },
  ] },
  { text: '你听见 光落下的声音', start: 5600, end: 9600, words: [] },
  { text: 'Stay with the light 等回声慢慢落下', start: 9600, end: 14200, words: [] },
]
let state = { time: 3250, playing: false, cover: artwork, settings: {
  ...structuredClone(defaults), enabled: true, effect: 'tidal_knot', sceneMode: 'immersive', opacity: 74, quality: 'eco',
  music: { ...defaults.music, fieldPalette: 'iris' }, color: '#d4c3ff', followCover: false,
  bounds: { x: 0, y: 0, width: 1, height: 1 },
  desktopCard: { enabled: true, variant: 'floating', bounds: { x: .05, y: .08, width: .30, height: .23 } },
  lyrics: { ...defaults.lyrics, enabled: true, motion: 'depth', fontSize: 36, backgroundOpacity: 0, bounds: { x: .10, y: .53, width: .80, height: .38 } },
} as SpectrumSettings }
function Scene() {
  const settings = state.settings
  const bands = useRef(new Float32Array(96).fill(.16)), receivedAt = useRef(performance.now())
  const info = { ...emptyNowPlaying, title: '微光来信', artist: '夜色唱片', album: '晚霞与回声', cover: state.cover,
    position: state.time / 1000, duration: 100, updated: Date.now(), timelineAvailable: true, playing: state.playing }
  const colors = useCoverColors(settings, info, true)
  return <SceneFocusProvider><main style={{ position: 'relative', width: '100vw', height: '100vh' }}>
    <div style={{ position: 'absolute', inset: 0 }}><SpectrumCanvas settings={colors.settings} bands={bands} receivedAt={receivedAt} demo active desktop={false} /></div>
    <CardLayer settings={settings.desktopCard} info={info} color={colors.cardColor} bands={bands} receivedAt={receivedAt} active demo
      previewSize={{ width: innerWidth * settings.desktopCard.bounds.width, height: innerHeight * settings.desktopCard.bounds.height, scale: 1 }} />
    <LyricLayer settings={settings.lyrics} appearance={colors.settings} cardAccent={settings.desktopCard.accentColor} info={info}
      document={{ key: trackKey(info), status: 'ready', message: '', file: null, lines }} desktop />
  </main></SceneFocusProvider>
}
function render() { root.render(<StrictMode><Scene /></StrictMode>) }
;(window as any).musicScene = { set(patch: Partial<typeof state>) { state = { ...state, ...patch }; render() }, settings: () => state.settings }
render()
