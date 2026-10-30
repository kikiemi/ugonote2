import { pixel_source_prepare, pixel_source_is } from './pixel_source'
import { raster_get, raster_release, type raster_cache_t, type raster_canvas_t } from './raster'

export type render_layer_t = { packed: Uint32Array | null, image: raster_canvas_t | null, alpha: number, smooth?: number }
export type render_plan_t = { width: number, height: number, paper: string, layers: render_layer_t[] }
export type render_context_t = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function render_layers(plan: render_plan_t, context: render_context_t, w: number, h: number, cache: raster_cache_t, budget: number): number {
  let ready = 1
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  context.clearRect(0, 0, w, h)
  if (plan.paper) { context.fillStyle = plan.paper; context.fillRect(0, 0, w, h) }
  const sx = w / plan.width
  const sy = h / plan.height
  context.imageSmoothingQuality = 'high'
  for (const layer of plan.layers) {
    context.imageSmoothingEnabled = !!layer.smooth || w < plan.width || h < plan.height
    const packed = layer.packed
    if (!layer.image && packed && packed.length === 3 && packed[1] === plan.width * plan.height && !(packed[0] & 0x80000000)) {
      const color = packed[2]
      if (!(color >>> 24)) continue
      context.globalAlpha = layer.alpha
      context.fillStyle = 'rgba(' + (color & 255) + ',' + ((color >>> 8) & 255) + ',' + ((color >>> 16) & 255) + ',' + (color >>> 24) / 255 + ')'
      context.fillRect(0, 0, w, h)
      continue
    }
    const raster = layer.image ? { canvas: layer.image, x: 0, y: 0 } : layer.packed ? raster_get(cache, layer.packed, plan.width, plan.height, budget) : null
    if (!raster) { if (packed && pixel_source_is(packed)) ready = 0; continue }
    context.globalAlpha = layer.alpha
    try { context.drawImage(raster.canvas, raster.x * sx, raster.y * sy, raster.canvas.width * sx, raster.canvas.height * sy) }
    finally { raster_release(raster) }
  }
  context.globalAlpha = 1
  return ready
}

export function render_plan_bytes(plans: readonly render_plan_t[]): number {
  const seen = new Set<ArrayBufferLike>()
  let bytes = 0
  for (const plan of plans) for (const layer of plan.layers) if (layer.packed && !seen.has(layer.packed.buffer)) { seen.add(layer.packed.buffer); bytes += layer.packed.buffer.byteLength }
  return bytes
}

export async function render_prepare(plan: render_plan_t): Promise<void> { await pixel_source_prepare(plan.layers.map(layer => layer.packed)) }
