import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { native } from '../spectrum/bridge'

interface Occlusion { occluded: boolean }

/** Subscribe before reading so a recreated WebView cannot miss the current state. */
export function useDesktopOcclusion() {
  const [occluded, setOccluded] = useState(false)
  useEffect(() => {
    if (!native) return
    let disposed = false, revision = 0
    let stop: (() => void) | undefined
    void listen<Occlusion>('desktop://occlusion_changed', event => {
      if (!disposed) { revision++; setOccluded(event.payload.occluded === true) }
    }).then(async unsubscribe => {
      if (disposed) { unsubscribe(); return }
      stop = unsubscribe
      const started = revision
      const value = await invoke<Occlusion>('get_desktop_occlusion')
      if (!disposed && started === revision) setOccluded(value.occluded === true)
    }).catch(() => { /* Older native hosts keep rendering. */ })
    return () => { disposed = true; stop?.() }
  }, [])
  return occluded
}
