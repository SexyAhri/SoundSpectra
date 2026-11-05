import { useEffect, useRef, useState } from 'react'
import { Headphones, RefreshCw } from 'lucide-react'
import { ChoiceSelect } from '@/components/ui/choice-select'
import { Button } from '@/components/ui/button'
import { native } from '../spectrum/bridge'
import type { RuntimeStatus } from '../spectrum/model'
import { getAudioSources, setAudioSource, sourceOptions, sourceKey, sourceFromKey, type AudioSource, type AudioSources } from './audio-sources'
import './audio-source.css'

export function AudioSourcePanel({ status, active }: { status: RuntimeStatus; active: boolean }) {
  const [snapshot, setSnapshot] = useState<AudioSources | null>(null)
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState(0)
  const pending = useRef(false), revision = useRef(0), mounted = useRef(false)
  const lastAttempt = useRef<AudioSource | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!active) return
    let cancelled = false, timer: ReturnType<typeof setTimeout>
    const read = async () => {
      const epoch = revision.current
      if (!pending.current && !document.hidden) {
        try {
          const next = await getAudioSources()
          if (!cancelled && epoch === revision.current && !pending.current) {
            setSnapshot(next)
            if (!lastAttempt.current) setError(null)
          }
        } catch (reason) { if (!cancelled && epoch === revision.current) setError(String(reason)) }
      }
      if (!cancelled) timer = setTimeout(read, 2000)
    }
    void read()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [active, retry])
  const save = async (selection: AudioSource) => {
    if (pending.current) return
    pending.current = true; revision.current++; lastAttempt.current = selection
    setSaving(true); setError(null)
    try {
      const saved = await setAudioSource(selection)
      if (mounted.current) {
        setSnapshot(current => current ? { ...current, selection: saved, error: null } : current)
        lastAttempt.current = null; setError(null); setRetry(value => value + 1)
      }
    } catch (reason) { if (mounted.current) setError(`音源保存失败：${String(reason)}`) }
    finally { pending.current = false; if (mounted.current) setSaving(false) }
  }
  const running = status.state === 'listening'
  const message = !native ? '仅预览设置' : saving ? '正在切换' : status.state === 'error' ? '连接异常'
    : status.state === 'connecting' ? '连接中' : running ? '正在播放' : status.state === 'silent' ? '已连接 · 静音' : '等待启动'
  const problem = error ?? snapshot?.error ?? (native && status.state === 'error' ? status.message : null)
  return <section className="source-section audio-source-panel" aria-label="音频来源">
    <Headphones size={18} className="source-icon" />
    <div className="audio-source-choice"><span>音乐来源</span>
      {snapshot ? <ChoiceSelect label="音乐来源" value={sourceKey(snapshot.selection)} options={sourceOptions(snapshot)} disabled={saving} onChange={value => void save(sourceFromKey(value))} />
        : <span className="source-placeholder">正在读取…</span>}
    </div>
    <span className={`source-status ${running && native ? 'connected' : ''}`} title={status.message} role="status"><span />{native && status.sourceName ? `${status.sourceName} · ` : ''}{message}</span>
    {problem && <div className="audio-source-message"><p role="alert">{problem}</p>
      {snapshot?.error ? <Button size="sm" variant="ghost" disabled={saving} onClick={() => void save({ mode: 'auto' })}>备份并使用自动识别</Button>
        : <Button size="sm" variant="ghost" disabled={saving} onClick={() => lastAttempt.current ? void save(lastAttempt.current) : setRetry(value => value + 1)}><RefreshCw size={12} />重试音源</Button>}</div>}
    {snapshot?.discovery.warning && <p className="audio-source-message">{snapshot.discovery.warning}</p>}
    {snapshot?.selection.mode === 'process' && <p className="audio-source-message">采集所选应用及子进程；若选择浏览器，会包含该进程树内其他标签页的声音。</p>}
  </section>
}
