import { useEffect, useRef, type RefObject } from 'react'
import { BAND_COUNT } from '../spectrum/model'
import { demoSpectrum } from '../spectrum/spectrum-motion'

export function LiveMeter({ bands, receivedAt, demo = false, active = true, desktop = false, className = '' }: {
  bands: RefObject<Float32Array>; receivedAt: RefObject<number>; demo?: boolean; active?: boolean; desktop?: boolean; className?: string;
}) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!active) return
    const nodes = ref.current!.querySelectorAll<SVGRectElement>('rect')
    const source = new Float32Array(BAND_COUNT), levels = new Float32Array(nodes.length)
    let stopped = false, raf = 0, timer = 0, last = 0, visible = true
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true })
    observer.observe(ref.current!)
    const frame = (now: number) => {
      if (stopped) return
      if (!visible || !desktop && document.hidden) { timer = window.setTimeout(() => { raf = requestAnimationFrame(frame) }, 250); return }
      if (now - last < 1000 / 30) { raf = requestAnimationFrame(frame); return }
      const elapsed = Math.min(.1, (now - last) / 1000 || 1 / 30); last = now
      if (demo) demoSpectrum(source, now / 1000)
      else if (receivedAt.current > 0 && now - receivedAt.current < 350) source.set(bands.current)
      else source.fill(0)
      nodes.forEach((node, i) => {
        const value = source[Math.floor(i / nodes.length * BAND_COUNT)]
        const target = Number.isFinite(value) ? Math.pow(Math.max(0, Math.min(1, value)), 1.6) : 0
        levels[i] += (target - levels[i]) * (1 - Math.exp(-elapsed / (target > levels[i] ? .04 : .18)))
        const height = 1 + levels[i] * 33
        node.setAttribute('height', height.toFixed(2)); node.setAttribute('y', (36 - height).toFixed(2))
      })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { stopped = true; cancelAnimationFrame(raf); clearTimeout(timer); observer.disconnect() }
  }, [bands, receivedAt, demo, active, desktop])
  return <svg ref={ref} viewBox="0 0 160 40" className={`live-meter ${className}`} aria-hidden="true">{Array.from({ length: 20 }, (_, i) => <rect key={i} x={i * 8} y="35" width="5" height="1" rx="1" style={{ fill: i > 15 ? '#ffb66b' : i > 8 ? '#c8e78b' : '#79d8bf' }} />)}</svg>
}
