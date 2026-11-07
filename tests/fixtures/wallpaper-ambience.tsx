import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { defaultWallpaperDepth, type SceneMask } from '../../src/features/spectrum/model'
import { silentAnalysis } from '../../src/features/spectrum/music-analysis'
import type { AnalysisSnapshot } from '../../src/features/spectrum/spectrum-canvas'
import { WallpaperSurface } from '../../src/features/wallpaper-depth/wallpaper-surface'

function Fixture() {
  const params = new URLSearchParams(location.search)
  const strength = Number(params.get('strength') ?? 100), rms = Number(params.get('rms') ?? .2)
  const stream = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  useEffect(() => () => clearInterval(stream.current), [])
  const analysis = useRef<AnalysisSnapshot>({ ...silentAnalysis(), rms: .2, receivedAt: performance.now() })
  const [active, setActive] = useState(true), [masked, setMasked] = useState(false)
  const masks: SceneMask[] = masked ? [{ id: 'subject', bounds: { x: .4, y: .1, width: .2, height: .7 }, feather: .02 }] : []
  const refresh = () => { analysis.current = { ...analysis.current, rms, receivedAt: performance.now() } }
  const play = () => { clearInterval(stream.current); refresh(); stream.current = setInterval(refresh, 40) }
  const pause = () => { clearInterval(stream.current); analysis.current = { ...analysis.current, rms: 0, receivedAt: performance.now() } }
  return <>
    <button onClick={refresh}>Audio</button><button onClick={play}>Play</button><button onClick={pause}>Pause</button>
    <button onClick={() => setMasked(value => !value)}>Mask</button><button onClick={() => setActive(value => !value)}>Active</button>
    <div style={{ position: 'relative', width: 800, height: 450, background: params.get('tone') === 'light' ? '#edeae3' : '#17252c' }}>
      <WallpaperSurface settings={{ ...defaultWallpaperDepth, ambientEnabled: true, ambientAmount: strength, ambientBounds: { x: .05, y: .05, width: .9, height: .9 } }} masks={masks} analysis={analysis} active={active} image={null} background={null} screen={{ x: 0, y: 0, width: 800, height: 450 }} />
    </div>
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
