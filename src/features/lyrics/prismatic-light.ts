import type { LyricPalette } from './lyric-palette'
import type { LyricAudio } from './lyric-audio'

interface LightField {
  width: number; height: number; time: number; palette: LyricPalette;
  energy: number; progress: number; mode: 'depth' | 'stage';
  audio?: Readonly<LyricAudio>;
}

/** Thin luminous creases, with the same material colors as the scene and card. */
export function drawPrismaticLight(ctx: CanvasRenderingContext2D, field: LightField) {
  const { width: w, height: h, time, palette, energy, progress, mode } = field
  const compact = h < w * .2, t = time / 1000
  ctx.save()
  // Keep luminosity in the light layer; letters are painted once, sharply, on top.
  for (let i = 0; i < 7; i++) {
    const seed = (i * .61803398875) % 1, side = i % 2 ? 1 : -1
    const color = palette.prism[i % 3]
    const drift = Math.sin(t * .30 + i * 1.7)
    const x = w * (.06 + seed * .88) + drift * w * .018
    const y = h * (.5 + side * (.15 + seed * .26 + (field.audio?.bass ?? 0) * .025))
    const length = w * (.12 + seed * .19) * (1 + (field.audio?.body ?? 0) * .12)
    const tilt = mode === 'depth' ? h * (.09 + seed * .12) : h * .035
    const start = { x: x - length * .52, y: y + side * tilt }
    const bend = { x, y: y - side * h * .015 * Math.sin(progress * Math.PI) }
    const end = { x: x + length * .48, y: y - side * tilt * .28 }
    const light = ctx.createLinearGradient(start.x, start.y, end.x, end.y)
    light.addColorStop(0, color + '00'); light.addColorStop(.42, color + 'aa')
    light.addColorStop(.57, palette.sung + 'e6'); light.addColorStop(1, color + '00')
    const trace = () => { ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(bend.x, bend.y); ctx.lineTo(end.x, end.y) }
    ctx.strokeStyle = light
    // Explicit translucent strokes avoid backend-dependent blur/composite dithering
    // and keep seek reconstruction identical on software and hardware canvases.
    for (const [width, alpha] of [[compact ? 7 : 13, .018], [compact ? 4 : 7, .035], [2.4, .07]]) {
      ctx.globalAlpha = alpha * (1 + energy); ctx.lineWidth = width
      trace(); ctx.stroke()
    }
    ctx.globalAlpha = Math.min(1, .66 + energy * .25); ctx.lineWidth = .9 + (field.audio?.treble ?? 0) * .65
    trace(); ctx.stroke()
    // A faint triangular face puts the lit crease in a plane instead of a wire cage.
    const face = ctx.createLinearGradient(bend.x, bend.y, bend.x, bend.y + side * h * .08)
    face.addColorStop(0, color + '2b'); face.addColorStop(1, color + '00')
    ctx.fillStyle = face; ctx.globalAlpha = .45 + energy * .25
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(bend.x, bend.y)
    ctx.lineTo(end.x, end.y); ctx.lineTo(bend.x + length * .08, bend.y + side * h * .08); ctx.closePath(); ctx.fill()
  }
  ctx.restore()
}
