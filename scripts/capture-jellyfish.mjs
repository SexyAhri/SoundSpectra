import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { visualProbeHtml } from './visual-probe-html.mjs'

const label = process.argv.find(a => a.startsWith('--label='))?.slice(8) ?? 'review'
if (!/^[\w-]+$/.test(label)) throw Error('Invalid label')
const folder = `artifacts/jellyfish/${label}`
await mkdir(folder, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl'] })
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/jellyfish-capture', r => r.fulfill({ contentType: 'text/html', body: visualProbeHtml('<body style="margin:0;background:#040910"></body>') }))
  await page.goto('http://127.0.0.1:1420/jellyfish-capture')
  const result = await page.evaluate(async () => {
    const { FiberSceneRenderer } = await import('/src/features/spectrum/three/r3f/fiber-renderer.tsx')
    const { SceneMotion } = await import('/src/features/spectrum/three/motion.ts')
    const { AudioFeatureTimeline } = await import('/src/features/spectrum/audio-feature-timeline.ts')
    const { studyAnalysis, studySettings } = await import('/src/features/spectrum/visual-study.ts')
    const c = document.createElement('canvas'); c.style.cssText = 'width:960px;height:540px'; document.body.append(c)
    const world = new FiberSceneRenderer(c), motion = new SceneMotion(), timeline = new AudioFeatureTimeline()
    const settings = studySettings('rhythm_balls', 'immersive')
    await world.resize(settings, 1)
    const output = document.createElement('canvas'); output.width = 960; output.height = 540
    const ctx = output.getContext('2d'), chunks = [], frames = [], samples = []
    const stream = output.captureStream(0), track = stream.getVideoTracks()[0]
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 5000000 })
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    const done = new Promise(resolve => { recorder.onstop = resolve })
    let sequence = 0, audio = studyAnalysis(0)
    recorder.start()
    const start = performance.now()
    for (let frame = 0; frame < 240; frame++) {
      const time = frame / 30
      while (sequence * 1024 / 48000 <= time + 1e-9) {
        audio = studyAnalysis(sequence++); timeline.push(audio, audio.samplePosition / 48)
      }
      motion.step(audio, 1 / 30, settings.music, false, timeline.sample(time * 1000, settings.music))
      world.draw(motion, settings, false, 1 / 30)
      ctx.fillStyle = '#040910'; ctx.fillRect(0, 0, 960, 540); ctx.drawImage(c, 0, 0, 960, 540)
      if ([72, 156, 225].includes(frame)) frames.push({ time, image: output.toDataURL('image/png') })
      const body = world.scene.getObjectByName('jellyfish-garden').children.find(o => o.material?.uniforms?.uJellyStroke)
      samples.push({ time, stroke: Array.from(body.material.uniforms.uJellyStroke.value), wake: Array.from(body.material.uniforms.uJellyWake.value), tip: Array.from(body.material.uniforms.uJellyTip.value), phase: body.material.uniforms.uPhase.value })
      track.requestFrame()
      await new Promise(r => setTimeout(r, Math.max(0, start + (frame + 1) * 1000 / 30 - performance.now())))
    }
    recorder.stop(); await done; stream.getTracks().forEach(t => t.stop())
    settings.sceneMode = 'daily'; world.draw(motion, settings, false, 0)
    frames.push({ time: 'daily', image: c.toDataURL('image/png') })
    const glError = world.renderer.getContext().getError()
    world.dispose(); const remaining = { ...world.renderer.info.memory }; world.renderer.forceContextLoss(); c.remove()
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer())
    let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
    return { video: btoa(binary), frames, samples, glError, remaining }
  })
  await writeFile(`${folder}/jellyfish.webm`, Buffer.from(result.video, 'base64')); delete result.video
  for (const frame of result.frames) {
    frame.file = `jellyfish-${typeof frame.time === 'number' ? frame.time.toFixed(1) : frame.time}.png`
    await writeFile(`${folder}/${frame.file}`, Buffer.from(frame.image.split(',')[1], 'base64')); delete frame.image
  }
  await writeFile(`${folder}/report.json`, JSON.stringify({ input: 'studyAnalysis synthetic features, no sound or system capture', errors, ...result }, null, 2))
  console.log(JSON.stringify({ folder, errors, glError: result.glError, remaining: result.remaining }))
  if (errors.length || result.glError || result.remaining.geometries || result.remaining.textures) process.exitCode = 1
} finally { await browser.close() }
