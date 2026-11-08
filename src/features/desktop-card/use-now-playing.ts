import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { native } from '../spectrum/bridge'

export interface NowPlaying {
  title: string; artist: string; album: string; cover: string | null;
  position: number; duration: number; playing: boolean; source: string;
  processId: number | null; updated: number; issue: string | null;
  timelineAvailable?: boolean;
  timelineSource?: 'kugou-checkpoint' | 'player-accessibility' | 'netease-events';
  timelineValidUntil?: number;
  trackId?: string; playbackAvailable?: boolean;
  sessionId?: string;
  controls?: { previous: boolean; next: boolean; play: boolean; pause: boolean };
}
export const emptyNowPlaying: NowPlaying = { title: '', artist: '', album: '', cover: null, position: 0, duration: 0, playing: false, source: '', processId: null, updated: 0, issue: null }

export function useNowPlaying(active = true, desktop = false) {
  const [value, setValue] = useState<NowPlaying>(emptyNowPlaying)
  useEffect(() => {
    if (!native || !active) return
    let disposed = false, timer: ReturnType<typeof setTimeout>
    const read = async () => {
      if (desktop || !document.hidden) {
        try {
          const next = await invoke<NowPlaying>('get_now_playing')
          if (!disposed) setValue(next)
        } catch { if (!disposed) setValue({ ...emptyNowPlaying, issue: '播放器媒体信息暂不可用' }) }
      }
      if (!disposed) timer = setTimeout(read, 500)
    }
    void read()
    return () => { disposed = true; clearTimeout(timer) }
  }, [active, desktop])
  return value
}
