import { pixel_source_is, pixel_source_peek, pixel_source_prepare } from './pixel_source'
import { pixel_crop } from './pixel'
import { cache_make, cache_get, cache_put, type byte_cache_t } from './memory'

export type raster_canvas_t = HTMLCanvasElement | OffscreenCanvas
export type raster_t = { canvas: raster_canvas_t, x: number, y: number, temporary?: number }
export type raster_cache_t = byte_cache_t<Uint32Array, raster_t>

export function raster_make(w: number, h: number): raster_canvas_t {
  if (typeof document === 'undefined') return new OffscreenCanvas(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  return canvas
}

export function raster_cache(): raster_cache_t {
  return cache_make(r => { r.canvas.width = 0; r.canvas.height = 0 })
}

export function raster_get(cache: raster_cache_t, packed: Uint32Array, w: number, h: number, budget: number): raster_t | null {
  const hit = cache_get(cache, packed)
  if (hit) return hit
  if (pixel_source_is(packed) && !pixel_source_peek(packed)) { void pixel_source_prepare(packed).catch(() => {}); return null }
  const source = pixel_source_is(packed) ? pixel_source_peek(packed) : null
  const crop = source ? { x: 0, y: 0, w, h, pixels: source } : pixel_crop(packed, w, h)
  if (!crop) return null
  const canvas = raster_make(crop.w, crop.h)
  const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  context.putImageData(new ImageData(new Uint8ClampedArray(crop.pixels.buffer as ArrayBuffer), crop.w, crop.h), 0, 0)
  const raster: raster_t = { canvas, x: crop.x, y: crop.y }
  if (!cache_put(cache, packed, raster, crop.w * crop.h * 4, budget)) raster.temporary = 1
  return raster
}

export function raster_release(raster: raster_t): void {
  if (raster.temporary) { raster.canvas.width = 0; raster.canvas.height = 0 }
}
