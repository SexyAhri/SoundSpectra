import { createElement } from 'react'
import { AlignCenterHorizontal, ChevronsDownUp, ChevronsUpDown, SlidersHorizontal } from 'lucide-react'
import type { ContextAction } from '@/components/ui/context-menu'
import type { RailController } from './use-rail'

export function railPlacementActions(controller: RailController, id: string, select: () => void): { title: string; actions: ContextAction[] } {
  const group = controller.settings.groups.find(group => group.id === id)
  if (!group) return { title: '拾光绳', actions: [] }
  const change = (patch: { x?: number; y?: number; collapsed?: boolean }) => { void controller.change({ type: 'group', id, ...patch }).catch(() => {}) }
  return { title: group.name, actions: [
    { id: 'settings', label: '调整拾光绳', icon: createElement(SlidersHorizontal), run: select },
    { id: 'center', label: '水平居中', icon: createElement(AlignCenterHorizontal), disabled: controller.pending > 0, separator: true, run: () => change({ x: (1 - group.width) / 2 }) },
    { id: 'collapse', label: group.collapsed ? '展开拾光绳' : '收起拾光绳', icon: createElement(group.collapsed ? ChevronsUpDown : ChevronsDownUp), disabled: controller.pending > 0, run: () => change({ collapsed: !group.collapsed }) },
  ] }
}
