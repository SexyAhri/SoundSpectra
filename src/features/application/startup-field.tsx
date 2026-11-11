import { useEffect, useRef } from "react";

const ease = (from: number, to: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

// The envelope is identical on every strand and frame.
const wavePoints = Array.from({ length: 145 }, (_, index) => {
  const u = index / 144;
  return { u, edge: Math.pow(Math.sin(Math.PI * u), 1.3) };
});

/** A short, original sound-wave sequence. Owns no audio or WebGL resources. */
export function StartupField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let width = 0,
      height = 0,
      frame = 0,
      elapsed = 0;
    let previous = performance.now();
    let accent = "",
      ink = "";
    let gradientSpan = -1;
    let gradients: CanvasGradient[] = [];
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      width = box.width;
      height = box.height;
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      accent = getComputedStyle(canvas).color;
      ink = getComputedStyle(canvas.parentElement!).color;
      gradientSpan = -1;
    };
    const draw = (now: number) => {
      frame = 0;
      if (document.hidden) return;
      const dt = Math.max(0, now - previous);
      previous = now;
      elapsed += dt / 1000;
      const t = elapsed;
      const opening = ease(0, 0.65, t);
      const gather = ease(1.9, 3.25, t);
      const cx = width / 2,
        cy = height / 2 - Math.min(90, height * 0.18);
      const span =
        (width * 0.58 * (1 - gather) + Math.min(width * 0.37, 180) * gather) *
        opening;
      const amplitude =
        Math.min(height * 0.21, 165) * (1 - gather) + 18 * gather;
      ctx.clearRect(0, 0, width, height);
      if (span !== gradientSpan) {
        gradientSpan = span;
        gradients = [accent, ink].map((center) => {
          const gradient = ctx.createLinearGradient(
            cx - span,
            cy,
            cx + span,
            cy,
          );
          gradient.addColorStop(0, "transparent");
          gradient.addColorStop(0.28, accent);
          gradient.addColorStop(0.52, center);
          gradient.addColorStop(0.75, accent);
          gradient.addColorStop(1, "transparent");
          return gradient;
        });
      }

      // Traveling strands spread across the screen, then gather into the mark.
      for (let strand = 0; strand < 7; strand++) {
        ctx.beginPath();
        for (let i = 0; i < wavePoints.length; i++) {
          const { u, edge } = wavePoints[i];
          const x = cx + (u - 0.5) * span * 2;
          const wave =
            Math.sin(u * 12 - t * 4.8 + strand * 0.36) +
            Math.sin(u * 23 + t * 2.9 + strand * 0.7) * 0.23;
          const y =
            cy +
            wave * edge * amplitude * (0.45 + strand * 0.07) +
            (strand - 3) * (10 * (1 - gather) + 2.5);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = gradients[strand % 3 === 0 ? 1 : 0];
        ctx.lineWidth = strand === 3 ? 2.4 : 1.2;
        ctx.globalAlpha =
          opening *
          (0.26 + 0.13 * Math.sin(t * 2 + strand)) *
          (1 - gather * 0.6);
        ctx.stroke();
      }

      // Small signals visibly travel toward the same center throughout the intro.
      for (let i = 0; i < 48; i++) {
        const travel = (t * (0.18 + (i % 5) * 0.018) + i * 0.618) % 1;
        const side = i % 2 ? 1 : -1;
        const x = cx + side * (1 - travel) * width * 0.65;
        const spread = (1 - travel) * (1 - gather * 0.72);
        const y = cy + Math.sin(i * 2.4 + t * 0.9) * height * 0.35 * spread;
        ctx.globalAlpha = opening * Math.sin(travel * Math.PI) * 0.65;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(x, y, i % 7 === 0 ? 2.1 : 1.1, 0, Math.PI * 2);
        ctx.fill();
      }

      // Expanding echoes keep moving after the lettering has appeared.
      for (let i = 0; i < 3; i++) {
        const age = (t * 0.42 + i / 3) % 1;
        const radius = 45 + age * Math.min(width * 0.46, 370);
        ctx.globalAlpha = ease(1.8, 2.7, t) * (1 - age) * 0.22;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, radius, radius * 0.62, -0.18, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      canvas.dataset.time = t.toFixed(3);
      frame = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(resize);
    const visibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = performance.now();
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    observer.observe(canvas);
    document.addEventListener("visibilitychange", visibility);
    resize();
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return <canvas ref={ref} className="startup-field" aria-hidden="true" />;
}
