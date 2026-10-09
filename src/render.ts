import { raster_get, type RasterCache, type RasterCanvas } from './raster'

export type RenderLayer = { packed: Uint32Array | null, image: RasterCanvas | null, alpha: number }
export type RenderPlan = { width: number, height: number, paper: string, layers: RenderLayer[] }
export type RenderContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function render_layers(plan: RenderPlan, context: RenderContext, w: number, h: number, cache: RasterCache, budget: number): void {
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  context.clearRect(0, 0, w, h)
  if (plan.paper) { context.fillStyle = plan.paper; context.fillRect(0, 0, w, h) }
  const sx = w / plan.width
  const sy = h / plan.height
  context.imageSmoothingEnabled = w < plan.width || h < plan.height
  for (const layer of plan.layers) {
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
    if (!raster) continue
    context.globalAlpha = layer.alpha
    context.drawImage(raster.canvas, raster.x * sx, raster.y * sy, raster.canvas.width * sx, raster.canvas.height * sy)
  }
  context.globalAlpha = 1
}
