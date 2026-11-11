import { useEffect, useRef, type RefObject } from "react";
import { BAND_COUNT } from "../spectrum/model";
import { demoSpectrum } from "../spectrum/spectrum-motion";

export function LiveMeter({
  bands,
  receivedAt,
  demo = false,
  active = true,
  desktop = false,
  className = "",
}: {
  bands: RefObject<Float32Array>;
  receivedAt: RefObject<number>;
  demo?: boolean;
  active?: boolean;
  desktop?: boolean;
  className?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!active) return;
    const nodes = ref.current!.querySelectorAll<SVGRectElement>("rect");
    const source = new Float32Array(BAND_COUNT),
      levels = new Float32Array(nodes.length);
    let stopped = false,
      raf = 0,
      timer = 0,
      last = 0,
      visible = true;
    const request = () => {
      if (!stopped && visible && (desktop || !document.hidden) && !raf)
        raf = requestAnimationFrame(frame);
    };
    const frame = (now: number) => {
      raf = 0;
      if (stopped || !visible || (!desktop && document.hidden)) return;
      if (now - last < 1000 / 30) {
        request();
        return;
      }
      const elapsed = Math.min(0.1, (now - last) / 1000 || 1 / 30);
      last = now;
      if (demo) demoSpectrum(source, now / 1000);
      else if (receivedAt.current > 0 && now - receivedAt.current < 350)
        source.set(bands.current);
      else source.fill(0);
      let moving = false;
      nodes.forEach((node, i) => {
        const value = source[Math.floor((i / nodes.length) * BAND_COUNT)];
        const target = Number.isFinite(value)
          ? Math.pow(Math.max(0, Math.min(1, value)), 1.6)
          : 0;
        levels[i] +=
          (target - levels[i]) *
          (1 - Math.exp(-elapsed / (target > levels[i] ? 0.04 : 0.18)));
        if (target === 0 && levels[i] < 0.0001) levels[i] = 0;
        if (target > 0 || levels[i] > 0) moving = true;
        const height = 1 + levels[i] * 33;
        const h = height.toFixed(2),
          y = (36 - height).toFixed(2);
        if (node.getAttribute("height") !== h) node.setAttribute("height", h);
        if (node.getAttribute("y") !== y) node.setAttribute("y", y);
      });
      // Settle to the baseline once, then poll cheaply for fresh audio like the scene canvas.
      if (!demo && !moving)
        timer = window.setTimeout(() => {
          timer = 0;
          request();
        }, 100);
      else request();
    };
    const wake = () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      raf = 0;
      timer = 0;
      request();
    };
    // Visibility events resume the meter; an invisible surface needs no polling.
    const observer = new IntersectionObserver((entries) => {
      const next = entries[0]?.isIntersecting ?? true;
      if (next === visible) return;
      visible = next;
      wake();
    });
    observer.observe(ref.current!);
    document.addEventListener("visibilitychange", wake);
    request();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", wake);
    };
  }, [bands, receivedAt, demo, active, desktop]);
  return (
    <svg
      ref={ref}
      viewBox="0 0 160 40"
      className={`live-meter ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: 20 }, (_, i) => (
        <rect
          key={i}
          x={i * 8}
          y="35"
          width="5"
          height="1"
          rx="1"
          style={{ fill: i > 15 ? "#ffb66b" : i > 8 ? "#c8e78b" : "#79d8bf" }}
        />
      ))}
    </svg>
  );
}
