import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { native } from "../bridge";
import { demoAnalysis, silentAnalysis } from "../music-analysis";
import { budgets, FrameBudget } from "../render-budget";
import type { SpectrumCanvasProps } from "../spectrum-canvas";
import { SceneMotion } from "./motion";
import {
  createThreeSceneRenderer,
  type ThreeSceneRenderer,
} from "./scene-renderer";
import { musicEffects, isClassicEffect } from "../music-engine/catalog";
import {
  defaultSceneView,
  normalizeSceneView,
  rotateSceneView,
  type SceneView,
} from "./view";
import { demoFeatures } from "../audio-feature-timeline";
import { useSceneFocus } from '../scene-focus';
import { regionStyle } from '../regions';
import { previewResizePending, settlePreviewResize } from '../../preview/resize-settling';
import { PerformanceFrame, usePerformance } from '../../performance/runtime';

export function ThreeSceneCanvas({
  settings,
  analysis,
  demo,
  desktop = false,
  active = true,
  suspended = false,
  regionCount = 1,
  className,
  interactive = !desktop,
  onViewChange,
  regionId = 'primary',
}: SpectrumCanvasProps) {
  const performanceController=usePerformance();
  const performanceCurrent=useRef(performanceController);performanceCurrent.current=performanceController;
  const regionCurrent=useRef(regionId);regionCurrent.current=regionId;
  const focus=useSceneFocus();
  // Media/status polling can recreate settings without changing the scene.
  // Compare visual values on prop updates, never serialize inside the RAF loop.
  const visualSignature = useMemo(() => JSON.stringify({
    ...regionStyle(settings), quality: settings.quality, masks: settings.masks,
  }), [settings]);
  const ref = useRef<HTMLCanvasElement>(null);
  const wake = useRef<(() => void) | undefined>(undefined);
  const current = useRef({
    settings,
    visualSignature,
    demo,
    active,
    suspended,
    regionCount,
    interactive,
    onViewChange,
  });
  const view = useRef(settings.view);
  const [error, setError] = useState<string | null>(null);
  const fatalEffect=useRef<string|null>(null);
  const [restart,setRestart]=useState(0);
  useEffect(()=>{if(fatalEffect.current&&fatalEffect.current!==settings.effect){fatalEffect.current=null;setRestart(value=>value+1)}},[settings.effect]);
  useEffect(() => {
    const wasSuspended = current.current.suspended;
    current.current = {
      settings,
      visualSignature,
      demo,
      active,
      suspended,
      regionCount,
      interactive,
      onViewChange,
    };
    if (wasSuspended !== suspended) wake.current?.();
  }, [settings, visualSignature, demo, active, suspended, regionCount, interactive, onViewChange]);
  useEffect(() => {
    view.current = settings.view;
  }, [settings.view]);
  useEffect(() => {
    const canvas = ref.current!,
      motion = new SceneMotion(),
      performanceFrame = new PerformanceFrame(),
      silence = silentAnalysis();
    let world: ThreeSceneRenderer | undefined,
      raf = 0,
      timer = 0,
      resizeTimer = 0,
      visibilityTimer = 0;
    let stopped = false,
      onscreen = true,
      nativeVisible = true,
      previous = 0,
      dormant = false,
      frames = 0,
      dirty = true,
      wasSilent = false;
    let resizePaused = false;
    let resizePending = false, resizeVersion = 0;
    let recoveryNotice = '';
    let occlusionDormant = false;
    const windowResizing = () => { if (!desktop) settlePreviewResize(); };
    if (!desktop) window.addEventListener('resize', windowResizing);
    let viewRaf = 0;
    let drag: {
      x: number;
      y: number;
      width: number;
      height: number;
      distance: number;
      sensitivity: number;
      view: SceneView;
      mode: "rotate" | "pan" | "roll";
    } | null = null;
    const flushView = () => {
      cancelAnimationFrame(viewRaf);
      viewRaf = 0;
      const signature = JSON.stringify(view.current);
      if (signature !== JSON.stringify(current.current.settings.view))
        current.current.onViewChange?.(view.current);
    };
    const publishView = (next: SceneView) => {
      view.current = normalizeSceneView(next);
      dirty = true;
      if (!viewRaf) viewRaf = requestAnimationFrame(flushView);
    };
    const fail = (reason: unknown) => {
      fatalEffect.current=current.current.settings.effect;
      stopped = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      clearTimeout(resizeTimer);
      motion.reset();
      setError(reason instanceof Error ? reason.message : String(reason));
    };
    const lost = (event: Event) => {
      event.preventDefault();
      fail(new Error("三维声场渲染已中断，请切换动效后重试。"));
    };
    canvas.addEventListener("webglcontextlost", lost);
    const down = (event: PointerEvent) => {
      if (
        !current.current.interactive ||
        !current.current.active ||
        ![0, 2].includes(event.button)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      const box = canvas.getBoundingClientRect();
      world?.hover?.(box.left + box.width / 2, box.top + box.height / 2);
      drag = {
        x: event.clientX,
        y: event.clientY,
        width: box.width,
        height: box.height,
        distance: 0,
        sensitivity: event.ctrlKey ? 0.2 : 1,
        view: { ...view.current },
        mode:
          event.button === 2 || event.shiftKey
            ? "pan"
            : event.altKey
              ? "roll"
              : "rotate",
      };
    };
    const move = (event: PointerEvent) => {
      if (!drag && current.current.interactive)
        world?.hover?.(event.clientX, event.clientY);
      if (!drag || !current.current.interactive) return;
      const dx = (event.clientX - drag.x) * drag.sensitivity,
        dy = (event.clientY - drag.y) * drag.sensitivity;
      drag.distance =
        Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y);
      if (drag.mode === "pan")
        publishView({
          ...drag.view,
          x: drag.view.x + (dx / drag.width) * 100,
          y: drag.view.y - (dy / drag.height) * 100,
        });
      else
        publishView(
          rotateSceneView(
            drag.view,
            drag.mode === "roll" ? 0 : (-dx / drag.width) * 120,
            drag.mode === "roll" ? 0 : (-dy / drag.height) * 120,
            drag.mode === "roll" ? (dx / drag.width) * 120 : 0,
          ),
        );
    };
    const release = (event: PointerEvent) => {
      if (!drag) return;
      if (
        drag.distance < 8 &&
        drag.mode === "rotate" &&
        current.current.interactive
      ) {
        const point = world?.hit(event.clientX, event.clientY);
        if (point) {
          motion.touch(point.x, point.z);
          dirty = true;
        }
      }
      flushView();
      drag = null;
      if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
    };
    const cancel = () => {
      if (drag) {
        publishView(drag.view);
        flushView();
      }
      drag = null;
    };
    const wheel = (event: WheelEvent) => {
      if (!current.current.interactive || !current.current.active) return;
      event.preventDefault();
      event.stopPropagation();
      const pixels =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? canvas.clientHeight
            : 1);
      publishView({
        ...view.current,
        distance:
          view.current.distance *
          Math.exp(Math.max(-300, Math.min(300, pixels)) * 0.0015),
      });
    };
    const context = (event: Event) => {
      if (current.current.interactive) event.preventDefault();
    };
    const key = (event: KeyboardEvent) => {
      if (!current.current.interactive || !current.current.active) return;
      if (event.key === "Escape" && drag) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      const dx =
        event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      const dy =
        event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
      let next = view.current;
      if (dx || dy)
        next = event.shiftKey
          ? { ...next, x: next.x + dx * 2, y: next.y + dy * 2 }
          : rotateSceneView(
              next,
              dx * (event.ctrlKey ? 1 : 5),
              -dy * (event.ctrlKey ? 1 : 5),
            );
      else if (event.key === "Home") next = { ...defaultSceneView };
      else if (event.key === "PageUp" || event.key === "PageDown")
        next = {
          ...next,
          distance: next.distance * (event.key === "PageUp" ? 0.9 : 1.1),
        };
      else if (
        event.key.toLowerCase() === "q" ||
        event.key.toLowerCase() === "e"
      )
        next = rotateSceneView(
          next,
          0,
          0,
          event.key.toLowerCase() === "q" ? -5 : 5,
        );
      else return;
      event.preventDefault();
      event.stopPropagation();
      publishView(next);
      flushView();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", cancel);
    canvas.addEventListener("lostpointercapture", cancel);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("contextmenu", context);
    canvas.addEventListener("keydown", key);
    let observer: ResizeObserver | undefined,
      intersection: IntersectionObserver | undefined;
    const initialize = () => {
      if (stopped) return;
      try {
        setError(null);
        world = createThreeSceneRenderer(
          canvas,
          current.current.settings.effect,
          fail,
        );
        const resize = (desired = current.current.settings) => {
          resizePending = true;
          if (!desktop && previewResizePending()) {
            clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(() => resize(desired), 48);
            return;
          }
          const version = ++resizeVersion;
          try {
            void world?.resize(
              desired,
              current.current.regionCount,
              {preview:!desktop,deferSceneChange:true,adaptive:desktop},
            ).catch(error => { if (!stopped) fail(error); }).finally(() => {
              if (!stopped && version === resizeVersion) {
                resizePending = false;
                dirty = true;
              }
            });
            dirty = true;
          } catch (error) {
            if (version === resizeVersion) resizePending = false;
            fail(error);
          }
        };
        observer = new ResizeObserver(() => {
          // Native maximize/restore emits a burst of intermediate sizes. CSS
          // stretches the last frame while GPU buffers settle once at the end.
          clearTimeout(resizeTimer);
          // Keep presentation held until the final buffer AND camera size are
          // committed. An expired native quiet timer alone is not sufficient.
          resizePending = true;
          resizeVersion++;
          resizeTimer = window.setTimeout(resize, 90);
        });
        observer.observe(canvas.parentElement!);
        resize();
        if (!desktop) {
          intersection = new IntersectionObserver((entries) => {
            onscreen = entries[0]?.isIntersecting ?? true;
          });
          intersection.observe(canvas);
          if (native) {
            const handle = getCurrentWindow();
            const visible = async () => {
              try {
                const [shown, minimized] = await Promise.all([
                  handle.isVisible(),
                  handle.isMinimized(),
                ]);
                nativeVisible = shown && !minimized;
              } catch {
                /* Closing window. */
              }
              if (!stopped) visibilityTimer = window.setTimeout(visible, 1000);
            };
            void visible();
          }
        }
        const reduced = matchMedia("(prefers-reduced-motion: reduce)"),
          budget = new FrameBudget();
        let config = current.current.settings,
          signature = current.current.visualSignature,
          count = current.current.regionCount,
          simulate = current.current.demo;
        let sourceGeneration = -1, focusRevision=-1;
        const later = (delay: number) => {
          timer = window.setTimeout(() => {
            if (!stopped) raf = requestAnimationFrame(draw);
          }, delay);
        };
        const draw = (now: number) => {
          if (stopped) return;
          try {
            const next = current.current;
            canvas.dataset.occluded = String(next.suspended);
            if (next.suspended) {
              if (!occlusionDormant) motion.reset(true);
              occlusionDormant = true;
              previous = 0;
              dirty = true;
              // No RAF or timer while covered; the visibility prop wakes this root.
              return;
            }
            if (occlusionDormant) {
              occlusionDormant = false;
              previous = 0;
              dirty = true;
            }
            if (
              !next.active ||
              (!desktop && (!onscreen || !nativeVisible || document.hidden))
            ) {
              if (!dormant) {
                motion.reset(true);
                world!.clear();
              }
              dormant = true;
              previous = 0;
              dirty = true;
              later(200);
              return;
            }
            dormant = false;
            if (
              !budget.due(
                now,
                reduced.matches ? 15 : budgets[next.settings.quality].fps,
              )
            ) {
              raf = requestAnimationFrame(draw);
              return;
            }
            const dt = previous
              ? Math.min(0.1, (now - previous) / 1000)
              : 1 / 60;
            previous = now;
            const performanceResult=performanceFrame.resolve(performanceCurrent.current,next.settings,regionCurrent.current,reduced.matches);
            const effective=performanceResult.settings;
            if (
              config.quality !== effective.quality ||
              config.effect !== effective.effect ||
              count !== next.regionCount
            ) {
              count = next.regionCount;
              resize(effective);
            }
            if (simulate !== next.demo) {
              simulate = next.demo;
              motion.reset(true);
              dirty = true;
            }
            if (signature !== next.visualSignature) {
              signature = next.visualSignature;
              dirty = true;
            }
            if(focusRevision!==(focus?.current.revision??0)) {
              focusRevision=focus?.current.revision??0;
              dirty=true;
            }
            config = performanceResult.settings;
            const audio = next.demo
              ? demoAnalysis(reduced.matches ? 1 : now / 1000)
              : analysis &&
                  analysis.current.receivedAt > 0 &&
                  now - analysis.current.receivedAt < 350
                ? analysis.current
                : silence;
            const timeline = analysis?.current.timeline;
            if (
              !next.demo &&
              timeline &&
              sourceGeneration !== timeline.generation
            ) {
              motion.reset(true);
              sourceGeneration = timeline.generation;
              dirty = true;
            }
            const shared =
              next.demo && !reduced.matches
                ? demoFeatures(now, config.music)
                : !next.demo
                  ? timeline?.sample(now, config.music)
                  : null;
            motion.step(audio, dt, config.music, reduced.matches, shared);
            // Do not clear or reset the scene: CSS retains the last frame while
            // native presentation changes size, and transport still follows audio.
            const paused = !desktop && (previewResizePending(now) || resizePending);
            if (resizePaused !== paused) dirty = true;
            resizePaused = paused;
            canvas.dataset.resizePaused = String(paused);
            const silent = motion.presence < 0.0001;
            let rendered=true;
            if (!silent || !wasSilent || dirty || canvas.dataset.transition !== 'idle' || performanceResult.changed) {
              rendered=world!.draw(
                motion,
                performanceResult.settings !== next.settings || view.current === config.view
                  ? config
                  : { ...config, view: view.current },
                reduced.matches,
                dt,
                focus?.current,
                paused,
                performanceResult,
              );
              const notice=canvas.dataset.transitionError??'';
              if(notice!==recoveryNotice){recoveryNotice=notice;setError(notice?`目标场景准备失败，已保留上一场景：${notice}`:null)}
              const signature = JSON.stringify(view.current);
              if (canvas.dataset.view !== signature)
                canvas.dataset.view = signature;
            }
            wasSilent = silent;
            dirty = paused || !rendered;
            if (++frames % 6 === 0) {
              canvas.dataset.rms = audio.rms.toFixed(4);
              canvas.dataset.drops = String(motion.musicDropCount);
              canvas.dataset.ripples = String(motion.ripples.length);
            }
            if (motion.presence < 0.0001 && !next.demo) later(100);
            else raf = requestAnimationFrame(draw);
          } catch (error) {
            fail(error);
          }
        };
        wake.current = () => {
          if (stopped) return;
          cancelAnimationFrame(raf);
          clearTimeout(timer);
          raf = requestAnimationFrame(draw);
        };
        canvas.dataset.renderer = "three";
        raf = requestAnimationFrame(draw);
      } catch (error) {
        fail(error);
      }
    };
    // StrictMode's probe cleanup runs before allocation, so one DOM canvas owns one root.
    queueMicrotask(initialize);
    return () => {
      stopped = true;
      wake.current = undefined;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(viewRaf);
      clearTimeout(timer);
      clearTimeout(resizeTimer);
      clearTimeout(visibilityTimer);
      window.removeEventListener('resize', windowResizing);
      observer?.disconnect();
      intersection?.disconnect();
      motion.reset();
      world?.dispose();
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", release);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("lostpointercapture", cancel);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("contextmenu", context);
      canvas.removeEventListener("keydown", key);
      const renderer = world?.renderer;
      queueMicrotask(() => {
        if (!canvas.isConnected) renderer?.forceContextLoss();
      });
    };
  }, [analysis, desktop, focus, restart]);
  const label =
    musicEffects.find((effect) => effect.value === settings.effect)?.label ??
    "三维声场";
  return (
    <div
      className={`spectrum-surface three-scene-surface ${settings.effect === "sound_field" ? "sound-field-surface" : isClassicEffect(settings.effect) ? "classic-scene-surface" : "ambient-scene-surface"} ${className ?? ""}`}
    >
      <canvas
        ref={ref}
        tabIndex={interactive ? 0 : undefined}
        style={{ width: '100%', height: '100%', touchAction: interactive ? "none" : undefined }}
        aria-label={`${label} · ${demo ? "模拟音频预览" : "真实音乐声场"}`}
      />
      {error && (
        <div className="render-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
