import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function IconButton({ className, title, ...props }: ComponentProps<'button'> & { 'aria-label': string }) {
  return <button type="button" className={cn('toolbar-button', className)} title={title ?? props['aria-label']} {...props} />
}
