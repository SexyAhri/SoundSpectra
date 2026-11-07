import { useEffect, useRef, type RefObject } from 'react'
import { demoSpectrum } from '../spectrum/spectrum-motion'

export function CardMeter({ bands, receivedAt, active, desktop, demo, variant }: { bands: RefObject<Float32Array>; receivedAt: RefObject<number>; active: boolean; desktop: boolean; demo: boolean; variant: string }) {
  const root = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!active) return
    const svg = root.current!, nodes = svg.querySelectorAll('line')
    const levels = new Float32Array(nodes.length), source = new Float32Array(96)
    let frame = 0, timer = 0, previous = 0, visible = true
    const tick = (now: number) => {
      if (!visible || !desktop && document.hidden) return
      const elapsed = Math.min(.1, (now - previous) / 1000 || .04); previous = now
      if (demo) demoSpectrum(source, now / 1000)
      else if (receivedAt.current > 0 && now - receivedAt.current < 350) source.set(bands.current)
      else source.fill(0)
      let moving = false
      nodes.forEach((node, index) => {
        const start = Math.floor(index / nodes.length * 72), end = Math.floor((index + 1) / nodes.length * 72)
        let energy = 0
        for (let band = start; band < end; band++) energy += Math.max(0, Math.min(1, source[band] || 0))
        const target = Math.pow(energy / Math.max(1, end - start), 1.4)
        levels[index] += (target - levels[index]) * (1 - Math.exp(-elapsed / (target > levels[index] ? .045 : .22)))
        if (target === 0 && levels[index] < .001) levels[index] = 0
        moving ||= levels[index] > 0
        const height = 2 + levels[index] * 28
        const top = (variant === 'afternoon' ? 20 - height / 2 : 34 - height).toFixed(2)
        const bottom = (variant === 'afternoon' ? 20 + height / 2 : 34).toFixed(2)
        if (node.getAttribute('y1') !== top) node.setAttribute('y1', top)
        if (node.getAttribute('y2') !== bottom) node.setAttribute('y2', bottom)
      })
      const state = moving ? 'active' : 'quiet'
      if (svg.dataset.energy !== state) svg.dataset.energy = state
      timer = window.setTimeout(() => { frame = requestAnimationFrame(tick) }, moving || demo ? 32 : 180)
    }
    const start = () => { clearTimeout(timer); cancelAnimationFrame(frame); if (visible && (desktop || !document.hidden)) frame = requestAnimationFrame(tick) }
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; start() })
    observer.observe(svg)
    document.addEventListener('visibilitychange', start)
    start()
    return () => { clearTimeout(timer); cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('visibilitychange', start) }
  }, [active, desktop, demo, variant, bands, receivedAt])
  const count = variant === 'compact' ? 4 : variant === 'afternoon' ? 7 : 9
  return <svg className={`mc-meter mc-meter-${variant}`} ref={root} viewBox="0 0 120 40" aria-label={demo ? '模拟声能' : '实时声能'} role="img">{Array.from({ length: count }, (_, index) => <line key={index} x1={8 + index * 104 / (count - 1)} x2={8 + index * 104 / (count - 1)} y1="32" y2="34" />)}</svg>
}
