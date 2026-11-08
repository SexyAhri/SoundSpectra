import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { LyricLayer } from '../../src/features/lyrics/lyric-layer'
import { emptyNowPlaying } from '../../src/features/desktop-card/use-now-playing'
import { trackKey } from '../../src/features/lyrics/model'
import { SceneFocusProvider, useSceneFocus, type SceneFocus } from '../../src/features/spectrum/scene-focus'
import { FiberSceneRenderer } from '../../src/features/spectrum/three/r3f/fiber-renderer'
import { SceneMotion } from '../../src/features/spectrum/three/motion'
import { demoAnalysis } from '../../src/features/spectrum/music-analysis'
import { studySettings } from '../../src/features/spectrum/visual-study'
import { defaults, type LyricSettings, type SpectrumEffect } from '../../src/features/spectrum/model'
import '../../src/features/lyrics/lyrics.css'

export async function mountLyricCompositeProbe(effect: SpectrumEffect) {
  const host = document.createElement('main')
  host.style.cssText = 'position:relative;width:800px;height:450px;background:#639498'
  document.body.append(host)
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;width:800px;height:450px'
  host.append(canvas)
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:absolute;inset:0'
  host.append(overlay)
  const root = createRoot(overlay), world = new FiberSceneRenderer(canvas), motion = new SceneMotion()
  const config = { ...studySettings(effect, 'immersive'), quality: 'eco' as const }
  const info = { ...emptyNowPlaying, title: 'Transparency fixture', position: 3, duration: 60, updated: Date.now(), timelineAvailable: true, playing: false }
  const lyricDocument = { key: trackKey(info), status: 'ready', message: '', file: null, lines: [{ text: 'I climb and I crawl and', start: 0, end: 60000, words: [] }] }
  let settings: LyricSettings = { ...defaults.lyrics, enabled: false, motion: 'folded', fontStyle: 'poetry', fontSize: 18, backgroundOpacity: 0, bounds: { x: .06, y: .75, width: .88, height: .13 } }
  let focus: { current: SceneFocus } | null = null
  function ReadFocus() { focus = useSceneFocus(); return null }
  await world.resize(config, 1)
  for (let i = 0; i < 90; i++) {
    motion.step(demoAnalysis(i / 30), 1 / 30, config.music, true)
    world.draw(motion, config, true)
  }
  const draw = () => world.draw(motion, config, true, 0, focus?.current)
  const set = (patch: Partial<LyricSettings>) => {
    settings = { ...settings, ...patch }
    flushSync(() => root.render(<SceneFocusProvider><ReadFocus /><LyricLayer settings={settings} appearance={config} info={info} document={lyricDocument} desktop /></SceneFocusProvider>))
    draw()
  }
  set({})
  const read = () => {
    const gl = world.renderer.getContext(), pixels = new Uint8Array(canvas.width * canvas.height * 4)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    return pixels
  }
  return { set, read, focus: () => focus?.current, dispose() { flushSync(() => root.unmount()); world.dispose(); world.renderer.forceContextLoss(); host.remove() } }
}
