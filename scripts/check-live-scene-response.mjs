import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const label = process.argv[2]
if (!label || !/^[\w-]+$/.test(label)) throw Error('Pass a unique label')
const folder = `artifacts/live-scene-response/${label}`
await mkdir(folder, { recursive: true })
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('http://127.0.0.1:1420/') && !p.url().includes('window='))
  if (!page) throw Error('Running development settings window required')
  const result = await page.evaluate(async () => {
    const [{ listen }, { FiberSceneRenderer }, { SceneMotion }, { AudioFeatureTimeline }, { studySettings }, { silentAnalysis }] = await Promise.all([
      import('/node_modules/@tauri-apps/api/event.js'), import('/src/features/spectrum/three/r3f/fiber-renderer.tsx'),
      import('/src/features/spectrum/three/motion.ts'), import('/src/features/spectrum/audio-feature-timeline.ts'),
      import('/src/features/spectrum/visual-study.ts'), import('/src/features/spectrum/music-analysis.ts'),
    ])
    const original = JSON.stringify(await window.__TAURI_INTERNALS__.invoke('get_settings'))
    const timeline = new AudioFeatureTimeline(), rows = []
    let audio = silentAnalysis(), receivedAt = 0, packets = 0
    const stop = await listen('music-analysis', ({ payload }) => {
      audio = payload; receivedAt = performance.now(); packets++; timeline.push(payload, receivedAt)
    })
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:480px;height:270px;pointer-events:none'
    document.body.append(host)
    try {
      for (const effect of ['rhythm_rain', 'volume_rain', 'tidal_knot', 'layered_tides']) {
        const config = studySettings(effect, 'daily'), motion = new SceneMotion(), canvas = document.createElement('canvas')
        canvas.style.cssText = 'width:480px;height:270px'; host.append(canvas)
        const errors = [], world = new FiberSceneRenderer(canvas, error => errors.push(String(error)))
        const row = { effect, packets:0, audibleFrames:0, frames:0, phaseBacksteps:0, sourceChanges:0,
          rmsMin:Infinity, rmsMax:0, phaseStart:null, phaseEnd:null, images:[], errors }
        try {
          await world.resize(config, 1)
          const started = performance.now(), firstPacket = packets
          let previous = started, generation = timeline.generation, lastPhase, lastFrame = -1
          while (performance.now() - started < 6000) {
            const now = await new Promise(requestAnimationFrame), dt = Math.min(.1, (now - previous) / 1000)
            previous = now
            if (generation !== timeline.generation) { motion.reset(true); generation = timeline.generation; lastPhase = undefined; row.sourceChanges++ }
            const current = now - receivedAt < 350 ? audio : silentAnalysis()
            motion.step(current, dt, config.music, false, timeline.sample(now, config.music))
            world.draw(motion, config, false, dt)
            row.frames++; row.audibleFrames += Number(!!motion.frame?.audible)
            row.rmsMin = Math.min(row.rmsMin, current.rms); row.rmsMax = Math.max(row.rmsMax, current.rms)
            let phase
            world.scene.traverse(object => {
              const u = object.material?.uniforms
              if (phase === undefined && (u?.uPhase || u?.uTime)) phase = (u.uPhase ?? u.uTime).value
            })
            if (phase !== undefined) {
              if (!Number.isFinite(phase)) errors.push('Nonfinite motion phase')
              if (lastPhase !== undefined && phase < lastPhase - 1e-6) row.phaseBacksteps++
              row.phaseStart ??= phase; row.phaseEnd = lastPhase = phase
            }
            const sample = Math.floor((now - started) / 2000)
            if (sample > lastFrame) { row.images.push(canvas.toDataURL('image/png')); lastFrame = sample }
          }
          row.packets = packets - firstPacket
          row.glError = world.renderer.getContext().getError()
          world.dispose(); row.remaining = { ...world.renderer.info.memory }
          rows.push(row)
        } finally { world.dispose(); world.renderer.forceContextLoss(); canvas.remove() }
      }
    } finally { stop(); host.remove() }
    return { rows, settingsUnchanged:original === JSON.stringify(await window.__TAURI_INTERNALS__.invoke('get_settings')),
      method:'Current configured native audio analysis, independent timeline and offscreen production scenes with recommended parameters. No playback, source or persisted settings edits; no PCM stored. Sequential six-second samples are not a cross-song comparison.' }
  })
  for (const row of result.rows) {
    row.files = []
    for (const [i, image] of row.images.entries()) {
      const file = `${row.effect}-${i}.png`; row.files.push(file)
      await writeFile(`${folder}/${file}`, Buffer.from(image.split(',')[1], 'base64'))
    }
    delete row.images
  }
  await writeFile(`${folder}/report.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  if (result.rows.some(r => !r.packets || !r.audibleFrames || r.errors.length || r.glError || r.phaseBacksteps || r.remaining.geometries || r.remaining.textures)) process.exitCode = 1
} finally { await browser.close() }
