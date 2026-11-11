import { Profiler } from 'react'
import { createRoot } from 'react-dom/client'
import { LyricLayer } from '../../src/features/lyrics/lyric-layer'
import { demoLyrics, trackKey } from '../../src/features/lyrics/model'
import { browserStatus, defaultLyrics, defaults, type LyricSettings } from '../../src/features/spectrum/model'
import { emptyNowPlaying, type NowPlaying } from '../../src/features/desktop-card/use-now-playing'
import { useSettings } from '../../src/features/settings/use-settings'
import { SceneInspector } from '../../src/features/settings/scene-inspector'
import type { ComponentProps } from 'react'

const probe = {
  lyricCommits: 0, statusCommits: 0, polls: 0, inspectorRenders: 0,
  status: structuredClone(browserStatus), issue: '',
  set(patch: Partial<NowPlaying>) {
    info = { ...info, ...patch, updated: Date.now() }
    renderLyrics()
  },
  settings(patch: Partial<LyricSettings>) {
    settings = { ...settings, ...patch }
    renderLyrics()
  },
  demo(value: boolean) {
    demo = value
    renderLyrics()
  },
  inspect(patch: Partial<ComponentProps<typeof SceneInspector>>) {
    inspectorProps = { ...inspectorProps, ...patch }
    renderInspector()
  },
}
Object.assign(window, { renderUpdates: probe })
document.body.style.cssText = 'margin:0;background:#111b24'
const lyricsHost = document.createElement('div')
lyricsHost.style.cssText = 'position:absolute;inset:8% 6%'
const statusHost = document.createElement('div')
document.body.append(lyricsHost, statusHost)
const lyricsRoot = createRoot(lyricsHost)
let info: NowPlaying = { ...emptyNowPlaying, title: 'Render probe', artist: 'Test', position: 1, duration: 100, playing: true, updated: Date.now(), timelineAvailable: true }
const lyricDocument = { key: trackKey(info), status: 'ready', message: '', file: null, lines: demoLyrics }
let settings: LyricSettings = { ...defaultLyrics, enabled: true, motion: 'depth' }
let demo = false
function renderLyrics() {
  lyricsRoot.render(<Profiler id="lyrics" onRender={() => probe.lyricCommits++}>
    <LyricLayer settings={settings} document={lyricDocument} info={info} demo={demo} />
  </Profiler>)
}
function StatusProbe() {
  const { status, loaded } = useSettings()
  return <output data-testid="status" data-loaded={loaded}>{JSON.stringify(status)}</output>
}
createRoot(statusHost).render(<Profiler id="status" onRender={() => probe.statusCommits++}><StatusProbe /></Profiler>)
renderLyrics()

const noop = () => {}
const inspectorHost = document.createElement('div')
inspectorHost.style.cssText = 'position:absolute;top:100vh;width:340px'
document.body.append(inspectorHost)
const inspectorRoot = createRoot(inspectorHost)
let inspectorProps: ComponentProps<typeof SceneInspector> = {
  lyricDocument, nowPlaying: info, sceneSettings: defaults, settings: defaults,
  selected: 'primary', onSelect: noop, disabled: false, editing: false,
  updateScene: noop, update: noop, tab: 'effect', onTabChange: noop,
  lyricTab: 'effect', onLyricTabChange: noop, panel: 'wallpaper',
  rail: {} as ComponentProps<typeof SceneInspector>['rail'],
  selectedRail: null, selectedRailItem: null, railSelectionRevision: 0, onSelectRail: noop,
}
function renderInspector() { inspectorRoot.render(<SceneInspector {...inspectorProps} />) }
renderInspector()
