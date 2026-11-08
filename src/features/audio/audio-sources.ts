import { invoke } from '@tauri-apps/api/core'
import { native } from '../spectrum/bridge'

export type AudioSource = { mode: 'auto' } | { mode: 'player'; id: string } | { mode: 'process'; executable: string }
export interface AudioTarget { pid: number; executable: string; name: string; playerId: string | null; audible: boolean }
export interface AudioSources {
  selection: AudioSource;
  error: string | null;
  catalog: { id: string; name: string }[];
  discovery: { targets: AudioTarget[]; warning: string | null };
}
export const previewCatalog = [
  ['qqmusic', 'QQ 音乐'], ['netease', '网易云音乐'], ['kugou', '酷狗音乐'],
  ['soda', '汽水音乐'],
].map(([id, name]) => ({ id, name }))
const key = 'soundspectra.audio-source.v1'
export const sourceKey = (source: AudioSource) => source.mode === 'auto' ? 'auto' : source.mode === 'player' ? `player:${source.id}` : `process:${source.executable}`
export const sourceFromKey = (value: string): AudioSource => value.startsWith('player:') ? { mode: 'player', id: value.slice(7) }
  : value.startsWith('process:') ? { mode: 'process', executable: value.slice(8) } : { mode: 'auto' }
export function sourceOptions(snapshot: AudioSources) {
  const targets = snapshot.discovery.targets
  const options = [{ value: 'auto', label: '自动识别', description: '跟随发声的音乐客户端' }, ...previewCatalog.map(player => ({
    value: `player:${player.id}`, label: player.name,
    description: targets.some(t => t.playerId === player.id && t.audible) ? '正在发声' : targets.some(t => t.playerId === player.id) ? '已启动' : '等待启动',
  }))]
  return options
}
function migrateSource(source: AudioSource): AudioSource {
  return source?.mode === 'process' || source?.mode === 'player' && ['kuwo', 'spotify', 'apple', 'itunes', 'foobar', 'musicbee', 'aimp'].includes(source.id) ? { mode: 'auto' } : source
}
function validSource(value: unknown): value is AudioSource {
  if (!value || typeof value !== 'object') return false
  const source = value as AudioSource
  return source.mode === 'auto' || source.mode === 'player' && previewCatalog.some(player => player.id === source.id)
}
export async function getAudioSources(): Promise<AudioSources> {
  if (native) {
    const snapshot = await invoke<AudioSources>('get_audio_sources')
    if (!snapshot?.catalog || !snapshot.discovery || !snapshot.selection) throw new Error('音源列表尚未就绪，请重试。')
    return { ...snapshot, selection: migrateSource(snapshot.selection) }
  }
  let selection: AudioSource = { mode: 'auto' }, error: string | null = null
  try {
    const saved = localStorage.getItem(key)
    if (saved) { const parsed = migrateSource(JSON.parse(saved)); if (!validSource(parsed)) throw new Error('配置无效'); selection = parsed }
  } catch { error = '音源设置读取失败，可重新选择；浏览器仅预览设置。' }
  return { selection, error, catalog: previewCatalog, discovery: { targets: [], warning: null } }
}
export async function setAudioSource(selection: AudioSource): Promise<AudioSource> {
  if (native) return invoke('set_audio_source', { selection })
  if (!validSource(selection)) throw new Error('音源无效，请重新选择。')
  const current = await getAudioSources()
  const raw = localStorage.getItem(key)
  if (current.error && raw !== null) localStorage.setItem(`${key}.backup.${Date.now()}`, raw)
  localStorage.setItem(key, JSON.stringify(selection))
  return selection
}
