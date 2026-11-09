import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MusicCard } from '../music-card'
import { defaults, normalizeSettings, type DesktopCardSettings } from '../../spectrum/model'
import { emptyNowPlaying } from '../use-now-playing'
import { CompositionStudy } from '../../spectrum/three/compositions/study-session'
import { compositions, type CompositionId } from '../../spectrum/three/compositions/presets'
import './floating-study.css'
import { CardColorControls } from '../card-color-controls'
import { useCoverColors } from '../use-cover-colors'
import { effectPalettes } from '../../spectrum/effect-palette'

const paperStudy = location.pathname.endsWith('/afternoon-card.html')
const requestedCard = new URLSearchParams(location.search).get('card')
const initialCard = requestedCard === 'record' || requestedCard === 'compact' || requestedCard === 'afternoon' || requestedCard === 'floating' ? requestedCard : paperStudy ? 'afternoon' : 'floating'
const studyNames = { record: '唱片', compact: '简约', afternoon: '午后 · 藏书票', floating: '浮签' }

// Original sample albums; missing covers use the production artwork collection.
function sleeve(warm: boolean) {
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><defs><linearGradient id="sky" x2=".2" y2="1"><stop stop-color="${warm ? '#c28466' : '#74969b'}"/><stop offset="1" stop-color="${warm ? '#e9c69a' : '#d8e0cd'}"/></linearGradient><linearGradient id="sea" x2=".7" y2="1"><stop stop-color="${warm ? '#714d58' : '#315964'}"/><stop offset="1" stop-color="#122c38"/></linearGradient></defs><rect width="600" height="600" fill="url(#sky)"/><circle cx="418" cy="203" r="79" fill="#fff1ce" opacity=".88"/><path d="M0 317 Q140 268 300 335 T600 291 V600H0" fill="url(#sea)"/><path d="M0 418 Q150 294 300 406 T600 360V600H0" fill="${warm ? '#ac796c' : '#7f9d9a'}"/><path d="M0 453 Q190 359 356 467 T600 422V600H0" fill="${warm ? '#d6b49a' : '#cbd3bc'}"/><path d="M0 476 Q160 388 339 487 T600 455" fill="none" stroke="#f1e8ca" stroke-width="3" opacity=".8"/><text x="42" y="64" fill="#fff9e9" font-family="Georgia,serif" font-size="19" letter-spacing="5">FIELD NOTES</text><text x="42" y="111" fill="#fff9e9" font-family="Georgia,serif" font-size="36" letter-spacing="3">${warm ? 'AFTERGLOW' : 'COASTLINES'}</text><text x="42" y="555" fill="#293e42" font-family="sans-serif" font-size="12" letter-spacing="4">SOUNDSPECTRA / ORIGINAL STUDY</text></svg>`)
}
const tracks = [
  { title: '沿着海岸慢慢走', artist: '林间来信 / Field Notes', album: '海风手记', cover: sleeve(false), accent: '#b5dacb', duration: 236 },
  { title: '把晚霞折成一封信', artist: '暮色来信 / Evening Letters', album: '日落以后', cover: sleeve(true), accent: '#e7bd9e', duration: 208 },
  { title: '没有封面的这一首', artist: '仍然有音乐，仍然有光', album: '', cover: null, accent: '#afc9dc', duration: 184 },
]

function FloatingStudy() {
  const [variant, setVariant] = useState<DesktopCardSettings['variant']>(initialCard)
  const [designSettings, setDesignSettings] = useState(() => structuredClone(defaults))
  const studyName = studyNames[variant]
  const paper = variant === 'afternoon'
  const canvas = useRef<HTMLCanvasElement>(null)
  const study = useRef<CompositionStudy | null>(null)
  const bands = useRef(new Float32Array(96)), receivedAt = useRef(0)
  const [scene, setScene] = useState<CompositionId>('sculpture')
  const [index, setIndex] = useState(0), [playing, setPlaying] = useState(true)
  const [light, setLight] = useState(paperStudy), [quiet, setQuiet] = useState(false)
  const [reduced, setReduced] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [standby, setStandby] = useState(false)
  const [size, setSize] = useState<'normal' | 'small'>('normal')
  const [snapshot, setSnapshot] = useState({ position: 72, updated: Date.now() })
  const [error, setError] = useState('')
  const position = useRef(72)
  const input = useRef({ playing, quiet, reduced })
  input.current = { playing, quiet, reduced }
  const track = tracks[index]
  useEffect(() => {
    const session = new CompositionStudy(canvas.current!, 'sculpture')
    study.current = session
    session.settings.sceneMode = 'daily'
    let raf = 0, last = 0, disposed = false, resizing = false
    const resize = async () => {
      if (resizing || disposed) return
      resizing = true
      try { await session.resize() } catch (reason) { if (!disposed) setError(String(reason)) }
      finally { resizing = false }
    }
    const observer = new ResizeObserver(() => { void resize() })
    observer.observe(canvas.current!)
    function tick(now: number) {
      const dt = last ? Math.min(.05, (now - last) / 1000) : 1 / 60
      last = now
      const state = input.current
      if (!document.hidden) {
        session.reduced = state.reduced || !state.playing
        session.level = state.quiet || !state.playing ? 'quiet' : 'normal'
        session.step(dt)
        receivedAt.current = now
        const spectrum = session.motion.frame?.spectrum
        for (let i = 0; i < 96; i++) bands.current[i] = state.quiet || !state.playing || !spectrum?.length ? 0 : spectrum[Math.floor(i / 96 * spectrum.length)]
        if (session.errors.length) setError(session.errors.join('\n'))
      }
      raf = requestAnimationFrame(tick)
    }
    void resize().then(() => { if (!disposed) raf = requestAnimationFrame(tick) })
    return () => { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); session.dispose(); study.current = null }
  }, [])
  useEffect(() => {
    const session = study.current
    if (session && session.id !== scene) { session.select(scene); void session.resize() }
    if (session) session.settings.music.fieldPalette = designSettings.music.fieldPalette
  }, [scene, designSettings.music.fieldPalette])
  useEffect(() => {
    let previous = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      if (playing && !document.hidden) position.current = Math.min(track.duration, position.current + (now - previous) / 1000)
      previous = now
      setSnapshot({ position: position.current, updated: Date.now() })
    }, 500)
    setSnapshot({ position: position.current, updated: Date.now() })
    return () => clearInterval(timer)
  }, [playing, track])
  function selectTrack(next: number) { position.current = 0; setSnapshot({ position: 0, updated: Date.now() }); setIndex(next) }
  const info = standby ? emptyNowPlaying : { ...emptyNowPlaying, ...track, ...snapshot, playing, timelineAvailable: true, playbackAvailable: true, trackId: `floating-study:${index}`, source: '原创曲目示例' }
  const sceneSettings = { ...designSettings, effect: compositions[scene].effect }
  const colors = useCoverColors(sceneSettings, info, true)
  useEffect(() => {
    if (study.current) study.current.settings.color = colors.settings.color
  }, [colors.settings.color])
  const introductions = { record: '唱片 · 半露黑胶，外圈进度，一枚安静的歌名标签。', compact: '简约 · 磨砂胶囊，圆形封面，把空间留给歌名。', afternoon: '午后 · 复古印刷、双联票根，把听歌变成收藏。', floating: '浮签 · 双层透光亚克力，用一枚金属夹留住旋律。' }
  return <main className="floating-study">
    <header><div><p className="study-eyebrow">SOUNDSPECTRA / MUSIC OBJECTS</p><h1>{paper ? '把喜欢的歌，留在一张票根里。' : '为音乐，留一个位置。'}</h1><p className="study-intro">{introductions[variant]}</p></div><span className="study-edition">MUSIC CARD<br /><b>{studyName}</b></span></header>
    <div className="study-card-options" role="group" aria-label="预览卡片样式">{Object.entries(studyNames).map(([id, name]) => <button key={id} aria-pressed={variant === id} onClick={() => setVariant(id as typeof variant)}>{name}</button>)}</div>
    <nav aria-label="搭配三维场景">{Object.entries(compositions).map(([id, value]) => <button key={id} aria-pressed={scene === id} onClick={() => setScene(id as CompositionId)}>{value.title}<span>{value.family}</span></button>)}</nav>
    <section className={`floating-stage ${light ? 'is-light' : ''}`} aria-label={`${studyName}与三维场景连续预览`}>
      <canvas ref={canvas} />
      <div className="stage-topline"><span>DESKTOP COMPOSITION <i /> {compositions[scene].title}</span><span>{studyName} / {light ? '浅色' : '深色'}桌面</span></div>
      <div className={`floating-sample floating-sample-${size}`}><MusicCard info={info} settings={{ ...designSettings.desktopCard, variant, enabled: true }} color={colors.cardColor} bands={bands} receivedAt={receivedAt} /></div>
      <div className="stage-bottomline"><span>{paper ? '纸上有音乐，桌面有余光。' : '封面留在这里，旋律流向远处。'}</span><span>合成输入 · 无声演示</span></div>
    </section>
    <div className="study-toolbar"><div><button onClick={() => setPlaying(!playing)}>{playing ? '暂停示例' : '继续示例'}</button><button onClick={() => selectTrack((index + 1) % tracks.length)}>切换示例曲目</button></div><div><label><input type="checkbox" checked={standby} onChange={e => setStandby(e.target.checked)} />待机状态</label><label><input type="checkbox" checked={light} onChange={e => setLight(e.target.checked)} />浅色壁纸</label><label><input type="checkbox" checked={quiet} onChange={e => setQuiet(e.target.checked)} />静音输入</label><label><input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)} />减少动态</label><label><input type="checkbox" checked={size === 'small'} onChange={e => setSize(e.target.checked ? 'small' : 'normal')} />小尺寸</label></div></div>
    <section className="study-palette" aria-label="卡片配色验证"><CardColorControls settings={sceneSettings} disabled={false} update={patch => setDesignSettings(current => normalizeSettings({ ...current, ...patch }))} /><label>场景色板<select aria-label="预览场景色板" value={designSettings.music.fieldPalette} onChange={event => setDesignSettings(current => ({ ...current, music: { ...current.music, fieldPalette: event.target.value as typeof current.music.fieldPalette } }))}>{Object.entries(effectPalettes[compositions[scene].effect]).map(([id, value]) => <option key={id} value={id}>{value.name}</option>)}</select></label><label><input type="checkbox" checked={designSettings.followCover} onChange={event => setDesignSettings(current => ({ ...current, followCover: event.target.checked }))} />跟随封面配色</label></section>
    <footer><p><b>{paper ? '一张音乐票根' : '与空间共处'}</b>{introductions[variant]}</p><p><b>沿用真实组件</b>此处与软件使用同一款卡片、配色控件和三维渲染器。歌曲、封面与音频特征为原创合成示例，不采集或控制本机播放器；卡片内的播放按钮在浏览器中不可用。</p></footer>
    {error && <pre role="alert">{error}</pre>}
  </main>
}
createRoot(document.getElementById('root')!).render(<FloatingStudy />)
