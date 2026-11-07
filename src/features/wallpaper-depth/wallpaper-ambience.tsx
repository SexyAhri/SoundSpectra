import { useEffect, useRef, type RefObject } from 'react'
import type { SceneMask, WallpaperDepthSettings } from '../spectrum/model'
import type { AnalysisSnapshot } from '../spectrum/spectrum-canvas'
import { demoAnalysis } from '../spectrum/music-analysis'

const smooth = (a: number, b: number, value: number) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t) }
export function ambientEnergy(rms: number, age: number) {
  // Perceptual compression keeps quiet music visible without amplifying silence.
  return Number.isFinite(rms) && age >= 0 && age < 500 ? Math.min(1, Math.sqrt(Math.max(0, rms - .004) * 6)) : 0
}
export function maskVisibility(x: number, y: number, masks: SceneMask[]) {
  let visible = 1
  for (const { bounds: b, feather } of masks) {
    const distance = Math.max(b.x - x, x - b.x - b.width, b.y - y, y - b.y - b.height)
    visible *= feather > .00001 ? smooth(-feather, 0, distance) : distance >= 0 ? 1 : 0
  }
  return visible
}

export function WallpaperAmbience({ settings, masks, analysis, demo = false, active = true }: {
  settings: WallpaperDepthSettings; masks: SceneMask[]; analysis: RefObject<AnalysisSnapshot>; demo?: boolean; active?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const surface = canvas.current!, context = surface.getContext('2d')
    if (!context) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0, timer = 0, envelope = 0, last = performance.now(), time = 0, width = 1, height = 1
    const mask = document.createElement('canvas'); mask.width = 256; mask.height = 144
    const maskContext = mask.getContext('2d')!
    const pixels = maskContext.createImageData(mask.width, mask.height), b = settings.ambientBounds
    // One small mask per layout change, shared by the glow and all particles.
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
      const px = (x + .5) / mask.width, py = (y + .5) / mask.height
      const edge = Math.min((px - b.x) / b.width, (b.x + b.width - px) / b.width, (py - b.y) / b.height, (b.y + b.height - py) / b.height)
      const i = (y * mask.width + x) * 4
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255
      pixels.data[i + 3] = Math.round(255 * smooth(0, .14, edge) * maskVisibility(px, py, masks))
    }
    maskContext.putImageData(pixels, 0, 0)
    const cancel = () => { cancelAnimationFrame(frame); clearTimeout(timer); frame = timer = 0 }
    const draw = () => {
      frame = timer = 0
      const now = performance.now(), dt = Math.min(.15, Math.max(0, (now - last) / 1000)); last = now
      if (!active || document.hidden || settings.ambientAmount === 0) { context.clearRect(0, 0, width, height); surface.dataset.energy = '0.0000'; return }
      const input = demo ? demoAnalysis(now / 1000) : analysis.current
      const target = ambientEnergy(input.rms, demo ? 0 : now - analysis.current.receivedAt)
      envelope += (target - envelope) * (1 - Math.exp(-dt / (target > envelope ? .18 : .9)))
      if (!reduced.matches) time += dt * Math.min(1, envelope * 5)
      context.clearRect(0, 0, width, height)
      const amount = envelope * Math.pow(settings.ambientAmount / 100, .72)
      surface.dataset.energy = amount.toFixed(4)
      surface.dataset.motion = reduced.matches ? 'reduced' : 'full'
      if (amount > .0005) {
        const cx = (b.x + b.width * (.5 + Math.sin(time * .2) * .12)) * width
        const cy = (b.y + b.height * (.53 + Math.cos(time * .16) * .08)) * height
        context.save(); context.translate(cx, cy); context.scale(b.width * width, b.height * height)
        const glow = context.createRadialGradient(0, 0, 0, 0, 0, .48 + envelope * .18)
        glow.addColorStop(0, settings.ambientColor + 'dd'); glow.addColorStop(.4, settings.ambientColor + '70'); glow.addColorStop(1, settings.ambientColor + '00')
        context.globalAlpha = amount * .85; context.fillStyle = glow; context.fillRect(-1, -1, 2, 2); context.restore()
        for (let i = 0; i < 36; i++) {
          const seed = i * 2.399963, x = .08 + .84 * ((i * .618034 + Math.sin(time * .25 + seed) * .045 + 1) % 1)
          const y = .08 + .84 * ((i * .381966 - time * (.018 + i % 4 * .002) + 100) % 1)
          const px = (b.x + x * b.width) * width, py = (b.y + y * b.height) * height
          const radius = Math.max(1.4, width / 650) * (1 + i % 4 * .23)
          const dot = context.createRadialGradient(px, py, 0, px, py, radius * 4)
          dot.addColorStop(0, settings.ambientColor); dot.addColorStop(.25, settings.ambientColor + 'b0'); dot.addColorStop(1, settings.ambientColor + '00')
          context.globalAlpha = amount * (.7 + .25 * Math.sin(time * .6 + seed)); context.fillStyle = dot
          context.fillRect(px - radius * 4, py - radius * 4, radius * 8, radius * 8)
          // A fine dark rim keeps pale particles readable over light wallpapers.
          context.globalAlpha = amount * .38; context.lineWidth = Math.max(.7, radius * .45); context.strokeStyle = '#13242b'
          context.beginPath(); context.arc(px, py, radius * .65, 0, Math.PI * 2); context.stroke()
          context.globalAlpha = amount * .9; context.fillStyle = settings.ambientColor; context.fill()
        }
        context.globalAlpha = 1; context.globalCompositeOperation = 'destination-in'
        context.drawImage(mask, 0, 0, width, height); context.globalCompositeOperation = 'source-over'
      }
      // 30 Hz while playing; a quiet timer detects resumed input without a busy RAF loop.
      timer = window.setTimeout(() => { frame = requestAnimationFrame(draw) }, envelope > .001 || demo ? 33 : 150)
    }
    const wake = () => { cancel(); last = performance.now(); frame = requestAnimationFrame(draw) }
    const resize = () => {
      const ratio = Math.min(devicePixelRatio, 1.25, 1280 / Math.max(1, surface.clientWidth))
      width = surface.width = Math.max(1, Math.round(surface.clientWidth * ratio))
      height = surface.height = Math.max(1, Math.round(surface.clientHeight * ratio)); wake()
    }
    const observer = new ResizeObserver(resize); observer.observe(surface); resize()
    document.addEventListener('visibilitychange', wake); reduced.addEventListener('change', wake)
    return () => { cancel(); observer.disconnect(); document.removeEventListener('visibilitychange', wake); reduced.removeEventListener('change', wake) }
  }, [settings.ambientBounds, settings.ambientAmount, settings.ambientColor, masks, active, demo, analysis])
  return <canvas className="wallpaper-ambience" data-testid="wallpaper-ambience" aria-hidden="true" ref={canvas} />
}
