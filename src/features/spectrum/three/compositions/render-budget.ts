import type { RenderQuality } from '../../model'

const pixels: Record<RenderQuality, number> = {
  eco: 921_600, balanced: 2_073_600, smooth: 3_686_400, unlimited: 8_294_400,
}

/** Particle sprites already soften their edges; avoid supersampling a full
 * desktop into a 4K MSAA target while its settings preview renders as well. */
export function compositionDrawingSize(width: number, height: number, dpr: number, quality: RenderQuality, regions: number) {
  const scale = Math.min(Math.max(1, dpr || 1), 1.25,
    Math.sqrt(pixels[quality] / Math.max(1, regions) / Math.max(1, width * height)),
    4096 / Math.max(1, width), 4096 / Math.max(1, height))
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }
}
