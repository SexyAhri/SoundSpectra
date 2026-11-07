import type { SpectrumSettings } from '../spectrum/model'

type Snapshot = Omit<SpectrumSettings, 'version' | 'enabled' | 'quality'>
const capture = ({ version: _version, enabled: _enabled, quality: _quality, ...display }: SpectrumSettings): Snapshot => structuredClone(display)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Display edits only: output switches, quality and private lyric paths stay live. */
export class SettingsHistory {
  private past: Snapshot[] = []
  private future: Snapshot[] = []
  private group = ''
  private changedAt = 0
  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }
  clear() { this.past = []; this.future = []; this.group = ''; this.changedAt = 0 }
  record(before: SpectrumSettings, after: SpectrumSettings, transaction = false, now = Date.now()) {
    // Image storage replaces its bitmap. Old revisions cannot restore that bitmap.
    if (before.wallpaperDepth.revision !== after.wallpaperDepth.revision) { this.clear(); return }
    const previous = capture(before), next = capture(after)
    const keys = (Object.keys(previous) as (keyof Snapshot)[]).filter(key => !same(previous[key], next[key]))
    if (!keys.length) return
    const signature = keys.join(',')
    if (transaction || signature !== this.group || now - this.changedAt > 450 || this.future.length || !this.past.length) {
      this.past.push(previous)
      if (this.past.length > 50) this.past.shift()
    }
    this.future = []; this.group = transaction ? '' : signature; this.changedAt = now
  }
  private restore(snapshot: Snapshot, current: SpectrumSettings): Partial<SpectrumSettings> {
    return { ...structuredClone(snapshot), lyrics: { ...snapshot.lyrics, folder: current.lyrics.folder },
      wallpaperDepth: { ...snapshot.wallpaperDepth, revision: current.wallpaperDepth.revision } }
  }
  undo(current: SpectrumSettings) {
    const previous = this.past.pop()
    if (!previous) return null
    this.future.push(capture(current)); this.group = ''
    return this.restore(previous, current)
  }
  redo(current: SpectrumSettings) {
    const next = this.future.pop()
    if (!next) return null
    this.past.push(capture(current)); this.group = ''
    return this.restore(next, current)
  }
}
