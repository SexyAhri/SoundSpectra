import type { ReactElement, ReactNode } from 'react'
import { ContextMenu as Menu } from 'radix-ui'
import './context-menu.css'

export interface ContextAction { id: string; label: string; icon?: ReactNode; disabled?: boolean; danger?: boolean; separator?: boolean; run: () => void }
export function ContextMenu({ children, title, actions, disabled, onOpenChange, onReturnFocus }: {
  children: ReactElement; title: string; actions: ContextAction[]; disabled?: boolean; onOpenChange?: (open: boolean) => void; onReturnFocus?: () => void;
}) {
  return <Menu.Root onOpenChange={onOpenChange}>
    <Menu.Trigger asChild disabled={disabled}>{children}</Menu.Trigger>
    <Menu.Portal><Menu.Content className="context-menu" collisionPadding={10} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus?.() }}>
      <Menu.Label className="context-menu-label">{title}</Menu.Label>
      {actions.map(action => <span key={action.id} className="context-menu-entry">
        {action.separator && <Menu.Separator className="context-menu-separator" />}
        <Menu.Item className="context-menu-item" disabled={action.disabled} data-danger={action.danger || undefined} onSelect={action.run}>
          {action.icon}<span>{action.label}</span>
        </Menu.Item>
      </span>)}
    </Menu.Content></Menu.Portal>
  </Menu.Root>
}
