// Async panels may focus only while the user is still waiting for them.
export function railFocusRequest() {
  const origin = document.activeElement
  let cancelled = false
  const cancel = () => { cancelled = true }
  const changed = (event: FocusEvent) => { if (event.target !== origin) cancel() }
  document.addEventListener('pointerdown', cancel, true)
  document.addEventListener('keydown', cancel, true)
  document.addEventListener('focusin', changed, true)
  window.addEventListener('blur', cancel)
  return {
    focus(target: HTMLElement | null) {
      const unchanged = document.activeElement === origin || (!origin?.isConnected && document.activeElement === document.body)
      if (!cancelled && document.hasFocus() && unchanged && target?.isConnected) target.focus({ preventScroll: true })
    },
    dispose() {
      document.removeEventListener('pointerdown', cancel, true)
      document.removeEventListener('keydown', cancel, true)
      document.removeEventListener('focusin', changed, true)
      window.removeEventListener('blur', cancel)
    },
  }
}
