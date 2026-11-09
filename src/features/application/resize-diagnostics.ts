// Opt-in local developer HUD. No network, persisted settings or audio changes.
import { previewResizeMetrics } from "../preview/resize-settling";
let panel: HTMLPreElement | undefined;
let raf = 0,
  previous = 0,
  gap = 0,
  longTask = 0,
  resizes = 0,
  until = 0;
const observer = new PerformanceObserver((list) => {
  if (panel && performance.now() < until)
    for (const entry of list.getEntries())
      longTask = Math.max(longTask, entry.duration);
});
observer.observe({ type: "longtask", buffered: false });
function tick(now: number) {
  if (!panel) return;
  if (previous && now < until) gap = Math.max(gap, now - previous);
  previous = now;
  const canvases = [
    ...document.querySelectorAll<HTMLCanvasElement>(
      'canvas[data-renderer="three"]',
    ),
  ];
  panel.textContent =
    `Resize diagnostics · F8 close\nRAF max gap ${gap.toFixed(1)} ms · long task ${longTask.toFixed(1)} ms · resize events ${resizes}\n` +
    `native request ${previewResizeMetrics.nativeMs.toFixed(1)} ms · pending ${previewResizeMetrics.pending}\n` +
    canvases
      .map(
        (c) =>
          `${c.dataset.scene} · ${c.width}×${c.height} · context ${c.dataset.contextId} · preparations ${c.dataset.preparations} · programs ${c.dataset.programs}\nCPU submit ${c.dataset.frameMs} ms · GPU ${c.dataset.gpuMs ?? "—"} ms (${c.dataset.gpuTiming ?? "off"})\nvisual scale ${c.dataset.renderScale ?? "1"} · FBO ${c.dataset.sceneBuffer ?? "—"} · occluded ${c.dataset.occluded ?? "false"}\nbuffer resize ${c.dataset.resizeMs} ms · first resized frame ${c.dataset.resizeFirstFrameMs ?? "—"} ms · resume ${c.dataset.resizeResumeMs ?? "—"} ms · held ${c.dataset.resizePaused}`,
      )
      .join("\n");
  raf = requestAnimationFrame(tick);
}
const reset = () => {
  gap = 0;
  longTask = 0;
  resizes = 0;
  until = performance.now() + 5000;
  previous = performance.now();
};
const resize = () => {
  if (panel) {
    resizes++;
    until = performance.now() + 3000;
  }
};
const click = (event: MouseEvent) => {
  if (panel && (event.target as Element).closest(".window-controls")) reset();
};
const key = (event: KeyboardEvent) => {
  if (event.key !== "F8") return;
  event.preventDefault();
  if (panel) {
    panel.remove();
    panel = undefined;
    cancelAnimationFrame(raf);
    return;
  }
  panel = document.createElement("pre");
  panel.style.cssText =
    "position:fixed;z-index:2147483647;left:85px;top:60px;background:#08131fee;color:#bdebd9;padding:16px;font:14px monospace;pointer-events:none;border:1px solid #608a90";
  document.body.append(panel);
  reset();
  raf = requestAnimationFrame(tick);
};
window.addEventListener("keydown", key);
window.addEventListener("resize", resize);
document.addEventListener("click", click, true);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    panel?.remove();
    cancelAnimationFrame(raf);
    observer.disconnect();
    window.removeEventListener("keydown", key);
    window.removeEventListener("resize", resize);
    document.removeEventListener("click", click, true);
  });
