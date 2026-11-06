import { AlignCenterHorizontal, AlignCenterVertical, ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, Copy, Eye, EyeOff, SlidersHorizontal, Trash2 } from 'lucide-react'
import { createElement } from 'react'
import type { ContextAction } from '@/components/ui/context-menu'
import { MAX_REGIONS, type SettingsUpdate, type SpectrumSettings } from '../spectrum/model'
import { regionPatch, sceneRegions, settingsForRegion } from '../spectrum/regions'
import { duplicateRegion, moveLayer, removeRegion, sceneLayers, type LayerMove } from './scene-layers'

export function previewObjectActions(settings: SpectrumSettings, key: string, update: SettingsUpdate, select: (key: string) => void): { title: string; actions: ContextAction[] } {
  const id = key.startsWith('effect:') ? key.slice(7) : null
  const region = id ? sceneRegions(settings).find(region => region.id === id) : undefined
  const title = region?.name ?? (key === 'lyrics' ? '歌词' : '音乐卡片')
  const order = sceneLayers(settings), position = order.indexOf(key)
  const enabled = region ? region.visible : key === 'lyrics' ? settings.lyrics.enabled : settings.desktopCard.enabled
  const boundsPatch = (axis: 'x' | 'y') => update(current => {
    const b = id ? settingsForRegion(current, id).bounds : key === 'lyrics' ? current.lyrics.bounds : current.desktopCard.bounds
    const bounds = { ...b, [axis]: (1 - (axis === 'x' ? b.width : b.height)) / 2 }
    return id ? regionPatch(current, id, { bounds }) : key === 'lyrics' ? { lyrics: { ...current.lyrics, bounds } } : { desktopCard: { ...current.desktopCard, bounds } }
  })
  const moves: [LayerMove, string, typeof ArrowUp][] = [['up', '上移一层', ArrowUp], ['down', '下移一层', ArrowDown], ['front', '置于顶层', ChevronsUp], ['back', '置于底层', ChevronsDown]]
  const actions: ContextAction[] = [
    { id: 'settings', label: '调整此区域', icon: createElement(SlidersHorizontal), run: () => select(key) },
    { id: 'center-x', label: '水平居中', icon: createElement(AlignCenterHorizontal), separator: true, run: () => boundsPatch('x') },
    { id: 'center-y', label: '垂直居中', icon: createElement(AlignCenterVertical), run: () => boundsPatch('y') },
    ...moves.map(([move, label, icon], i) => ({ id: move, label, icon: createElement(icon), separator: i === 0,
      disabled: position < 0 || ((move === 'up' || move === 'front') ? position === order.length - 1 : position === 0), run: () => update(current => moveLayer(current, key, move)) })),
    { id: 'visibility', label: enabled ? '隐藏' : '显示', icon: createElement(enabled ? EyeOff : Eye), separator: true, run: () => update(current =>
      id === 'primary' ? { regionVisible: !current.regionVisible }
        : id ? { regions: current.regions.map(item => item.id === id ? { ...item, visible: !item.visible } : item) }
          : key === 'lyrics' ? { lyrics: { ...current.lyrics, enabled: !current.lyrics.enabled } } : { desktopCard: { ...current.desktopCard, enabled: !current.desktopCard.enabled } }) },
  ]
  if (region && id) actions.push(
    { id: 'copy', label: '复制区域', icon: createElement(Copy), disabled: settings.regions.length >= MAX_REGIONS - 1, run: () => {
      const nextId = crypto.randomUUID(); update(current => duplicateRegion(current, id, nextId)); select(`effect:${nextId}`)
    } },
    { id: 'remove', label: '删除区域', icon: createElement(Trash2), danger: true, disabled: !settings.regions.length, run: () => { update(current => removeRegion(current, id)); select('effect:primary') } },
  )
  return { title, actions }
}
