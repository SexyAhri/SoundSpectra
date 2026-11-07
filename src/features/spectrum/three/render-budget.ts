import type { RenderQuality } from '../model'

// Keep native 4K available in balanced mode and supersample smaller previews.
// The shared cap bounds GPU memory when several regions are visible together.
export const threePixelBudgets: Record<RenderQuality, number> = {
  eco: 1_200_000, balanced: 8_294_400, smooth: 14_745_600, unlimited: 14_745_600,
}

export function threeDrawingSize(width: number, height: number, dpr: number, quality: RenderQuality, regionCount = 1) {
  const minimumScale = quality === 'eco' ? 1 : quality === 'balanced' ? 1.25 : 1.5
  const scale = Math.min(Math.max(dpr || 1, minimumScale), quality === 'eco' ? 1 : 2,
    Math.sqrt(threePixelBudgets[quality] / Math.max(1, regionCount) / Math.max(1, width * height)),
    4096 / Math.max(1, width), 4096 / Math.max(1, height))
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }
}

/** The editor needs a sharp preview, not an oversized desktop render target.
 * Actual overlays and direct/export renders retain their full quality budget. */
export function previewDrawingSize(size: { width: number; height: number }, regions: number) {
  const scale=Math.min(1,Math.sqrt(1920*1080/Math.max(1,regions)/(size.width*size.height)))
  return {width:Math.max(1,Math.floor(size.width*scale)),height:Math.max(1,Math.floor(size.height*scale))}
}
