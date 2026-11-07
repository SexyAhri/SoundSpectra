import { useEffect, useMemo, useRef, useState } from 'react'
import type { SpectrumSettings } from '../spectrum/model'
import type { NowPlaying } from './use-now-playing'
import { mixColor, readCoverAccent } from './cover-colors'

export function useCoverColors(settings: SpectrumSettings, info: NowPlaying, active: boolean) {
  const [sample, setSample] = useState<{ cover: string; color: string | null; failed?: boolean } | null>(null)
  const enabled = settings.followCover && active
  useEffect(() => {
    if (!enabled || !info.cover) return
    let disposed = false
    const cover = info.cover
    void readCoverAccent(cover).then(color => { if (!disposed) setSample({ cover, color }) })
      .catch(() => { if (!disposed) setSample({ cover, color: null, failed: true }) })
    return () => { disposed = true }
  }, [enabled, info.cover])
  const currentSample = sample?.cover === info.cover ? sample : null
  const accent = settings.followCover && info.cover ? currentSample?.color : null
  const target = accent ? info.playing ? accent : mixColor(accent, settings.color, .55) : null
  const targets = { primary: target ?? settings.color, ...Object.fromEntries(settings.regions.map(region => [region.id, target ?? region.color])) }
  const signature = JSON.stringify(targets)
  const [colors, setColors] = useState<Record<string, string>>(targets)
  const shown = useRef(colors)
  const wasFollowing = useRef(settings.followCover)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(preference.matches)
    preference.addEventListener('change', change)
    return () => preference.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    const next = JSON.parse(signature) as Record<string, string>
    const from = shown.current
    const animate = settings.followCover || wasFollowing.current
    wasFollowing.current = settings.followCover
    let frame = 0, last = 0
    const publish = (value: Record<string, string>) => { shown.current = value; setColors(value) }
    // Fixed manual colors and scene changes are immediate unless transitioning
    // away from a cover; there is no persistent animation loop or settings write.
    if (!animate || reduced || !active || JSON.stringify(from) === signature) { publish(next); return }
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 1000)
      if (progress === 1 || now - last >= 32) {
        last = now
        const ease = progress * progress * (3 - 2 * progress)
        publish(Object.fromEntries(Object.entries(next).map(([id, color]) => [id, mixColor(from[id] ?? color, color, ease)])))
      }
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [signature, active, reduced, settings.followCover])
  const display = useMemo(() => ({ ...settings, color: colors.primary ?? settings.color,
    regions: settings.regions.map(region => ({ ...region, color: colors[region.id] ?? region.color })) }), [settings, colors])
  const message = !settings.followCover ? '使用固定配色'
    : !info.cover ? '等待歌曲封面，暂用固定配色'
    : !currentSample ? '正在读取封面配色…'
    : currentSample.failed ? '封面暂不可读，使用固定配色'
    : !accent ? '封面颜色不足，使用固定配色'
    : info.playing ? '灯效与音乐卡片跟随封面' : '暂停时柔和收敛'
  return { settings: display, cardColor: target ?? settings.color, message, available: !!accent }
}
