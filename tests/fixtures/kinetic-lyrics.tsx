import React from 'react'
import { createRoot } from 'react-dom/client'
import { KineticLyrics } from '../../src/features/lyrics/kinetic-lyrics'
import { activeLine, demoLyrics, type LyricLine } from '../../src/features/lyrics/model'
import type { CompositionMode } from '../../src/features/lyrics/kinetic-composition'
import '../../src/features/lyrics/lyrics.css'

document.body.style.cssText = 'margin:0;background:#111b24;overflow:hidden'
const host = document.createElement('div'); host.style.cssText = 'position:absolute;inset:8% 6%;background:radial-gradient(ellipse at 60% 45%,#25323955,transparent 70%)'
document.body.append(host)
const root = createRoot(host)
let state = { time: 2600, mode: 'depth' as CompositionMode, reduced: false, lines: demoLyrics, fontSize: 72, backgroundOpacity: 30, live: false, playing: true, desktop: false }
function render() {
  const snapshot = state, started = performance.now()
  const readTime = snapshot.live ? () => snapshot.time + (snapshot.playing ? performance.now() - started : 0) : undefined
  root.render(<KineticLyrics lines={state.lines} index={activeLine(state.lines, state.time)} time={state.time} mode={state.mode} reduced={state.reduced} fontSize={state.fontSize} regionWidth={.88} backgroundOpacity={state.backgroundOpacity} readTime={readTime} playing={state.playing} desktop={state.desktop} />)
}
;(window as unknown as { lyricProbe: { set: (patch: Partial<typeof state>) => void; lines: LyricLine[] } }).lyricProbe = {
  set(patch) { state = { ...state, ...patch }; render() }, lines: demoLyrics,
}
render()
