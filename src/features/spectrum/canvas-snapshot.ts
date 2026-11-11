// Redraw WebGL on demand immediately before a DOM capture reads its canvas.
// Normal rendering keeps preserveDrawingBuffer disabled.
const redraws = new WeakMap<HTMLCanvasElement, () => void>();

export function registerCanvasSnapshot(canvas: HTMLCanvasElement, redraw: () => void) {
  redraws.set(canvas, redraw);
  return () => { if (redraws.get(canvas) === redraw) redraws.delete(canvas); };
}

export function refreshCanvasSnapshot(canvas: HTMLCanvasElement) {
  redraws.get(canvas)?.();
}
