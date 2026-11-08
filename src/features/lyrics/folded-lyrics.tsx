import { useLayoutEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { AdditiveBlending, CanvasTexture, Color, DoubleSide, Group, LinearFilter, Mesh, PerspectiveCamera, PlaneGeometry, ShaderMaterial, Vector3 } from 'three'
import { activeLine, type LyricLine } from './model'
import { timedGlyphs, type TimedGlyph } from './lyric-glyphs'
import type { LyricPalette } from './lyric-palette'
import { foldedChoreography } from './folded-choreography'
import { foldedLayout, type FoldedLayout } from './folded-layout'
import { createFoldedStage } from './folded-stage'
import { lyricFont, lyricWeight, measureLyricGlyphs, type LyricFontStyle } from './lyric-typography'
import { useLyricFont } from './use-lyric-font'
import { quietLyricAudio, type LyricAudio } from './lyric-audio'

export interface FoldedLyricsProps {
  lines: LyricLine[]; time: number; readTime?: () => number; playing: boolean; desktop: boolean;
  fontSize: number; fontStyle?: LyricFontStyle; regionWidth?: number; reduced: boolean; backgroundOpacity: number;
  palette: LyricPalette; readability: 'soft' | 'contrast'; readAudio?: () => Readonly<LyricAudio>;
}
const maxPanelGlyphs = 32
const rasterScale = 2
const clamp = (x: number) => Math.max(0, Math.min(1, x))
const words = new Intl.Segmenter(undefined, { granularity: 'word' })

function foldGroups(glyphs: TimedGlyph[]) {
  const groups: TimedGlyph[][] = []; let current: TimedGlyph[] = [], cursor = 0
  for (const word of words.segment(glyphs.map(g => g.text).join(''))) {
    let length = 0; const part: TimedGlyph[] = []
    while (cursor < glyphs.length && length < word.segment.length) {
      const glyph = glyphs[cursor++]; part.push(glyph); length += glyph.text.length
    }
    if (current.length + part.length > 5) { if (current.length) groups.push(current); current = [] }
    while (part.length > maxPanelGlyphs) groups.push(part.splice(0, maxPanelGlyphs))
    current.push(...part)
    if (current.length >= 2) { groups.push(current); current = [] }
  }
  if (current.length) groups.push(current)
  return groups
}

// Static masks only. Folding and highlighting are entirely GPU driven.
function panel(glyphs: TimedGlyph[], palette: LyricPalette, contrast: boolean, style: LyricFontStyle, weight: number) {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!
  const metrics = measureLyricGlyphs(context, glyphs, 96, style, 'folded', weight)
  const texts = glyphs.map(g => g.hidden ? ' ' : g.text)
  const widths = metrics.map(metric => metric.advance)
  const width = widths.reduce((a, b) => a + b, 0)
  const maskWidth = Math.ceil(width) + 24
  canvas.width = maskWidth * rasterScale; canvas.height = 144 * rasterScale
  context.scale(rasterScale, rasterScale)
  context.fillStyle = '#fff'; context.textBaseline = 'middle'
  let x = 12
  const spans = widths.map((w, i) => {
    const metric = metrics[i]
    context.font = lyricFont(96 * metric.scale, style, weight)
    context.globalAlpha = metric.opacity
    context.fillText(texts[i], x + metric.leading, 72 + metric.baseline)
    const span = new Vector3(x / maskWidth, (x + w) / maskWidth, 0)
    x += w; return span
  })
  while (spans.length < maxPanelGlyphs) spans.push(new Vector3(2, 2, 0))
  const texture = new CanvasTexture(canvas)
  texture.minFilter = LinearFilter; texture.generateMipmaps = false
  const material = new ShaderMaterial({ transparent: true, depthWrite: false, side: DoubleSide, uniforms: {
    mask: { value: texture }, spans: { value: spans }, opacity: { value: 1 },
    sung: { value: new Color(palette.sung) }, unsung: { value: new Color(palette.unsung) },
    cyan: { value: new Color(palette.prism[0]) }, violet: { value: new Color(palette.prism[1]) },
    shadow: { value: new Color(palette.shadow) }, outline: { value: contrast ? 1 : 0 },
    texel: { value: [1.1 * rasterScale / canvas.width, 1.1 * rasterScale / canvas.height] }, pixelRatio: { value: 1 }, light: { value: 1 },
    clock: { value: 0 }, flare: { value: 0 },
    beam: { value: new Vector3(0, 1, -1) },
  }, vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: `
    uniform sampler2D mask; uniform vec3 spans[32]; uniform vec3 sung; uniform vec3 unsung;
    uniform vec3 beam;
    uniform vec3 shadow; uniform vec3 cyan; uniform vec3 violet;
    uniform float outline; uniform vec2 texel; uniform float pixelRatio; uniform float opacity; uniform float light;
    uniform float clock; uniform float flare; varying vec2 vUv;
    void main(){float a=texture2D(mask,vUv).a; float edge=a;
      // Contrast needs a visible screen-space rim even at the smallest font.
      vec2 stepUv=outline>.5 ? max(texel,fwidth(vUv)*pixelRatio*1.25) : texel;
      edge=max(edge,texture2D(mask,vUv+vec2(stepUv.x,0.)).a);
      edge=max(edge,texture2D(mask,vUv-vec2(stepUv.x,0.)).a);
      edge=max(edge,texture2D(mask,vUv+vec2(0.,stepUv.y)).a);
      edge=max(edge,texture2D(mask,vUv-vec2(0.,stepUv.y)).a);
      float alpha=max(a,edge*outline); if(alpha<.01)discard; float lit=0.;
      for(int i=0;i<32;i++){vec3 s=spans[i]; if(vUv.x>=s.x && vUv.x<=s.y)lit=max(lit,s.z);}
      float iridescence=.5+.5*sin(vUv.x*5.+vUv.y*3.-clock*.8);
      vec3 warm=vec3(1.,.94,.83);
      vec3 ink=mix(mix(unsung,warm,.48),mix(sung,warm,.70),lit)*light;
      float wordX=(vUv.x-beam.x)/max(.001,beam.y-beam.x);
      float glint=beam.z<0.?0.:exp(-pow((wordX-beam.z)*9.,2.))*step(0.,wordX)*step(wordX,1.);
      ink=mix(ink,mix(cyan,violet,iridescence),glint*.48);
      ink+=warm*(glint*.10+flare*.06)*lit;
      gl_FragColor=vec4(mix(shadow,ink,a/max(alpha,.001)),alpha*opacity);
      #include <colorspace_fragment>
    }` })
  const geometry = new PlaneGeometry(maskWidth / 96, 1.5)
  geometry.translate(width / 192, 0, 0)
  const mesh = new Group(), ink = new Mesh(geometry, material)
  ink.frustumCulled = false; ink.renderOrder = 3; mesh.add(ink)
  const foilGeometry = new PlaneGeometry(width / 96 + .18, 1.38)
  foilGeometry.translate(width / 192, 0, 0)
  const foilMaterial = new ShaderMaterial({ transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending,
    uniforms: { opacity: { value: 0 }, clock: { value: 0 }, music: { value: new Vector3() }, tint: { value: new Color(palette.accent) } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec2 vUv;uniform float opacity;uniform float clock;uniform vec3 tint;uniform vec3 music;
      void main(){vec2 p=vUv;float cut=step(.07,p.x+p.y)*step(p.x+p.y,1.93);
        float edge=exp(-min(p.x,1.-p.x)*180.)*.4+exp(-min(p.y,1.-p.y)*100.)*.18;
        float fold=exp(-abs(p.x-.02)*90.);float scan=exp(-abs(p.x-fract(clock*.24))*(45.-music.y*12.));
        float a=(.018+edge*(.6+music.z*.9)+fold*(.25+music.x*.4)+scan*(.07+music.y*.32))*cut*opacity;
        gl_FragColor=vec4(mix(tint,vec3(.55,1.,.91),p.y),a);
        #include <colorspace_fragment>
      }` })
  const foil = new Mesh(foilGeometry, foilMaterial)
  foil.position.z = -.045; foil.frustumCulled = false; foil.renderOrder = 0; mesh.add(foil)
  const cue = Math.min(...glyphs.filter(g => g.text.trim() && !g.hidden).map(g => g.start))
  const cues = [...new Set(glyphs.filter(g => g.text.trim() && !g.hidden).map(g => g.start))]
  return { mesh, width: width / 96, spans, glyphs, material, foil, cue, cues,
    dispose() { texture.dispose(); geometry.dispose(); material.dispose(); foilGeometry.dispose(); foilMaterial.dispose() } }
}

function makeLine(line: LyricLine, next: LyricLine | undefined, previous: LyricLine | undefined, palette: LyricPalette, contrast: boolean, style: LyricFontStyle, weight: number, deferred = false) {
  const glyphs = timedGlyphs(line), panels: ReturnType<typeof panel>[] = []
  // Keep whole English words on one hinge; timing remains at source-word granularity.
  const groups = foldGroups(glyphs), group = new Group()
  const prepare = () => {
    if (panels.length < groups.length) {
      const item = panel(groups[panels.length], palette, contrast, style, weight)
      panels.push(item); group.add(item.mesh)
    }
    return panels.length === groups.length
  }
  if (!deferred) while (!prepare()) { /* Current/seek target must be complete before display. */ }
  const choreography = foldedChoreography(line.start, Math.min(line.end, next?.start ?? Infinity), next?.start, previous?.start, previous?.end)
  return { group, panels, choreography, line, prepare, get complete() { return panels.length === groups.length }, layout: undefined as FoldedLayout | undefined, layoutKey: '',
    dispose() { group.removeFromParent(); panels.forEach(p => p.dispose()); choreography.dispose() } }
}

function Scene(props: FoldedLyricsProps) {
  const latest = useRef(props); latest.current = props
  const { scene, invalidate, size, gl, camera } = useThree()
  const style = props.fontStyle ?? 'modern'
  const weight = lyricWeight(style, Math.min(props.fontSize * size.width / (1920 * (props.regionWidth ?? .88)) * 2.35, size.height * .26), 'folded')
  const cache = useRef(new Map<number, ReturnType<typeof makeLine>>())
  const prewarm = useRef<{ index: number; object: ReturnType<typeof makeLine>; timer: number } | undefined>(undefined)
  const cancelPrewarm = () => {
    const job = prewarm.current
    if (job) { clearTimeout(job.timer); job.object.dispose(); prewarm.current = undefined }
  }
  const prepareNext = (index: number) => {
    if (prewarm.current?.index === index) return
    cancelPrewarm()
    const p = latest.current
    const object = makeLine(p.lines[index], p.lines[index + 1], p.lines[index - 1], p.palette, p.readability === 'contrast', style, weight, true)
    const job = { index, object, timer: 0 }; prewarm.current = job
    const step = () => {
      if (prewarm.current !== job) return
      if (document.hidden && !latest.current.desktop) { cancelPrewarm(); return }
      // One small phrase texture per task, away from the visible frame's handoff.
      if (!object.prepare()) { job.timer = window.setTimeout(step, 12); return }
      cache.current.set(index, object); object.group.visible = false; scene.add(object.group)
      prewarm.current = undefined
    }
    job.timer = window.setTimeout(step, 12)
  }
  const stage = useRef<ReturnType<typeof createFoldedStage> | undefined>(undefined)
  useLayoutEffect(() => {
    const decoration = createFoldedStage(props.palette); scene.add(decoration.mesh); stage.current = decoration; invalidate()
    return () => { decoration.dispose(); stage.current = undefined }
  }, [scene, invalidate])
  useLayoutEffect(() => {
    const objects = cache.current
    invalidate()
    return () => { cancelPrewarm(); objects.forEach(o => o.dispose()); objects.clear() }
  }, [props.lines, props.readability, style, weight, scene, invalidate])
  useLayoutEffect(() => {
    cancelPrewarm()
    stage.current?.setPalette(props.palette)
    cache.current.forEach(object => object.panels.forEach(item => {
      item.material.uniforms.sung.value.set(props.palette.sung)
      item.material.uniforms.unsung.value.set(props.palette.unsung)
      item.material.uniforms.shadow.value.set(props.palette.shadow)
      item.material.uniforms.cyan.value.set(props.palette.prism[0])
      item.material.uniforms.violet.value.set(props.palette.prism[1])
      item.foil.material.uniforms.tint.value.set(props.palette.accent)
    }))
    invalidate()
  }, [props.palette, invalidate])
  useLayoutEffect(() => { invalidate() }, [props.time, props.playing, props.reduced, props.fontSize, props.regionWidth, props.backgroundOpacity, size, invalidate])
  useLayoutEffect(() => {
    const lens = camera as PerspectiveCamera
    // At z=0 one world unit equals one CSS pixel; depth still changes apparent scale.
    lens.position.z = Math.max(size.height / (2 * Math.tan(Math.PI / 10)), size.width * .95)
    lens.fov = Math.atan(size.height / (2 * lens.position.z)) * 360 / Math.PI
    lens.far = lens.position.z + 8000; lens.updateProjectionMatrix(); invalidate()
  }, [camera, size, invalidate])
  useLayoutEffect(() => {
    const wake = () => { if (!document.hidden || latest.current.desktop) invalidate() }
    document.addEventListener('visibilitychange', wake)
    return () => document.removeEventListener('visibilitychange', wake)
  }, [invalidate])
  useFrame(() => {
    const p = latest.current
    if (document.hidden && !p.desktop) return
    const time = p.readTime?.() ?? p.time, index = activeLine(p.lines, time)
    const audio = p.playing && !p.reduced ? p.readAudio?.() ?? quietLyricAudio : quietLyricAudio
    const wanted = new Set([index - 1, index, index + 1].filter(i => i >= 0 && i < p.lines.length))
    if (prewarm.current && !wanted.has(prewarm.current.index)) cancelPrewarm()
    cache.current.forEach((o, i) => { if (!wanted.has(i)) { o.dispose(); cache.current.delete(i) } })
    wanted.forEach(i => {
      if (!cache.current.has(i)) {
        // Read ahead during playback; pauses and seeks still reconstruct immediately.
        if (p.playing && i === index + 1 && p.lines[i].start - time > 900) { prepareNext(i); return }
        const job = prewarm.current?.index === i ? prewarm.current : undefined
        let o: ReturnType<typeof makeLine>
        if (job) {
          clearTimeout(job.timer); while (!job.object.prepare()) { /* Finish a demanded target. */ }
          o = job.object; prewarm.current = undefined
        } else o = makeLine(p.lines[i], p.lines[i + 1], p.lines[i - 1], p.palette, p.readability === 'contrast', style, weight)
        cache.current.set(i, o); scene.add(o.group)
      }
    })
    const visible: number[] = []
    const poses: number[][] = []
    let energy = 0
    cache.current.forEach((object, i) => {
      const { group, panels, choreography, line } = object
      const end = Math.min(line.end, p.lines[i + 1]?.start ?? Infinity)
      group.visible = time >= line.start - choreography.lead && time < end + choreography.tail
      if (!group.visible) return
      visible.push(i)
      const { enter, exit } = choreography.evaluate(time)
      const layoutKey = `${size.width}:${size.height}:${p.fontSize}:${p.regionWidth}`
      if (object.layoutKey !== layoutKey) {
        object.layout = foldedLayout(panels.map(item => item.width), size.width, size.height, p.fontSize, p.regionWidth ?? .88)
        object.layoutKey = layoutKey
      }
      const { scale, panels: positions, rows } = object.layout!
      group.scale.setScalar(scale * (1 + audio.bass * .008))
      const t = clamp((time - choreography.settleStart) / Math.max(1, line.start - choreography.settleStart))
      const settle = t * t * (3 - 2 * t)
      const distance = (camera as PerspectiveCamera).position.z
      const compact = size.height < size.width * .2
      const depth = compact ? Math.min(distance, size.height * 1.8) : distance
      const incoming = 1 - settle
      const reading = clamp((time - line.start) / Math.max(1, end - line.start))
      const variant = i % 3, direction = i % 2 ? -1 : 1
      const activity = Math.max(incoming, exit)
      energy = Math.max(energy, Math.sin(settle * Math.PI), Math.sin(exit * Math.PI))
      group.position.set(p.reduced ? 0 : incoming * -size.width * (.10 + variant * .025) * direction + exit * size.width * .16 * direction,
        p.reduced ? 0 : -incoming * size.height * .28 + exit * size.height * .36,
        p.reduced ? 0 : -incoming * depth * .65 - exit * depth * .5 + reading * depth * .025)
      const yaw = compact ? .12 : 1
      group.rotation.set(p.reduced ? 0 : incoming * -.32 + exit * .20,
        p.reduced ? 0 : (-.035 + incoming * -.58 + exit * .72) * yaw * direction,
        p.reduced ? 0 : (incoming * .13 - exit * .20) * direction * (compact ? .18 : 1))
      panels.forEach((item, n) => {
        const position = positions[n]
        // A wave of alternating hinges, rather than every phrase turning simultaneously.
        const delay = n / Math.max(1, panels.length - 1) * .28
        const local = clamp((settle - delay) / (1 - delay))
        const unfolding = 1 - local * local * (3 - 2 * local)
        const elapsed = time - item.cue
        const pulse = item.cues.reduce((peak, cue) => {
          const age = time - cue
          return Math.max(peak, age >= 0 && age < 720 ? Math.exp(-age / 210) : 0)
        }, 0)
        energy = Math.max(energy, pulse)
        const release = clamp(elapsed / 330)
        const resting = .16 * (1 - release)
        const fold = p.reduced ? 0 : Math.max(unfolding, 1 - enter) + exit * .92
        const angle = p.reduced ? 0 : (fold * 1.52 + resting * settle * (1 - exit)) * (n % 2 ? -1 : 1)
        item.mesh.scale.setScalar(position.rowScale)
        item.mesh.rotation.set(p.reduced ? 0 : unfolding * (n % 2 ? -.48 : .48) + exit * .25 * direction,
          angle, p.reduced ? 0 : unfolding * (n % 2 ? .16 : -.16) + exit * .09 * direction)
        item.material.uniforms.opacity.value = p.reduced ? (time >= line.start && time < end ? 1 : 0)
          : Math.min(1, enter * 1.6) * (.32 + .68 * settle) * (1 - exit) ** .85
        item.material.uniforms.light.value = 1 - Math.abs(Math.sin(angle)) * .24
        item.material.uniforms.pixelRatio.value = gl.getPixelRatio()
        item.material.uniforms.clock.value = p.reduced ? 0 : time / 1000
        item.material.uniforms.flare.value = p.reduced ? 0 : pulse
        item.glyphs.forEach((glyph, j) => { item.spans[j].z = glyph.timed ? clamp((time - glyph.start) / Math.max(1, glyph.end - glyph.start)) : time >= glyph.start ? 1 : 0 })
        const active = item.glyphs.find(g => !g.hidden && g.text.trim() && time >= g.start && time < (g.timed ? g.end : g.start + 650))
        const beam = item.material.uniforms.beam.value as Vector3
        beam.z = -1
        if (active && !p.reduced) {
          const members = item.glyphs.flatMap((g, j) => g.start === active.start && g.end === active.end ? [j] : [])
          beam.set(item.spans[members[0]].x, item.spans[members.at(-1)!].y,
            clamp((time - active.start) / (active.timed ? Math.max(1, active.end - active.start) : 650)))
        }
        item.foil.visible = !p.reduced
        item.foil.material.uniforms.opacity.value = item.material.uniforms.opacity.value * (.07 + activity * 1.8 + pulse * .18 + audio.impact * .72 + audio.energy * .10)
        item.foil.material.uniforms.clock.value = time / 1000 + n * .17
        item.foil.material.uniforms.music.value.set(audio.bass, audio.body, audio.treble)
      })
      // Adjacent panels share a hinge. Folding shortens the whole row like a concertina;
      // it never spreads individual words along a decorative path.
      for (let row = 0; row < rows; row++) {
        const members = panels.flatMap((item, n) => positions[n].row === row ? [{ item, n }] : [])
        if (!members.length) continue
        const first = positions[members[0].n]
        const foldedWidth = members.reduce((sum, { item }) => sum + Math.cos(item.mesh.rotation.y) * item.width * first.rowScale, 0)
        const anchor = rows === 1 ? first.x + (first.rowWidth - foldedWidth) / 2
          : row % 2 ? first.x + first.rowWidth - foldedWidth : first.x
        let x = anchor, z = 0
        for (const { item, n } of members) {
          const angle = item.mesh.rotation.y, width = item.width * first.rowScale
          const displacement = p.reduced ? 0 : activity * Math.sin(n * 1.7 + variant) * (compact ? .22 : .62)
          item.mesh.position.set(x, first.y + displacement, z)
          if (import.meta.env.DEV) poses.push([i, rows, x + width / 2, ...item.mesh.position.toArray(), angle, item.material.uniforms.opacity.value])
          x += Math.cos(angle) * width
          z -= Math.sin(angle) * width
        }
      }
    })
    stage.current?.update(time, size.width, size.height, energy * .45 + audio.impact * .85 + audio.energy * .15, visible.length > 0, p.reduced, Math.max(0, index) % 3, audio)
    const data = gl.domElement.dataset
    data.composition = 'folded'; data.time = String(Math.round(time)); data.line = String(index)
    data.resources = String(cache.current.size); data.visible = visible.join(',')
    data.size = `${Math.round(size.width)}x${Math.round(size.height)}`
    data.echoes = '0'; data.stage = String(!!stage.current?.mesh.visible)
    data.fontStyle = style; data.fontsReady = 'true'; data.fontWeight = String(weight)
    if (import.meta.env.DEV) {
      data.fontSize = String(p.fontSize); data.backgroundOpacity = String(p.backgroundOpacity); data.readability = p.readability
      data.audioImpact = audio.impact.toFixed(3)
      data.audioBands = [audio.bass, audio.body, audio.treble].map(v => v.toFixed(3)).join(',')
      data.preparing = prewarm.current ? String(prewarm.current.index) : ''
    }
    if (import.meta.env.DEV) data.poses = JSON.stringify(poses)
    data.frames = String(Number(data.frames ?? 0) + 1)
    if (p.playing) invalidate()
  })
  return null
}

export function FoldedLyrics(props: FoldedLyricsProps) {
  const fontsReady = useLyricFont(props.lines, props.fontStyle)
  const opacity = clamp(props.backgroundOpacity / 100)
  return <div className="folded-lyrics" aria-hidden="true" style={{ background: opacity ? `radial-gradient(ellipse closest-side, ${props.palette.shadow}${Math.round(opacity * 255).toString(16).padStart(2, '0')} 0%, transparent 100%)` : 'transparent' }}>
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [0, 0, 1000], fov: 36, near: .1, far: 10000 }} gl={{ alpha: true, antialias: true }}>{fontsReady && <Scene {...props} />}</Canvas>
  </div>
}
