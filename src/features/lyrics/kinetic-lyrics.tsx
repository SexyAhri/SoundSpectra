import { useEffect, useRef } from "react";
import { activeLine, type LyricLine } from "./model";
import {
  KineticComposition,
  type CompositionMode,
} from "./kinetic-composition";
import type { LyricPalette } from "./lyric-palette";
import type { LyricFontStyle } from "./lyric-typography";
import { useLyricFont } from "./use-lyric-font";
import { quietLyricAudio, type LyricAudio } from "./lyric-audio";
import type { RenderQuality } from "../spectrum/model";
import { FrameBudget } from "../spectrum/render-budget";
import { lyricRenderBudget } from "./lyric-render-budget";
import { sceneData } from "../spectrum/three/scene-data";

type Props = {
  fontStyle?: LyricFontStyle;
  lines: LyricLine[];
  index: number;
  time: number;
  fontSize: number;
  regionWidth: number;
  mode: CompositionMode;
  reduced: boolean;
  quality?: RenderQuality;
  flow?: "flight" | "aurora" | "drift";
  backgroundOpacity?: number;
  palette?: LyricPalette;
  readability?: "soft" | "contrast";
  readTime?: () => number;
  readAudio?: () => Readonly<LyricAudio>;
  playing?: boolean;
  desktop?: boolean;
};
export function KineticLyrics(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    engine = useRef(new KineticComposition()),
    latest = useRef(props),
    requestDraw = useRef<() => void>(() => {});
  const fontsReady = useLyricFont(props.lines, props.fontStyle);
  latest.current = props;
  const ready = useRef(fontsReady);
  ready.current = fontsReady;
  useEffect(() => {
    const node = canvas.current!,
      context = node.getContext("2d");
    if (!context) return;
    let width = 0,
      height = 0,
      frame = 0,
      painted: unknown[] = [];
    const cadence = new FrameBudget();
    const readFrame = () => {
      const p = latest.current;
      if (
        !width ||
        !height ||
        !ready.current ||
        (!p.desktop && document.hidden)
      )
        return;
      const budget = lyricRenderBudget(p.quality, p.reduced);
      const scale = Math.min(
        devicePixelRatio || 1,
        budget.scale,
        Math.sqrt(budget.pixels / (width * height)),
        4096 / Math.max(width, height),
      );
      const pw = Math.max(1, Math.round(width * scale)),
        ph = Math.max(1, Math.round(height * scale));
      const time = p.readTime ? p.readTime() : p.time,
        index = p.readTime ? activeLine(p.lines, time) : p.index;
      const audio =
        !p.reduced && p.playing !== false
          ? (p.readAudio?.() ?? quietLyricAudio)
          : quietLyricAudio;
      // Media polling and accessibility updates must not repaint a paused lyric.
      const signature = [
        p.lines,
        time,
        index,
        p.fontSize,
        p.regionWidth,
        p.mode,
        p.fontStyle,
        p.reduced,
        p.backgroundOpacity ?? 30,
        p.palette,
        p.readability,
        p.quality,
        p.flow,
        width,
        height,
        pw,
        ph,
        audio.bass,
        audio.body,
        audio.treble,
        audio.energy,
        audio.impact,
        audio.beatAge,
        audio.beatStrength,
      ];
      if (signature.every((value, index) => Object.is(value, painted[index])))
        return;
      return { p, budget, scale, pw, ph, time, index, audio, signature };
    };
    const draw = () => {
      const next = readFrame();
      if (!next) return;
      const { p, budget, scale, pw, ph, time, index, audio, signature } = next;
      if (node.width !== pw || node.height !== ph) {
        node.width = pw;
        node.height = ph;
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
      engine.current.draw(context, {
        ...p,
        audio,
        time,
        index,
        width,
        height,
        backgroundOpacity: p.backgroundOpacity ?? 30,
      });
      painted = signature;
      sceneData(node, "time", String(Math.round(time)));
      sceneData(node, "composition", p.mode);
      sceneData(node, "line", String(index));
      sceneData(node, "backgroundOpacity", String(p.backgroundOpacity ?? 30));
      sceneData(node, "transition", String(engine.current.isTransitioning));
      sceneData(node, "fontStyle", p.fontStyle ?? "modern");
      sceneData(node, "fontsReady", "true");
      sceneData(node, "fontSize", String(p.fontSize));
      sceneData(node, "readability", p.readability ?? "soft");
      sceneData(node, "particles", String(engine.current.particles));
      sceneData(node, "quality", p.quality ?? "balanced");
      sceneData(node, "fps", String(budget.fps));
      if (import.meta.env.DEV)
        node.dataset.frames = String(Number(node.dataset.frames ?? 0) + 1);
      if (import.meta.env.DEV)
        sceneData(node, "audioImpact", audio.impact.toFixed(3));
    };
    const request = () => {
      if (frame || (!latest.current.desktop && document.hidden)) return;
      // Paused media polls can replace callbacks/props without changing pixels.
      // Keep those updates completely idle, including RAF scheduling.
      if ((!latest.current.readTime || latest.current.playing === false) && !readFrame())
        return;
      frame = requestAnimationFrame(tick);
    };
    const tick = (now: number) => {
      frame = 0;
      const p = latest.current;
      if (!p.desktop && document.hidden) return;
      const live = !!p.readTime && p.playing !== false;
      if (!live || cadence.due(now, lyricRenderBudget(p.quality, p.reduced).fps))
        draw();
      if (live && ready.current && width && height) request();
    };
    requestDraw.current = request;
    const measure = () => {
      width = node.clientWidth;
      height = node.clientHeight;
      request();
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      request();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      requestDraw.current = () => {};
    };
  }, []);
  // Resize, fonts, media props and playback all use one pending frame. A React
  // update must never add a second draw outside the renderer's frame budget.
  useEffect(() => requestDraw.current(), [props, fontsReady]);
  return (
    <canvas ref={canvas} className="kinetic-lyrics-canvas" aria-hidden="true" />
  );
}
