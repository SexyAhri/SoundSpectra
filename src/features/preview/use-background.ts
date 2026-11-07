import { useCallback, useEffect, useRef, useState } from 'react'
import { native, describeError } from '../spectrum/bridge'
import { decodePreview, loadDesktopBackground, readReference, referenceImage, type DesktopBackground, type PreviewImage } from './background'

type Mode = 'desktop' | 'plain' | 'custom'
const key = 'soundspectra.preview.background'
export function useBackground(enabled = true) {
  const [mode, setMode] = useState<Mode>(() => {
    try { const value = localStorage.getItem(key); return value === 'plain' || value === 'custom' ? value : 'desktop' } catch { return 'desktop' }
  })
  const [desktop, setDesktop] = useState<DesktopBackground | null>(null)
  const [wallpaper, setWallpaper] = useState<PreviewImage | null>(null)
  const [custom, setCustom] = useState<PreviewImage | null>(null)
  const [loading, setLoading] = useState(native)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const revision = useRef(''), sequence = useRef(0), lastRead = useRef(0), mounted = useRef(false), importingRef = useRef(false)
  const reading = useRef(false)
  const modeRevision = useRef(0), imageRevision = useRef(0)
  const refresh = useCallback(async (quiet = false) => {
    if (!native || reading.current) return
    reading.current = true
    const request = ++sequence.current
    lastRead.current = Date.now()
    if (!quiet) setLoading(true)
    try {
      const next = await loadDesktopBackground(revision.current)
      if (!mounted.current || request !== sequence.current) return
      setDesktop({ ...next, image: null })
      const changed = next.revision !== revision.current
      const image = changed && next.image ? await decodePreview(next.image) : null
      if (!mounted.current || request !== sequence.current) return
      setError(next.issue)
      if (next.issue || changed) setWallpaper(image)
      revision.current = next.issue ? '' : next.revision
      lastRead.current = Date.now()
    } catch (reason) {
      if (!mounted.current || request !== sequence.current) return
      setError(describeError(reason)); setWallpaper(null); revision.current = ''
    } finally { if (mounted.current && request === sequence.current) { reading.current = false; setLoading(false) } }
  }, [])
  useEffect(() => {
    if (!enabled) { setLoading(false); return }
    mounted.current = true
    let disposed = false
    const initialImageRevision = imageRevision.current
    void refresh()
    void referenceImage().then(image => { if (!disposed && image && imageRevision.current === initialImageRevision) setCustom(image) }).catch(reason => { if (!disposed) setFileError(`参考图片读取失败：${describeError(reason)}`) })
    const focus = () => { if (!document.hidden && Date.now() - lastRead.current > 1000) void refresh(true) }
    const timer = window.setInterval(focus, 5000)
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => { disposed = true; mounted.current = false; sequence.current++; reading.current = false; window.clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus) }
  }, [refresh, enabled])
  const choose = (value: Mode) => {
    modeRevision.current++
    setMode(value); setFileError(null)
    try { localStorage.setItem(key, value) } catch { setFileError('预览背景选择未能保存，下次打开将使用默认背景。') }
  }
  const importFile = async (file: File) => {
    if (importingRef.current) return
    const selectedAtStart = modeRevision.current
    imageRevision.current++
    importingRef.current = true; setImporting(true); setFileError(null)
    try {
      const image = await readReference(file)
      if (!mounted.current) return
      await referenceImage(image)
      if (!mounted.current) return
      setCustom(image)
      if (selectedAtStart === modeRevision.current) choose('custom')
    } catch (reason) { if (mounted.current) setFileError(describeError(reason)) }
    finally { importingRef.current = false; if (mounted.current) setImporting(false) }
  }
  return { mode, choose, desktop, systemImage: wallpaper, image: mode === 'desktop' ? wallpaper : mode === 'custom' ? custom : null, custom, loading, importing, error, fileError, refresh, importFile }
}
