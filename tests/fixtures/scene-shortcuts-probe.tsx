import { createRoot } from 'react-dom/client'
import { useSceneShortcuts } from '../../src/features/preview/use-scene-shortcuts'
import { layout, writeLibrary } from '../../src/features/preview/scene-library'
import { defaults } from '../../src/features/spectrum/model'

export function mountShortcutsProbe(report: (message: string) => void) {
  function Probe() {
    useSceneShortcuts({ disabled: false, open() {}, show() {}, apply: async () => {}, report })
    return null
  }
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  root.render(<Probe />)
  return () => root.unmount()
}

export function saveShortcut(name: string) {
  writeLibrary([{ id: 'favorite', name, wallpaper: null, updated: Date.now(), scene: layout(defaults) }])
}
