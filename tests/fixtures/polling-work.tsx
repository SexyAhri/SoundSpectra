import { Profiler } from 'react'
import { createRoot } from 'react-dom/client'
import { useBackground } from '../../src/features/preview/use-background'
import { useNowPlaying, emptyNowPlaying } from '../../src/features/desktop-card/use-now-playing'
import { useLyrics } from '../../src/features/lyrics/use-lyrics'
import { defaultLyrics } from '../../src/features/spectrum/model'
import { demoLyrics, trackKey } from '../../src/features/lyrics/model'

const info = { ...emptyNowPlaying, title: 'Polling probe', artist: 'Test' }
const lyricSettings = { ...defaultLyrics, enabled: true }
const probe = {
  commits: { background: 0, media: 0, lyrics: 0 },
  calls: { background: 0, media: 0, lyrics: 0 },
  failures: { background: false, media: false, lyrics: false },
  media: structuredClone(emptyNowPlaying),
  lyrics: { key: trackKey(info), status: 'ready', message: '', file: 'probe.lrc', lines: demoLyrics },
  background: {
    screen: { x: 0, y: 0, width: 1920, height: 1080 },
    virtualScreen: { x: 0, y: 0, width: 1920, height: 1080 },
    position: 'fill', color: '#123456', revision: 'initial', image: null, issue: null,
  },
  refresh: (_quiet = true) => Promise.resolve(),
}
Object.assign(window, { pollingWork: probe })
function BackgroundProbe() {
  const value = useBackground()
  probe.refresh = value.refresh
  return <output data-testid="background">{JSON.stringify({ desktop: value.desktop, loading: value.loading, error: value.error, image: value.systemImage })}</output>
}
function MediaProbe() {
  return <output data-testid="media">{JSON.stringify(useNowPlaying())}</output>
}
function LyricsProbe() {
  return <output data-testid="lyrics">{JSON.stringify(useLyrics(lyricSettings, info))}</output>
}
for (const [name, Component] of [['background', BackgroundProbe], ['media', MediaProbe], ['lyrics', LyricsProbe]] as const) {
  const host = document.createElement('div')
  document.body.append(host)
  createRoot(host).render(<Profiler id={name} onRender={() => probe.commits[name]++}><Component /></Profiler>)
}
