import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { visualProbeHtml } from './visual-probe-html.mjs'

const label = process.argv[2]
if (!label || !/^[\w-]+$/.test(label)) throw Error('Pass a unique label')
const folder = `artifacts/music-transitions/${label}`
const captureFile = process.argv.find(arg => arg.startsWith('--capture='))?.slice(10)
const captured = captureFile ? JSON.parse(await readFile(captureFile, 'utf8')).packets : []
if (captureFile && (!captured?.length || captured.some(p => !Number.isFinite(p.wall) || !p.audio))) throw Error('Invalid capture')
await mkdir(folder, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl'] })
const rows = [], errors = []
try {
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.routeWebSocket('**', socket => { socket.send(JSON.stringify({ type: 'connected' })); socket.onMessage(() => {}) })
  await page.route('**/music-transition-probe', route => route.fulfill({ contentType: 'text/html', body: visualProbeHtml('<body></body>') }))
  await page.goto('http://127.0.0.1:1420/music-transition-probe')
  const catalog = await page.evaluate(async () => (await import('/src/features/spectrum/music-engine/catalog.ts')).musicEffects)
  for (const mode of ['daily', 'immersive']) for (const { value: effect } of catalog) {
    const row = await page.evaluate(async ({ effect, mode, captured }) => {
      const [{ FiberSceneRenderer }, { SceneMotion }, { AudioFeatureTimeline }, { studySettings }, { silentAnalysis }] = await Promise.all([
        import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'), import('/src/features/spectrum/three/motion.ts'),
        import('/src/features/spectrum/audio-feature-timeline.ts'), import('/src/features/spectrum/visual-study.ts'), import('/src/features/spectrum/music-analysis.ts'),
      ])
      const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:320px;height:180px'; document.body.append(canvas)
      const errors = [], world = new FiberSceneRenderer(canvas, error => errors.push(String(error)))
      const config = studySettings(effect, mode), motion = new SceneMotion(), timeline = new AudioFeatureTimeline()
      const trace = [], pictures = [], phases = new Map()
      let next = 0, captureIndex = 0, audio = silentAnalysis(), receivedAt = -Infinity, generation = 0, reversals = 0, invalid = 0
      const hop = 1024 / 48000, fps = 30
      const captureEnd = captured.length ? 18 + (captured.at(-1).wall - captured[0].wall) / 1000 : 18
      const end = captured.length ? Math.ceil(captureEnd + 3) : 18
      const stage = t => t < 1 ? 'initial-silence' : t < 3 ? 'quiet' : t < 6 ? 'dense' : t < 8 ? 'pause' : t < 9 ? 'resume' : t < 11 ? 'dropout' : t < 13 ? 'reconnect' : t < 15 ? 'new-source' : t < 18 ? 'final-silence' : t <= captureEnd ? 'captured-music' : 'capture-expired'
      const packet = (sequence, t) => {
        const quiet = t >= 1 && t < 3, dense = t >= 3 && t < 6
        const active = quiet || dense || (t >= 8 && t < 9) || (t >= 11 && t < 15)
        const hit = Math.exp(-((t - 3 + 30) % .125) * 70)
        const rms = !active ? 0 : quiet ? .008 : dense ? .035 + hit * .26 : .11
        const weights = t >= 13 ? [.06,.08,.12,.25,.6,.7] : [.7,.6,.35,.25,.14,.08]
        const bandRms = weights.map(w => w * rms)
        return { sourceRevision: t >= 13 ? 2 : 1, streamId: t >= 13 ? 2 : 1, sequence,
          // A replacement stream is allowed to start with a larger sample clock.
          samplePosition: sequence * 1024 + (t >= 13 ? 48000 * 100 : 0), sampleRate: 48000,
          rms, bandRms, bands: bandRms.map(v => Math.sqrt(v)), spectrum: Array.from({ length:48 }, (_, i) => Math.sqrt(bandRms[Math.floor(i / 8)])),
          spectrumRms: Array.from({ length:48 }, (_, i) => bandRms[Math.floor(i / 8)]), skin: [] }
      }
      try {
        await world.resize(config, 1)
        const gl = world.renderer.getContext(), pixels = new Uint8Array(canvas.width * canvas.height * 4)
        const debug = gl.getExtension('WEBGL_debug_renderer_info')
        const gpu = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)
        for (let frame = 0; frame <= end * fps; frame++) {
          const time = frame / fps, now = time * 1000
          while (next * hop < 18 && next * hop <= time + 1e-9) {
            const t = next * hop, candidate = packet(next++, t)
            if (t >= 9 && t < 11) continue
            audio = candidate; receivedAt = t * 1000; timeline.push(audio, receivedAt)
          }
          while (captureIndex < captured.length && 18000 + captured[captureIndex].wall - captured[0].wall <= now) {
            const entry = captured[captureIndex++]
            audio = { ...entry.audio, sourceRevision: entry.audio.sourceRevision + 100 }
            receivedAt = 18000 + entry.wall - captured[0].wall
            timeline.push(audio, receivedAt)
          }
          if (generation !== timeline.generation) { motion.reset(true); generation = timeline.generation }
          const current = now - receivedAt < 350 ? audio : silentAnalysis()
          motion.step(current, 1 / fps, config.music, false, timeline.sample(now, config.music))
          world.draw(motion, config, false, 1 / fps)
          world.scene.traverse(object => {
            const materials = Array.isArray(object.material) ? object.material : [object.material]
            for (const material of materials) for (const name of ['uPhase', 'uTime']) {
              const value = material?.uniforms?.[name]?.value
              if (typeof value !== 'number') continue
              const key = `${object.id}:${material.id}:${name}`, previous = phases.get(key)
              if (!Number.isFinite(value)) invalid++
              if (previous !== undefined && value < previous - 1e-6) reversals++
              phases.set(key, value)
            }
          })
          if (frame % 3 === 0) {
            gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
            let light = 0, coverage = 0
            for (let i = 0; i < pixels.length; i += 4) { light += Math.max(pixels[i],pixels[i+1],pixels[i+2]); coverage += Number(pixels[i+3] > 8) }
            trace.push({ time, stage: stage(time), rms: current.rms, presence: motion.presence, phase: motion.phase,
              energy: motion.energy, onset: !!motion.frame?.onset, beat: motion.frame?.beatIndex, accents: [...motion.accents],
              light: light / (255 * canvas.width * canvas.height), coverage: coverage / (canvas.width * canvas.height) })
          }
          if ([2.4,5.4,7.8,8.7,10.8,12.6,13.2,14.7,17.7,...(captured.length ? [20,23,26,29] : [])].some(t => Math.abs(time - t) < .001))
            pictures.push({ time, stage: stage(time), image: canvas.toDataURL('image/png') })
          if (frame % 30 === 0) await new Promise(resolve => setTimeout(resolve, 0))
        }
        const glError = gl.getError()
        world.dispose()
        return { effect, mode, gpu, errors, glError, reversals, invalid, trace, pictures, remaining: { ...world.renderer.info.memory } }
      } finally { world.dispose(); world.renderer.forceContextLoss(); canvas.remove() }
    }, { effect, mode, captured })
    for (const picture of row.pictures) {
      picture.file = `${effect}-${mode}-${picture.time}.png`
      await writeFile(`${folder}/${picture.file}`, Buffer.from(picture.image.split(',')[1], 'base64'))
      delete picture.image
    }
    rows.push(row)
    console.log(`${effect} ${mode}: backsteps=${row.reversals}, GL=${row.glError}, final presence=${row.trace.at(-1).presence}`)
  }
} finally { await browser.close() }
await writeFile(`${folder}/report.json`, JSON.stringify({
  method: 'Authored RMS/band features through the production timeline, motion and renderer at 30Hz, 320x180. Quiet, 8Hz attacks, zero-valued packets, missing packets, reconnect and larger-clock source replacement. Optional native capture replay keeps original arrival offsets and audio values, with source revision shifted to follow synthetic streams. No system playback changes. Pixel statistics are not aesthetic or physical display latency scores.', captureFile, errors, rows,
}, null, 2))
if (errors.length || rows.some(r => r.errors.length || r.glError || r.reversals || r.invalid || r.remaining.geometries || r.remaining.textures || r.trace.at(-1).presence)) process.exitCode = 1
