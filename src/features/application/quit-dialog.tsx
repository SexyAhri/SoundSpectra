import { AlertDialog } from 'radix-ui'
import { useRef } from 'react'
import { LoaderCircle, Power } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  installing: boolean
  error: string | null
  onConfirm: () => void
}

export function QuitDialog({ open, onOpenChange, pending, installing, error, onConfirm }: Props) {
  const previousFocus = useRef<HTMLElement | null>(null)
  return <AlertDialog.Root open={open} onOpenChange={value => { if (!pending) onOpenChange(value) }}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="dialog-backdrop quit-backdrop" />
      <AlertDialog.Content className="quit-dialog"
        onOpenAutoFocus={() => { previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
        onCloseAutoFocus={event => { event.preventDefault(); if (previousFocus.current?.isConnected) previousFocus.current.focus() }}
        onEscapeKeyDown={event => { if (pending) event.preventDefault() }}>
        <span className="quit-dialog-icon" aria-hidden="true"><Power size={22} /></span>
        <AlertDialog.Title>退出 SoundSpectra？</AlertDialog.Title>
        <AlertDialog.Description>退出后，桌面拾光绳、灯效、歌词和音乐卡片将停止运行。退出前会保存当前配置。</AlertDialog.Description>
        {installing && <p className="quit-dialog-status" role="status">正在安装更新，请等待完成后再退出。</p>}
        {error && <p className="application-error" role="alert">{error}</p>}
        <footer>
          <AlertDialog.Cancel asChild><Button variant="outline" disabled={pending}>取消</Button></AlertDialog.Cancel>
          <Button variant="destructive" disabled={pending || installing} onClick={onConfirm}>{pending && <LoaderCircle size={14} className="spinning" />}{pending ? '正在保存并退出…' : '退出应用'}</Button>
        </footer>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>
}
