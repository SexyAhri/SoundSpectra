import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CardControlWindow } from '../../src/features/desktop-card/card-control-window'
import { defaults } from '../../src/features/spectrum/model'
import { emptyNowPlaying } from '../../src/features/desktop-card/use-now-playing'
import '../../src/index.css'

const probe = {
  settings: { ...structuredClone(defaults), enabled: true, desktopCard: { ...defaults.desktopCard, enabled: true, variant: 'floating' } },
  info: { ...emptyNowPlaying, title: '一笑江湖 (DJ弹鼓版)', artist: '闻人听書_', playing: true, source: 'QQ 音乐', updated: Date.now(), trackId: 'track', sessionId: 'player', controls: { previous: true, next: true, play: true, pause: true } },
  regions: [] as { x: number; y: number; width: number; height: number }[],
  publications: 0,
  settingsChanged: (_value: unknown) => {},
}
Object.assign(window, { cardWindowProbe: probe })
createRoot(document.getElementById('root')!).render(<StrictMode><CardControlWindow /></StrictMode>)
