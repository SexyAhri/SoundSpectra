import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { native } from '../spectrum/bridge'
import type { MusicAnalysis } from '../spectrum/music-analysis'
import { RailAudioSource } from './audio-source'

const source = new RailAudioSource()
let users = 0
let connection: { disposed: boolean; stop?: () => void } | undefined

export function useRailAudio(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !native) return
    if (++users === 1) {
      const current = { disposed: false } as NonNullable<typeof connection>
      connection = current
      void listen<MusicAnalysis>('music-analysis', ({ payload }) => {
        if (!current.disposed) source.push(payload, performance.now())
      }).then(stop => { if (current.disposed) stop(); else current.stop = stop })
        .catch(() => {})
    }
    return () => {
      if (--users === 0 && connection) {
        connection.disposed = true
        connection.stop?.()
        connection = undefined
        source.clear()
      }
    }
  }, [enabled])
  return source
}

export function useRailAudioStatus(enabled: boolean) {
  const source = useRailAudio(enabled)
  const [active, setActive] = useState(false)
  useEffect(() => {
    if (!enabled || !native) { setActive(false); return }
    const update = () => setActive(!!source.sample(performance.now()))
    update()
    const timer = window.setInterval(update, 250)
    return () => clearInterval(timer)
  }, [enabled, source])
  return !native ? '桌面端可接收音乐' : active ? '正在接收音频' : '等待音频'
}
