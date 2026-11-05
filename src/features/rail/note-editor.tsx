import { useEffect, useRef, useState } from 'react'
import { railFocusRequest } from './focus'
import type { RailItem } from './model'

interface Draft { base: string; text: string }
function readDraft(key: string, base: string): Draft {
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Draft | null
    if (stored && typeof stored.base === 'string' && typeof stored.text === 'string' && stored.text.length <= 2000) return stored
  } catch { /* Editing remains available when session storage is unavailable. */ }
  return { base, text: base }
}

export function NoteEditor({ item, draftKey, onSave, autoFocus = false }: { item?: RailItem; draftKey?: string; onSave: (text: string) => Promise<unknown>; autoFocus?: boolean }) {
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!autoFocus) return
    const focus = railFocusRequest()
    const frame = requestAnimationFrame(() => { focus.focus(input.current); focus.dispose() })
    return () => { cancelAnimationFrame(frame); focus.dispose() }
  }, [autoFocus])
  const key = `soundspectra.rail.note-draft.${item?.id ?? draftKey}`
  const saved = item?.text ?? ''
  const [draft, setDraft] = useState(() => readDraft(key, saved))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stored, setStored] = useState(() => { try { return !!sessionStorage.getItem(key) } catch { return false } })
  const dirty = draft.text !== draft.base
  const conflict = dirty && draft.base !== saved
  useEffect(() => {
    if (!dirty && draft.base !== saved) setDraft({ base: saved, text: saved })
  }, [saved, dirty, draft.base])
  const update = (next: Draft) => {
    setDraft(next)
    try {
      if (next.text !== next.base) sessionStorage.setItem(key, JSON.stringify(next))
      else sessionStorage.removeItem(key)
      setStored(next.text !== next.base)
    } catch { setStored(false) }
  }
  return <form className="rail-note-editor" onSubmit={event => {
    event.preventDefault()
    if (saving || !draft.text.trim() || conflict || (item && !dirty)) return
    setSaving(true); setError(null)
    void onSave(draft.text).then(() => update({ base: item ? draft.text.trim() : '', text: item ? draft.text.trim() : '' })).catch(reason => setError(String(reason))).finally(() => setSaving(false))
  }}>
    <label>便签内容<textarea ref={input} aria-label="便签内容" rows={5} maxLength={2000} value={draft.text} disabled={saving} placeholder="今天想记下什么？" onChange={event => update({ ...draft, text: event.target.value })} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} /></label>
    {conflict && <div className="rail-note-conflict" role="status">便签已在其他窗口更新，草稿仍保留。<div><button type="button" onClick={() => update({ base: saved, text: saved })}>使用最新内容</button><button type="button" onClick={() => update({ ...draft, base: saved })}>继续编辑草稿</button></div></div>}
    <div className="rail-note-draft-status"><span role="status">{dirty ? stored ? '草稿已保留' : '尚未保存' : item ? '已保存' : 'Ctrl + Enter 快速挂上'}</span>{dirty && <button type="button" disabled={saving} onClick={() => update({ base: saved, text: saved })}>放弃草稿</button>}</div>
    <div className="rail-note-editor-footer"><small>{draft.text.length} / 2000</small><button type="submit" className="rail-add-submit" title="Ctrl + Enter 保存" disabled={saving || !draft.text.trim() || conflict || (!!item && !dirty)}>{saving ? '正在保存…' : item ? '保存便签' : '挂上便签'}</button></div>
    {error && <p role="alert" className="rail-popup-error">{error}</p>}
  </form>
}
