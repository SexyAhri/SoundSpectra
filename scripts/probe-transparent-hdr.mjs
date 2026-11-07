import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { visualProbeHtml } from './visual-probe-html.mjs'

const label = process.argv[2] ?? 'before'
if (!/^[\w-]+$/.test(label)) throw Error('Invalid label')
const folder = `artifacts/motion-quality/black-blocks-${label}`
const live = process.argv.includes('--live-settings') ? JSON.parse(await readFile('artifacts/motion-quality/black-blocks-live-settings.json', 'utf8')) : null
if(live&&process.argv.includes('--latest-settings'))live.settings=JSON.parse(await readFile('artifacts/motion-quality/aurora-live-settings.json','utf8'))
await mkdir(folder, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl'] })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/transparent-hdr-probe', route => route.fulfill({ contentType: 'text/html', body: visualProbeHtml('<body style="background:#81949e"></body>') }))
  await page.goto('http://127.0.0.1:1420/transparent-hdr-probe')
  const results = []
  for (const effect of (process.argv.find(v=>v.startsWith('--effects='))?.slice(10)??'rhythm_balls,rhythm_skin').split(',')) {
    const report = await page.evaluate(async ({effect, live, stress}) => {
      const T = await import('/node_modules/.vite/deps/three.js')
      const { FiberSceneRenderer } = await import('/src/features/spectrum/three/r3f/fiber-renderer.tsx')
      const { SceneMotion } = await import('/src/features/spectrum/three/motion.ts')
      const { studySettings, studyAnalysis } = await import('/src/features/spectrum/visual-study.ts')
      const canvas = document.createElement('canvas')
      canvas.style.cssText = live ? `width:${live.canvases[0].width}px;height:${live.canvases[0].height}px` : 'width:640px;height:360px'; document.body.append(canvas)
      const world = new FiberSceneRenderer(canvas), motion = new SceneMotion()
      const config = live ? {...live.settings, effect} : { ...studySettings(effect, 'immersive'), quality: 'balanced' }
      const rows = [], failures = [], isolation = [], snapshots = []
      const read = target => {
        const data = new Uint16Array(target.width * target.height * 4)
        world.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, data)
        let invalid = 0, negative = 0, minBits = 0, maxBits = 0
        const samples = []
        for (let i = 0; i < data.length; i++) {
          const bits=data[i], bad=(bits&0x7c00)===0x7c00, below=(bits&0x8000)!==0&&(bits&0x7fff)>0x1419
          invalid += Number(bad); negative += Number(below&&!bad)
          if ((bad || below) && samples.length < 8) samples.push({ x: Math.floor(i / 4) % target.width, y: Math.floor(i / 4 / target.width), channel: i % 4, encoded: bits })
          if (!bad) { if(bits&0x8000)minBits=Math.max(minBits,bits&0x7fff);else maxBits=Math.max(maxBits,bits) }
        }
        return { invalid, negative, min: -T.DataUtils.fromHalfFloat(minBits), max:T.DataUtils.fromHalfFloat(maxBits), samples }
      }
      const readAll = () => [world.image, ...world.bloom.levels.slice(0, world.bloom.count).flat()].map(read)
      try {
        await world.resize(config, 1)
        for (let frame = 0; frame < (stress?600:240); frame++) {
          const time = frame / 30, yaw = [config.view.yaw, 37, -65][Math.floor(frame / 80)%3]
          const settings = { ...config, sceneMode:frame%240<120?'immersive':'daily', view: { ...config.view, yaw, ...(stress?{pitch:[config.view.pitch,30,-35][Math.floor(frame/40)%3],distance:[.6,1,1.5][Math.floor(frame/120)%3]}:{}) } }
          motion.step(studyAnalysis(Math.round(time * 48000 / 1024)), 1 / 30, config.music, false)
          if(stress)motion.auroraPhase=frame*.87
          world.draw(motion, settings, false)
          const targets = readAll()
          rows.push({ frame, time, yaw, targets })
          if (targets.some(t => t.invalid || t.negative)) {
            failures.push(frame)
            if (isolation.length === 0) {
              snapshots.push({ frame, image: canvas.toDataURL('image/png') })
              const objects = []
              world.scene.traverse(o => { if (o.material && o.visible && o.name !== 'scene-backdrop') objects.push(o) })
              const visible = objects.map(o => o.visible)
              for (let i = 0; i < objects.length; i++) {
                objects.forEach((o, j) => o.visible = i === j)
                world.draw(motion, settings, false)
                isolation.push({ index: i, type: objects[i].type, vertex: objects[i].material.vertexShader, fragment: objects[i].material.fragmentShader, targets: readAll() })
              }
              objects.forEach((o, i) => o.visible = visible[i])
            }
          }
        }
        const gl = world.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info')
        return { effect, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), config, frames: rows.length, failures, rows, isolation, snapshots, glError: gl.getError() }
      } finally { world.dispose(); world.renderer.forceContextLoss(); canvas.remove() }
    }, {effect,live,stress:process.argv.includes('--stress')})
    for (const shot of report.snapshots) {
      shot.file = `${effect}-${shot.frame}.png`
      await writeFile(`${folder}/${shot.file}`, Buffer.from(shot.image.split(',')[1], 'base64')); delete shot.image
    }
    results.push(report)
    console.log(JSON.stringify({ effect, renderer: report.renderer, frames: report.frames, failedFrames: report.failures.length, first: report.failures[0], isolated: report.isolation.map(({ index, type, targets }) => ({ index, type, invalid: targets.reduce((n,t)=>n+t.invalid,0), negative: targets.reduce((n,t)=>n+t.negative,0) })) }))
  }
  await writeFile(`${folder}/report.json`, JSON.stringify({ results, errors }, null, 2))
} finally { await browser.close() }
