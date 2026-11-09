// Per WebView, transient state only. Keep the last canvas image while the native
// window and its compositor resize; music clocks keep advancing independently.
let nativeActions = 0;
let quietUntil = 0;
// Local timing only; the developer HUD reads these without polling native IPC.
export const previewResizeMetrics = { nativeMs: 0, requests: 0, pending: 0 };
export function settlePreviewResize(milliseconds = 160) {
  quietUntil = Math.max(quietUntil, performance.now() + milliseconds);
}
export function previewResizePending(now = performance.now()) {
  return nativeActions > 0 || now < quietUntil;
}
export async function withPreviewResize<T>(
  operation: () => Promise<T>,
): Promise<T> {
  nativeActions++;
  previewResizeMetrics.pending = nativeActions;
  previewResizeMetrics.requests++;
  try {
    // Yield before the native request so the previous submitted frame can drain.
    // A timer also completes if the window becomes hidden between click and IPC.
    await new Promise<void>((resolve) => setTimeout(resolve, 32));
    const started = performance.now();
    try {
      return await operation();
    } finally {
      previewResizeMetrics.nativeMs = performance.now() - started;
    }
  } finally {
    nativeActions--;
    previewResizeMetrics.pending = nativeActions;
    settlePreviewResize();
  }
}
