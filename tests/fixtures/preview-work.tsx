import { useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DesktopPreview } from '../../src/features/preview/desktop-preview'
import { defaults } from '../../src/features/spectrum/model'
import { silentAnalysis } from '../../src/features/spectrum/music-analysis'
import { emptyNowPlaying, type NowPlaying } from '../../src/features/desktop-card/use-now-playing'
import type { RailGroup } from '../../src/features/rail/model'
import type { RailController } from '../../src/features/rail/use-rail'
import '../../src/index.css'
import '../../src/features/rail/rail.css'

const probe = { reads: 0, dropWrites: 0, leafWrites: 0, swayWrites: 0, selection: '', select: null as null | [string, string | undefined] }
Object.assign(window, { previewWork: probe })
const initialGroup: RailGroup = {
  id: 'work', name: '渲染检查', x: .02, y: .06, width: .96, collapsed: false, skin: 'floral',
  audioSync: { enabled: true, amount: 50, profile: 'gentle' },
  items: Array.from({ length: 48 }, (_, index) => ({ id: `item-${index}`, name: `挂件 ${index}`, kind: 'note', text: '布局与绳线检查', path: '', crop: 'cover' })),
}
const settings = { ...structuredClone(defaults), regionVisible: false }
const noop = () => {}
function Fixture() {
  const [info, setInfo] = useState<NowPlaying>({ ...emptyNowPlaying, title: 'Initial song' })
  const [group, setGroup] = useState(initialGroup)
  const [active, setActive] = useState(true)
  const [arrangeRequest, arrange] = useState(0)
  Object.assign(probe, { media: (patch: Partial<NowPlaying>) => setInfo(current => ({ ...current, ...patch, updated: Date.now() })),
    group: (patch: Partial<RailGroup>) => setGroup(current => ({ ...current, ...patch })),
    active: setActive, arrange: () => arrange(value => value + 1) })
  const controller = useMemo(() => ({
    settings: { version: 1, enabled: true, groups: [group] }, loaded: true, pending: 0, error: null,
    desktopError: null, supported: true, missing: [], refresh: async () => {}, flush: async () => {},
    change: async () => {}, add: async () => {}, pasteImage: async () => {}, detach: async () => {}, pick: async () => {},
  }) as RailController, [group])
  const bands = useRef(new Float32Array(48)), receivedAt = useRef(0), analysis = useRef({ ...silentAnalysis(), receivedAt: 0 })
  return <DesktopPreview settings={settings} update={noop} commitScene={async () => settings}
    bands={bands} receivedAt={receivedAt} analysis={analysis} demo={false} onDemoChange={noop}
    running={false} disabled={false} active={active} ready selectedRegion="primary" onSelectRegion={noop}
    arrangeRequest={arrangeRequest} nowPlaying={info} rail={controller} selectedRail="item-0"
    onSelectRail={(groupId, itemId) => { probe.selection = info.title; probe.select = [groupId, itemId] }} />
}
createRoot(document.getElementById('root')!).render(<Fixture />)
