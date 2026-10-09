import { pixel_crop } from './pixel'
import { cache_make, cache_get, cache_put, type ByteCache } from './memory'

export type RasterCanvas = HTMLCanvasElement | OffscreenCanvas
export type Raster = { canvas: RasterCanvas, x: number, y: number }
export type RasterCache = ByteCache<Uint32Array, Raster>

export function raster_cache(): RasterCache {
  return cache_make(r => { r.canvas.width = 0; r.canvas.height = 0 })
}

export function raster_get(cache: RasterCache, packed: Uint32Array, w: number, h: number, budget: number): Raster | null {
  const hit = cache_get(cache, packed)
  if (hit) return hit
  const crop = pixel_crop(packed, w, h)
  if (!crop) return null
  const canvas: RasterCanvas = typeof document === 'undefined' ? new OffscreenCanvas(crop.w, crop.h) : document.createElement('canvas')
  canvas.width = crop.w
  canvas.height = crop.h
  const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  context.putImageData(new ImageData(new Uint8ClampedArray(crop.pixels.buffer as ArrayBuffer), crop.w, crop.h), 0, 0)
  const raster = { canvas, x: crop.x, y: crop.y }
  cache_put(cache, packed, raster, crop.w * crop.h * 4, budget)
  return raster
}
