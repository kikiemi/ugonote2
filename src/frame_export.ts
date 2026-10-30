import { gif_stream } from './gif'
import { raster_make, raster_cache } from './raster'
import { render_layers, render_prepare, type render_context_t, type render_plan_t } from './render'
import { cache_clear, memory_check, memory_work_budget } from './memory'
import { task_yield } from './task_queue'
import { zip_build, type zip_entry_t } from './zipw'

export type frame_export_input_t = { w: number, h: number, fps: number, holds: number[], format: 'gif' | 'pngzip', name: string, budget?: number, plans?: render_plan_t[], frames?: number[], images?: ImageData[], entries?: zip_entry_t[] }

async function raster_png(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' })
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNGを作成できませんでした')), 'image/png'))
}

export async function frame_export(input: frame_export_input_t, progress: (value: number) => void): Promise<Blob> {
  const { w, h, fps, holds, format } = input
  const images = input.images || []
  const entries = input.entries || []
  const budget = input.budget || memory_work_budget()
  memory_check(w * h * 12, budget)
  const canvas = raster_make(w, h), context = canvas.getContext('2d') as render_context_t
  const cache = raster_cache()
  try {
    if (format === 'gif') {
      if (!input.plans && !images.length) throw new Error('書き出すコマがありません')
      memory_check(images.reduce((bytes, image) => bytes + image.data.byteLength, 0) + w * h * 12, budget)
      const read = async (index: number): Promise<ImageData> => {
        if (!input.plans) return images[index]
        const plan = input.plans[input.frames?.[index] ?? index]
        if (!plan) throw new Error('書き出すコマがありません')
        await render_prepare(plan)
        render_layers(plan, context, w, h, cache, Math.min(16 << 20, budget / 8))
        return context.getImageData(0, 0, w, h)
      }
      const bytes = await gif_stream(w, h, holds.length, read, fps, holds, 1, progress, Math.floor(budget / 3))
      return new Blob([bytes.buffer as ArrayBuffer], { type: 'image/gif' })
    }
    let entry_bytes = entries.reduce((bytes, entry) => bytes + entry.data.byteLength, 0)
    memory_check(entry_bytes * 3 + w * h * 12, budget)
    if (input.plans) {
      for (let i = 0; i < holds.length; i++) {
        const plan = input.plans[input.frames?.[i] ?? i]
        if (!plan) throw new Error('書き出すコマがありません')
        await render_prepare(plan)
        render_layers(plan, context, w, h, cache, 16 << 20)
        const blob = await raster_png(canvas)
        entry_bytes += blob.size
        memory_check(entry_bytes * 3 + w * h * 12, budget)
        entries.push({ name: input.name + '_' + String(i + 1).padStart(3, '0') + '.png', data: new Uint8Array(await blob.arrayBuffer()) })
        progress((i + 1) / holds.length * 0.4)
        await task_yield()
      }
    }
    const bytes = zip_build(entries)
    progress(1)
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' })
  } finally {
    cache_clear(cache)
    canvas.width = 0
  }
}
