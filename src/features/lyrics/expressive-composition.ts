import type { CompositionFrame } from "./kinetic-composition";
import { phrases, timedGlyphs, type TimedGlyph } from "./lyric-glyphs";
import { defaultLyricPalette, type LyricPalette } from "./lyric-palette";
import type { LyricLine } from "./model";
import { drawPrismaticLight } from "./prismatic-light";
import {
  lyricFont,
  lyricInk,
  lyricWeight,
  measureLyricGlyphs,
} from "./lyric-typography";
import { lyricRelease, lyricSpring } from "./lyric-motion";
import { GlyphDust } from "./glyph-dust";
import { lyricRenderBudget } from "./lyric-render-budget";
import { lyricAccent } from "./lyric-audio";

type Frame = CompositionFrame & { mode: "depth" | "stage" };
interface Glyph extends TimedGlyph {
  x: number;
  y: number;
  width: number;
  size: number;
  row: number;
  order: number;
  weight: number;
  baseline: number;
  opacity: number;
}
interface Row {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  glyphs: Glyph[];
}
interface Layout {
  rows: Row[];
  compact: boolean;
  font: number;
}
interface Cue {
  intro: number;
  exit: number;
  progress: number;
  opacity: number;
  index: number;
  pulse: number;
  age: number;
  release: number;
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
const pulseAt = (time: number, start: number) =>
  time >= start && time - start < 650 ? Math.exp(-(time - start) / 180) : 0;

function layout(
  ctx: CanvasRenderingContext2D,
  line: LyricLine,
  frame: Frame,
): Layout {
  const { width: w, height: h, mode } = frame,
    glyphs = timedGlyphs(line);
  const compact = h < w * 0.2,
    count = glyphs.filter((g) => !g.hidden && g.text.trim()).length;
  const groups = phrases(
    glyphs,
    compact || count < 6 ? 1 : mode === "stage" && count > 15 ? 3 : 2,
  );
  const factors = compact
    ? [1]
    : mode === "stage"
      ? groups.length === 3
        ? [0.82, 1.12, 0.94]
        : [0.86, 1.12]
      : [1, 0.92];
  const style = frame.fontStyle ?? "modern";
  const screen = (w / (1920 * frame.regionWidth)) * 2.35;
  const fitHeight =
    (h * (compact ? 0.66 : 0.68)) /
    (groups.length === 1 ? 1.1 : (groups.length - 1) * 1.55 + 1.25);
  const measure = (weights: number[]) => {
    const metrics = groups.map((group, r) =>
      measureLyricGlyphs(ctx, group, 96, style, mode, weights[r]),
    );
    const measures = metrics.map((items) => items.map((item) => item.advance));
    const widths = measures.map(
      (items, r) => (items.reduce((a, b) => a + b, 0) / 96) * factors[r],
    );
    const fitWidth =
      (w * (compact ? 0.81 : mode === "stage" ? 0.72 : 0.76)) /
      Math.max(1, ...widths);
    const largest = Math.min(72 * screen, fitWidth, fitHeight),
      smallest = Math.min(18 * screen, largest * 0.65);
    return {
      metrics,
      measures,
      widths,
      base: smallest + (largest - smallest) * clamp((frame.fontSize - 18) / 54),
    };
  };
  const first = measure(
    groups.map((_, r) =>
      lyricWeight(style, Math.min(frame.fontSize * screen, h * 0.26), mode, r),
    ),
  );
  const weights = groups.map((_, r) =>
    lyricWeight(style, first.base * factors[r], mode, r),
  );
  const { metrics, measures, widths, base } = measure(weights);
  const rows = groups.map((group, r) => {
    const size = base * factors[r],
      width = widths[r] * base;
    const x =
      compact || groups.length === 1
        ? (w - width) / 2
        : mode === "depth"
          ? r % 2
            ? w * 0.86 - width
            : w * 0.14
          : r % 2
            ? Math.max(w * 0.12, w * 0.87 - width)
            : w * (0.1 + (r === 2 ? 0.06 : 0));
    const y = h * 0.5 + (r - (groups.length - 1) / 2) * base * 1.55;
    let cursor = x;
    const placed = group.map((g, order) => {
      const width = (measures[r][order] / 96) * size;
      const metric = metrics[r][order];
      const item = {
        ...g,
        x: cursor + ((metric.leading + metric.width / 2) / 96) * size,
        y,
        width,
        size: size * metric.scale,
        weight: weights[r],
        baseline: (metric.baseline / 96) * size,
        opacity: metric.opacity,
        row: r,
        order,
      };
      cursor += width;
      return item;
    });
    return {
      text: group.map((g) => (g.hidden ? " " : g.text)).join(""),
      x,
      y,
      width,
      size,
      glyphs: placed,
    };
  });
  return { rows, compact, font: base };
}

/** Production scores use only supplied media time, including their handoffs and scenery. */
export class ExpressiveComposition {
  private cache = new Map<string, Layout>();
  private document?: LyricLine[];
  private dust = new GlyphDust();
  particles = 0;

  private layout(ctx: CanvasRenderingContext2D, line: LyricLine, frame: Frame) {
    const key = `${frame.fontStyle}:${frame.mode}:${frame.width}:${frame.height}:${frame.fontSize}:${frame.regionWidth}:${line.start}:${line.end}:${line.text}:${line.words.map((w) => `${w.start}/${w.end}/${w.text}`).join("|")}`;
    let result = this.cache.get(key);
    if (!result) {
      result = layout(ctx, line, frame);
      this.cache.set(key, result);
      for (const row of result.rows)
        for (const glyph of row.glyphs)
          if (!glyph.hidden && glyph.text.trim())
            this.dust.prepare(
              glyph.text,
              frame.fontStyle ?? "modern",
              glyph.weight,
            );
      if (this.cache.size > 4)
        this.cache.delete(this.cache.keys().next().value!);
    }
    return result;
  }

  draw(ctx: CanvasRenderingContext2D, input: CompositionFrame): boolean {
    if (input.mode === "stardust") return false;
    const frame = input as Frame,
      { lines, index, time, reduced } = frame;
    this.particles = 0;
    if (this.document !== lines) {
      this.cache.clear();
      this.dust.clear();
      this.document = lines;
    }
    const palette = frame.palette ?? defaultLyricPalette;
    const visible: { line: LyricLine; layout: Layout; cue: Cue }[] = [];
    for (const i of [index - 1, index, index + 1]) {
      const line = lines[i];
      if (!line) continue;
      const next = lines[i + 1],
        previous = lines[i - 1];
      // Preserve short musical breaths; clear the stage during a long instrumental gap.
      const end = next && next.start - line.end <= 1200 ? next.start : line.end;
      const lead = Math.min(
        760,
        Math.max(1, line.end - line.start) * 0.38,
        previous ? (line.start - previous.start) * 0.5 : 760,
      );
      const tail = 430;
      if (
        reduced
          ? time < line.start || time >= end
          : time < line.start - lead || time >= end + tail
      )
        continue;
      const current = i === index;
      const duration = Math.max(1, end - line.start);
      const intro = reduced
        ? 1
        : current
          ? 0.48 +
            0.52 * smooth((time - line.start) / Math.min(300, duration * 0.18))
          : smooth((time - line.start + lead) / lead);
      const release = reduced ? 0 : lyricRelease(line.start, end, time);
      const exit = reduced ? 0 : smooth(release) * 0.6;
      const opacity = reduced
        ? 1
        : 0.72 + 0.28 * smooth((time - line.start) / 180);
      const composition = this.layout(ctx, line, frame);
      if (!composition.rows.length) continue;
      const pulse = reduced
        ? 0
        : composition.rows.reduce(
            (peak, row) =>
              row.glyphs.reduce(
                (peak, g) => Math.max(peak, pulseAt(time, g.start)),
                peak,
              ),
            0,
          );
      visible.push({
        line,
        layout: composition,
        cue: {
          intro,
          exit,
          opacity,
          index: i,
          pulse,
          age: time - line.start,
          release,
          progress: clamp(
            (time - line.start) / Math.max(1, line.end - line.start),
          ),
        },
      });
    }
    if (!visible.length) return false;
    if (!reduced) {
      const current = visible.find((v) => v.cue.index === index) ?? visible[0];
      drawPrismaticLight(ctx, {
        ...frame,
        palette,
        energy:
          Math.max(...visible.map((v) => v.cue.pulse)) * 0.38 +
          (frame.audio?.impact ?? 0) * 0.9,
        progress: current.cue.progress,
      });
    }
    // Old words leave as ink dust; they never form a second reading silhouette.
    const departing = visible
      .filter((v) => v.cue.release > 0 && v.cue.release < 1)
      .at(-1);
    for (const item of visible)
      if (item.cue.index === index || item === departing)
        this.line(
          ctx,
          item.layout,
          frame,
          item.cue,
          palette,
          item.cue.index === index,
          item === departing,
        );
    return visible.some(
      (v) => v.cue.index < index && v.cue.release > 0 && v.cue.release < 1,
    );
  }

  private pose(
    g: Glyph,
    row: Row,
    composition: Layout,
    frame: Frame,
    cue: Cue,
  ) {
    const { width: w, height: h, mode, reduced } = frame;
    if (reduced) return { x: g.x, y: g.y, angle: 0, scale: 1, reveal: 1 };
    const side = cue.index % 2 ? -1 : 1,
      enter = 1 - cue.intro;
    const pulse = pulseAt(frame.time, g.start);
    if (mode === "depth") {
      const distance = Math.max(w * 0.9, h * 2);
      const yaw = side * (0.15 + enter * 0.36) * (g.row % 2 ? -0.65 : 1);
      const layer = g.row % 2 ? -1 : 1;
      const gather = 1 - lyricSpring(cue.age + 200 - g.row * 50);
      const z =
        (g.x - w / 2) * Math.sin(yaw) +
        enter * distance * 0.78 +
        gather * distance * (0.18 + g.row * 0.1) -
        cue.exit * distance * 0.27 +
        (1 - cue.progress) * distance * 0.06 +
        g.row * composition.font * 0.2;
      const perspective = distance / Math.max(distance * 0.5, distance + z);
      return {
        x:
          w / 2 +
          ((g.x - w / 2) * Math.cos(yaw) -
            side * enter * w * 0.12 +
            layer * gather * w * 0.08 +
            side * cue.progress * w * 0.018) *
            perspective,
        y:
          h / 2 +
          (g.y - h / 2 + enter * h * 0.14 - cue.exit * h * 0.72) * perspective -
          pulse * g.size * 0.025,
        angle:
          side * (enter * -0.08 + cue.exit * 0.1) +
          (composition.compact ? 0 : g.row % 2 ? -0.018 : 0.018),
        scale: perspective * (1 + pulse * 0.024),
        reveal: 1,
      };
    }
    const delay =
      g.row * 34 + (g.order / Math.max(1, row.glyphs.length - 1)) * 65;
    const spring = lyricSpring(cue.age + 170 - delay);
    const reveal = clamp(spring),
      moving = 1 - spring,
      direction = (g.row + cue.index) % 2 ? 1 : -1;
    const angle =
      (composition.compact ? 0 : [-0.025, 0.018, -0.018][g.row]) +
      direction * (moving * 0.16 + cue.exit * 0.17);
    const local = g.x - (row.x + row.width / 2);
    return {
      x:
        row.x +
        row.width / 2 +
        local * Math.cos(angle) +
        direction * (moving * w * 0.2 + cue.exit * w * 0.09),
      y:
        row.y +
        local * Math.sin(angle) +
        moving * direction * (composition.compact ? h * 0.26 : g.size * 0.85) -
        cue.exit * direction * h * 0.72,
      angle,
      scale: 0.96 + spring * 0.04 + pulse * 0.018,
      reveal,
    };
  }

  private line(
    ctx: CanvasRenderingContext2D,
    composition: Layout,
    frame: Frame,
    cue: Cue,
    palette: LyricPalette,
    letters: boolean,
    dust: boolean,
  ) {
    const tint = palette.accent;
    if (!frame.reduced && letters) {
      this.rowAccents(ctx, composition, frame, cue, tint, palette);
    }
    const count = composition.rows.reduce(
      (n, row) =>
        n + row.glyphs.filter((g) => !g.hidden && g.text.trim()).length,
      0,
    );
    const perGlyph = Math.floor(
      lyricRenderBudget(frame.quality).particles / Math.max(1, count),
    );
    for (const row of composition.rows)
      for (const g of row.glyphs) {
        if (g.hidden || !g.text.trim()) continue;
        const pose = this.pose(g, row, composition, frame, cue);
        const sung = g.timed
          ? smooth((frame.time - g.start) / Math.max(1, g.end - g.start))
          : frame.time >= g.start
            ? 1
            : 0;
        const word = row.glyphs.filter(
          (item) =>
            item.start === g.start && item.end === g.end && !item.hidden,
        );
        const first = word[0],
          last = word.at(-1)!;
        const wordLeft = first.x - first.width / 2,
          wordWidth = last.x + last.width / 2 - wordLeft;
        const progress = g.timed
          ? clamp((frame.time - g.start) / Math.max(1, g.end - g.start))
          : clamp((frame.time - g.start) / 650);
        const active =
          frame.time >= g.start &&
          frame.time < (g.timed ? g.end : g.start + 650);
        ctx.save();
        ctx.translate(pose.x, pose.y);
        ctx.rotate(pose.angle);
        ctx.scale(pose.scale, pose.scale);
        ctx.font = lyricFont(g.size, frame.fontStyle, g.weight);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.globalAlpha = cue.opacity * g.opacity;
        ctx.save();
        if (cue.release > 0) {
          const cut = clamp(cue.release / 0.32);
          const inkWidth =
            (this.dust.prepare(g.text, frame.fontStyle ?? "modern", g.weight)
              .width *
              g.size) /
            64;
          ctx.beginPath();
          ctx.rect(
            -inkWidth / 2 + cut * inkWidth,
            -g.size,
            (1 - cut) * inkWidth,
            g.size * 2,
          );
          ctx.clip();
        }
        if (frame.mode === "stage" && !frame.reduced && pose.reveal < 1) {
          ctx.beginPath();
          ctx.rect(
            -g.width,
            -g.size * 0.75,
            g.width * 2,
            g.size * 1.5 * pose.reveal,
          );
          ctx.clip();
        }
        if (letters && frame.readability === "contrast") {
          ctx.strokeStyle = palette.shadow;
          ctx.lineWidth = Math.max(2.4 / pose.scale, g.size * 0.035);
          ctx.lineJoin = "round";
          ctx.strokeText(g.text, 0, g.baseline);
        }
        ctx.fillStyle = lyricInk(
          ctx,
          palette,
          wordWidth,
          g.size,
          sung,
          progress,
          active,
          frame.reduced,
          g.x - wordLeft - wordWidth / 2,
        );
        if (letters) ctx.fillText(g.text, 0, g.baseline);
        // A narrow colored baseline reacts to declared words, never invented syllables.
        if (
          letters &&
          !frame.reduced &&
          sung > 0.01 &&
          frame.mode === "stage"
        ) {
          const pulse = pulseAt(frame.time, g.start);
          ctx.globalAlpha = cue.opacity * (0.13 + pulse * 0.48);
          ctx.fillStyle = tint;
          ctx.fillRect(
            -g.width * 0.38,
            g.size * 0.55,
            g.width * 0.76 * sung,
            Math.max(0.6, g.size * 0.018),
          );
        }
        ctx.restore();
        if (dust && !frame.reduced)
          this.particles += this.dust.draw(
            ctx,
            g.text,
            g.size,
            frame.fontStyle ?? "modern",
            g.weight,
            cue.release,
            palette,
            perGlyph,
            lyricAccent(frame.audio),
            frame.flow,
          );
        ctx.restore();
      }
  }

  private rowAccents(
    ctx: CanvasRenderingContext2D,
    composition: Layout,
    frame: Frame,
    cue: Cue,
    tint: string,
    palette: LyricPalette,
  ) {
    for (const row of composition.rows) {
      const center = { ...row.glyphs[0], x: row.x + row.width / 2, y: row.y };
      const pose = this.pose(center, row, composition, frame, cue),
        width = row.width,
        size = row.size;
      ctx.save();
      ctx.translate(pose.x, pose.y);
      ctx.rotate(pose.angle);
      ctx.scale(pose.scale, pose.scale);
      ctx.globalAlpha =
        cue.opacity *
        (0.07 + cue.pulse * 0.07 + (frame.audio?.body ?? 0) * 0.08);
      ctx.fillStyle = tint;
      if (
        frame.mode === "stage" &&
        (composition.compact || (row.glyphs[0].row + cue.index) % 2)
      ) {
        ctx.beginPath();
        ctx.moveTo(-width / 2 - size * 0.12, size * 0.13);
        ctx.lineTo(width / 2 + size * 0.18, size * 0.13);
        ctx.lineTo(width / 2 + size * 0.07, size * 0.48);
        ctx.lineTo(-width / 2 - size * 0.2, size * 0.48);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha =
        cue.opacity *
        (0.26 + cue.pulse * 0.24 + (frame.audio?.impact ?? 0) * 0.42);
      if (frame.mode === "stage")
        ctx.fillRect(
          -width / 2 - size * 0.22,
          -size * 0.35,
          Math.max(1, size * 0.028),
          size * 0.72,
        );
      const gradient = ctx.createLinearGradient(
        -width / 2,
        0,
        width / 2 + size,
        0,
      );
      gradient.addColorStop(0, palette.prism[0] + "00");
      gradient.addColorStop(0.25, palette.prism[0]);
      gradient.addColorStop(0.65, palette.prism[1]);
      gradient.addColorStop(1, tint + "00");
      ctx.strokeStyle = gradient;
      ctx.lineWidth = Math.max(0.7, size * 0.014);
      ctx.beginPath();
      ctx.moveTo(-width / 2, size * 0.65);
      ctx.lineTo(width / 2 + size, size * 0.65);
      ctx.stroke();
      if (frame.mode === "stage") {
        const age = Math.max(0, cue.age - row.glyphs[0].row * 34);
        const wave = clamp(age / 440),
          strength = Math.exp(-age / 210) + (frame.audio?.impact ?? 0) * 0.3;
        ctx.globalAlpha = cue.opacity * strength * 0.75;
        ctx.strokeStyle = palette.prism[row.glyphs[0].row % 3];
        ctx.lineWidth = 1.5;
        const x = -width / 2 + wave * width;
        ctx.beginPath();
        ctx.moveTo(x - size * 0.35, -size * 0.65);
        ctx.lineTo(x + size * 0.14, size * 0.7);
        ctx.stroke();
      }
      // Scan only across a declared word span. Line-only lyrics get one phrase flash.
      const active = row.glyphs.find(
        (g) =>
          g.timed && !g.hidden && frame.time >= g.start && frame.time < g.end,
      );
      if (active) {
        const wordEnd = row.glyphs
          .filter((g) => g.start === active.start && g.end === active.end)
          .at(-1)!;
        const progress = clamp(
          (frame.time - active.start) / Math.max(1, active.end - active.start),
        );
        const x =
          active.x -
          active.width / 2 +
          (wordEnd.x + wordEnd.width / 2 - active.x + active.width / 2) *
            progress -
          row.x -
          width / 2;
        ctx.globalAlpha = cue.opacity * 0.85;
        ctx.fillStyle = palette.sung;
        ctx.shadowColor = palette.prism[0];
        ctx.shadowBlur = size * 0.14;
        ctx.fillRect(
          x,
          size * 0.61,
          Math.max(1.5, size * 0.05),
          Math.max(1, size * 0.04),
        );
      }
      ctx.restore();
    }
  }
}
