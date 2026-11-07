import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { visualProbeHtml } from './visual-probe-html.mjs'

const option = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3)
const label = option('label') ?? 'review'
if (!/^[\w-]+$/.test(label)) throw Error('Invalid label')
const names = { rhythm_rain:'落雨', rhythm_skin:'风织绸境', ripple:'雪花飘舞', volume_rain:'晴空浮游', dream_stars:'银河', vortex:'旋涡', sound_field:'频谱回响', petal_bloom:'星瓣花境', aurora_flow:'极光流域', star_flight:'星尘航道' }
Object.assign(names,{caustic_light:'水光焦散',butterfly_flock:'风栖蝶群',ginkgo_leaves:'秋光银杏',cosmic_web:'星脉旷野'})
const effects = option('effects')?.split(',') ?? Object.keys(names)
if (effects.some(effect => !names[effect])) throw Error('Invalid effect')
const folder = `artifacts/effect-refinement/${label}`
await mkdir(folder, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl'] })
const reports = [], errors = [], environmentWarnings = []
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } })
  // Fixed recordings do not use HMR; keep concurrent source edits from
  // invalidating the recording or producing Vite websocket error relays.
  await page.routeWebSocket('**',socket=>{socket.send(JSON.stringify({type:'connected'}));socket.onMessage(()=>{})})
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const message = m.text()
    if (message.includes('[vite] failed to connect to websocket') ||
      (message.includes('WebSocket connection to') && message.includes('ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS'))) {
      environmentWarnings.push('Chrome blocked the Vite hot-reload websocket; this capture uses a fixed page and does not require hot reload.')
    } else errors.push(message)
  })
  await page.route('**/effect-motion-capture', r => r.fulfill({ contentType: 'text/html', body: visualProbeHtml('<body style="margin:0;background:#040910"></body>') }))
  await page.goto('http://127.0.0.1:1420/effect-motion-capture')
  for (const effect of effects) {
    const result = await page.evaluate(async effect => {
      const { FiberSceneRenderer } = await import('/src/features/spectrum/three/r3f/fiber-renderer.tsx')
      const { SceneMotion } = await import('/src/features/spectrum/three/motion.ts')
      const { AudioFeatureTimeline } = await import('/src/features/spectrum/audio-feature-timeline.ts')
      const { studyAnalysis, studySettings } = await import('/src/features/spectrum/visual-study.ts')
      const c = document.createElement('canvas'); c.style.cssText = 'width:800px;height:450px'; document.body.append(c)
      const world = new FiberSceneRenderer(c), motion = new SceneMotion(), timeline = new AudioFeatureTimeline()
      const settings = studySettings(effect, 'immersive')
      await world.resize(settings, 1)
      const output = document.createElement('canvas'); output.width = 800; output.height = 450
      const ctx = output.getContext('2d'), chunks = [], frames = [], samples = []
      const stream = output.captureStream(0), track = stream.getVideoTracks()[0]
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 3500000 })
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      const done = new Promise(resolve => { recorder.onstop = resolve })
      let sequence = 0, audio = studyAnalysis(0), previousPhase = -1, reversals = 0
      recorder.start()
      const start = performance.now()
      for (let frame = 0; frame <= 420; frame++) {
        const time = frame / 30
        while (sequence * 1024 / 48000 <= time + 1e-9) {
          audio = studyAnalysis(sequence++); timeline.push(audio, audio.samplePosition / 48)
        }
        motion.step(audio, 1 / 30, settings.music, false, timeline.sample(time * 1000, settings.music))
        world.draw(motion, settings, false, 1 / 30)
        const phases = []
        world.scene.traverse(o => {
          const value = o.material?.uniforms?.[effect === 'aurora_flow' ? 'uAuroraPhase' : 'uPhase']?.value
          if (typeof value === 'number') phases.push(value)
        })
        const phase = phases[0] ?? motion.phase
        if (phase < previousPhase - 1e-8) reversals++
        previousPhase = phase
        samples.push({ time, phase, energy: motion.energy, bands: Array.from(motion.musicalBands), onset: motion.frame?.onset })
        ctx.fillStyle = '#040910'; ctx.fillRect(0, 0, 800, 450); ctx.drawImage(c, 0, 0, 800, 450)
        if ([72, 156, 225, 420].includes(frame)) frames.push({ time, image: output.toDataURL('image/png') })
        track.requestFrame()
        await new Promise(r => setTimeout(r, Math.max(0, start + (frame + 1) * 1000 / 30 - performance.now())))
      }
      recorder.stop(); await done; stream.getTracks().forEach(t => t.stop())
      const glError = world.renderer.getContext().getError()
      world.dispose(); const remaining = { ...world.renderer.info.memory }; world.renderer.forceContextLoss(); c.remove()
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer())
      let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
      return { video: btoa(binary), frames, samples, reversals, glError, remaining }
    }, effect)
    await writeFile(`${folder}/${effect}.webm`, Buffer.from(result.video, 'base64')); delete result.video
    for (const frame of result.frames) {
      frame.file = `${effect}-${frame.time.toFixed(1)}.png`
      await writeFile(`${folder}/${frame.file}`, Buffer.from(frame.image.split(',')[1], 'base64')); delete frame.image
    }
    reports.push({ effect, ...result })
    await writeFile(`${folder}/motion-report.json`, JSON.stringify({ input: 'studyAnalysis synthetic features; no sound playback or system capture.', errors, environmentWarnings: [...new Set(environmentWarnings)], studies: reports }, null, 2))
    console.log(`${effect}: GL=${result.glError}, reversals=${result.reversals}, resources=${JSON.stringify(result.remaining)}`)
  }
} finally { await browser.close() }
const cards = effects.map(effect => `<section><h2>${names[effect]}</h2><video controls muted loop playsinline preload="metadata" poster="${effect}-5.2.png" src="${effect}.webm"></video></section>`).join('')
await writeFile(`${folder}/motion.html`, `<!doctype html><meta charset="utf-8"><title>灯效运动调校</title><style>body{max-width:1500px;margin:40px auto;padding:0 24px;background:#071019;color:#d6e2e9;font:16px/1.6 system-ui}h1{font-size:26px;font-weight:500}h2{font-size:18px;font-weight:500}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}video{width:100%;border-radius:12px;background:#040910}p{color:#8fa8b8}@media(max-width:750px){main{grid-template-columns:1fr}}</style><h1>${effects.length} 种灯效 · 运动调校</h1><p>实际软件渲染器，固定合成分析输入。0.8–3.2 秒低频鼓点，3.2–6.2 秒中频长音，6.2–8.6 秒高频细节，随后安静、渐强与骤停。视频无声。</p><main>${cards}</main>`)
if (errors.length || reports.some(r => r.glError || r.reversals || r.remaining.geometries || r.remaining.textures)) process.exitCode = 1
