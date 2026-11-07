import { useEffect, useRef, useState } from 'react'
import type { NowPlaying } from './use-now-playing'

export const cardTrackKey = (info: NowPlaying) => info.trackId || [info.processId ?? '', info.source, info.title, info.artist, info.album, info.duration].join('\u001f')

export function useCardCover(info: NowPlaying) {
  const key = cardTrackKey(info)
  const [decoded, setDecoded] = useState<{ key: string; cover: string } | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    const ticket = ++generation.current
    if (!info.cover) return
    const image = new Image()
    image.src = info.cover
    let disposed = false
    void image.decode().then(() => {
      if (!disposed && ticket === generation.current) setDecoded({ key, cover: info.cover! })
    }).catch(() => {})
    return () => { disposed = true; image.src = '' }
  }, [key, info.cover])
  return decoded?.key === key && decoded.cover === info.cover ? decoded.cover : null
}
