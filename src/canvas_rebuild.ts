import { pixel_source_is, pixel_source_transform, pixel_source_prepare, pixel_source_peek } from './pixel_source'
import { memory_check, memory_work_budget } from './memory'
import type { deep_ro_t } from './state/store'
import { type frame_t, type rle_t } from './h'
import { rle_pack, rle_unpack } from './pixel'
import { raster_make } from './raster'
import { task_yield } from './task_queue'

export type canvas_rebuild_input_t = { w: number, h: number, nw: number, nh: number, frames: deep_ro_t<frame_t[]>, budget?: number, mode?: number }

export function* canvas_rebuild(input: canvas_rebuild_input_t): Generator<number | Uint32Array, frame_t[]> {
  const { w, h, nw, nh, frames } = input
  if (![w, h, nw, nh].every(v => Number.isInteger(v) && v > 0 && v <= 4096)) throw new RangeError('キャンバスの大きさが正しくありません')
  if (w === nw && h === nh) return frames.map(frame => ({ ...frame, pk: frame.pk.slice() }))
  const scale = Math.max(nw / w, nh / h), dw = Math.round(w * scale), dh = Math.round(h * scale)
  if (!input.mode && frames.every(frame => frame.pk.every(packed => !packed || pixel_source_is(packed)))) {
    memory_check(nw * nh * 12, input.budget || memory_work_budget())
    return frames.map(frame => ({ ...frame, pk: frame.pk.map(packed => packed ? pixel_source_transform(packed, nw, nh, scale, 0, 0, scale, (nw - dw) >> 1, (nh - dh) >> 1) : null) }))
  }
  const budget = input.budget || memory_work_budget()
  const packets = new Set<rle_t>()
  let bytes = 0
  for (const frame of frames) for (const packed of frame.pk) if (packed && !packets.has(packed)) { packets.add(packed); bytes += packed.byteLength }
  const working = w * h * 8 + nw * nh * 12 + bytes * 2
  memory_check(working, budget)
  let result_bytes = 0
  const source = raster_make(w, h), target = raster_make(nw, nh)
  const sx = source.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  const tx = target.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  const image = sx.createImageData(w, h), pixels = new Uint32Array(image.data.buffer)
  const resized = new Map<rle_t, rle_t | null>()
  const result: frame_t[] = []
  try {
    for (let i = 0; i < frames.length; i++) {
      const frame = { ...frames[i], pk: frames[i].pk.slice() }
      for (let l = 0; l < frame.pk.length; l++) {
        const packed = frame.pk[l]
        if (!packed) continue
        if (!resized.has(packed) && pixel_source_is(packed)) {
          const transformed = pixel_source_transform(packed, nw, nh, scale, 0, 0, scale, (nw - dw) >> 1, (nh - dh) >> 1)
          if (input.mode) {
            yield transformed
            resized.set(packed, rle_pack(pixel_source_peek(transformed)!))
          } else resized.set(packed, transformed)
        }
        if (!resized.has(packed)) {
          rle_unpack(packed, pixels)
          sx.putImageData(image, 0, 0)
          tx.clearRect(0, 0, nw, nh)
          tx.imageSmoothingEnabled = true
          tx.imageSmoothingQuality = 'high'
          tx.drawImage(source, 0, 0, w, h, (nw - dw) >> 1, (nh - dh) >> 1, dw, dh)
          const output = rle_pack(new Uint32Array(tx.getImageData(0, 0, nw, nh).data.buffer))
          result_bytes += output?.byteLength || 0
          memory_check(working + result_bytes, budget)
          resized.set(packed, output)
        }
        frame.pk[l] = resized.get(packed)!
      }
      result.push(frame)
      yield (i + 1) / frames.length
    }
    return result
  } finally { source.width = 0; target.width = 0 }
}

export async function canvas_rebuild_async(input: canvas_rebuild_input_t, progress: (value: number) => void): Promise<frame_t[]> {
  const work = canvas_rebuild(input)
  let last = performance.now()
  for (;;) {
    const result = work.next()
    if (result.done) { progress(1); return result.value }
    if (result.value instanceof Uint32Array) await pixel_source_prepare(result.value)
    else if (performance.now() - last >= 12) { progress(result.value); await task_yield(); last = performance.now() }
  }
}
