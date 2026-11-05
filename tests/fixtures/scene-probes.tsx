import { createRoot } from 'react-dom/client'
import { AutoSceneDialog } from '../../src/features/preview/auto-scene-dialog'
import { defaults } from '../../src/features/spectrum/model'
import type { PreviewImage } from '../../src/features/preview/background'
import { useSettings } from '../../src/features/settings/use-settings'

const root = () => {
  const node = document.createElement('div'); document.body.append(node)
  return createRoot(node)
}
export function mountSceneProbe() {
  const app = root()
  return (image: PreviewImage) => app.render(<AutoSceneDialog settings={defaults} image={image} desktop={null}
    screen={{ x: 0, y: 0, width: 128, height: 72 }} available unavailableReason="" demo disabled={false}
    onClose={() => app.unmount()} onApply={async () => { throw new Error('Probe must not apply') }}
    renderPreview={settings => <output id="scene-probe">{JSON.stringify(settings)}</output>} />)
}
export function mountSettingsProbe(onChange: (settings: ReturnType<typeof useSettings>) => void) {
  function Probe() { const state = useSettings(); onChange(state); return null }
  root().render(<Probe />)
}
