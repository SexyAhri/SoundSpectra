import type { ComponentProps } from 'react'
import { Dialog } from 'radix-ui'

/** Keep focus, escape, saving locks and close behavior owned by the calling feature. */
export function ModalContent(props: ComponentProps<typeof Dialog.Content>) {
  return <Dialog.Portal><Dialog.Overlay className="dialog-backdrop" /><Dialog.Content {...props} /></Dialog.Portal>
}
