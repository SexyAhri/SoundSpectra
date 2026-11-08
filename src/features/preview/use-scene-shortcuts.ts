import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { native } from '../spectrum/bridge'
import { desktopPresets } from './desktop-scenes'
import { readLibrary, rememberScene, type SceneLayout } from './scene-library'

export function useSceneShortcuts(options: {
  disabled: boolean; open: () => void; show: () => void;
  apply: (scene: SceneLayout) => Promise<void>; report: (message: string) => void;
}) {
  const current = useRef(options)
  current.current = options
  useEffect(() => {
    if (!native) return
    let disposed = false, applying = false, stop: (() => void) | undefined
    let syncing = false, pending = false, retries = 0, retryTimer: number | undefined
    const sync = async () => {
      pending = true
      if (disposed || syncing) return
      window.clearTimeout(retryTimer)
      syncing = true
      try {
        while (pending && !disposed) {
          pending = false
          const entries = readLibrary().sort((a, b) => (b.usedAt ?? b.updated) - (a.usedAt ?? a.updated))
            .slice(0, 3).map(({ id, name }) => ({ id, name }))
          try {
            await invoke('sync_scene_shortcuts', { entries })
            retries = 0
          } catch (error) {
            if (disposed) return
            // The settings webview can load before the native tray is registered.
            if (String(error) === '托盘尚未就绪，请稍后重试' && retries < 5) {
              retryTimer = window.setTimeout(() => { void sync() }, 250 * 2 ** retries++)
              return
            }
            current.current.report(`托盘收藏更新失败：${String(error)}`)
          }
        }
      } catch { /* The collection dialog owns recovery of malformed saved data. */ }
      finally { syncing = false }
    }
    sync()
    window.addEventListener('scene-library-changed', sync)
    void listen<string>('scene-shortcut', async event => {
      if (disposed) return
      current.current.show()
      if (event.payload === 'library') { current.current.open(); return }
      if (current.current.disabled || applying) { current.current.report('设置正在处理，请稍后切换桌面方案。'); return }
      applying = true
      try {
        const choice = event.payload.startsWith('favorite:')
          ? readLibrary().find(value => value.id === event.payload.slice(9))
          : desktopPresets.find(value => value.id === event.payload)
        if (!choice) throw Error('这份收藏已移除，请打开场景收藏重新选择。')
        await current.current.apply(choice.scene)
        try { rememberScene(choice.id, choice.name) }
        catch { current.current.report('方案已应用，最近使用记录未能保存。') }
      } catch (error) { current.current.report(String(error)) }
      finally { applying = false }
    }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten }).catch(error => current.current.report(String(error)))
    return () => { disposed = true; window.clearTimeout(retryTimer); stop?.(); window.removeEventListener('scene-library-changed', sync) }
  }, [])
}
