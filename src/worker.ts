import { render_layers, type RenderPlan } from './render'
import { raster_cache } from './raster'
import { cache_clear } from './memory'
import { kwz_build, type KwzFrame } from './codec/kwz'
import type { FlipMeta } from './codec/kwzdec'
import { ppm_build, type PpmFrame } from './codec/ppm'
import { flip_image_convert, type FlipImageInput, type FlipImageResult } from './flipnote/image'
import { fmt_build, type ProjSnap } from './fmt'

type KwzMsg = {
  thumbIdx?: number
  meta?: FlipMeta
  kind: 'kwz'
  id: number
  frames: KwzFrame[]
  speed: number
  loop: number
  name: string
  thumbJpeg: Uint8Array
  bgm: Int16Array | null
  se: (Int16Array | null)[]
}
type PpmMsg = {
  thumbIdx?: number
  meta?: FlipMeta
  kind: 'ppm'
  id: number
  frames: PpmFrame[]
  speed: number
  loop: number
  name: string
  thumb: Uint8Array
  bgm: Int16Array | null
  se: (Int16Array | null)[]
}
type Ugn2Msg = { kind: 'ugn2', id: number, snap: ProjSnap }
type FlipImageMsg = { kind: 'flip-image', id: number, input: FlipImageInput }
type ThumbnailMsg = { kind: 'thumbnail', id: number, plan: RenderPlan, w: number, h: number }
type InMsg = KwzMsg | PpmMsg | Ugn2Msg | FlipImageMsg | ThumbnailMsg

declare const self: DedicatedWorkerGlobalScope

function image_transfers(result: FlipImageResult): ArrayBuffer[] {
  const transfers: ArrayBuffer[] = []
  for (const frame of result.frames) {
    for (const packed of frame) if (packed) transfers.push(packed.buffer as ArrayBuffer)
  }
  return transfers
}

self.onmessage = async (event: MessageEvent<InMsg>) => {
  const message = event.data
  try {
    if (message.kind === 'thumbnail') {
      const canvas = new OffscreenCanvas(message.w, message.h)
      const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
      const cache = raster_cache()
      render_layers(message.plan, context, message.w, message.h, cache, 16 << 20)
      const pixels = context.getImageData(0, 0, message.w, message.h).data
      cache_clear(cache)
      self.postMessage({ id: message.id, ok: 1, pixels }, [pixels.buffer])
      return
    }
    if (message.kind === 'flip-image') {
      const image = flip_image_convert(message.input)
      self.postMessage({ id: message.id, ok: 1, image }, image_transfers(image))
      return
    }
    let out: Uint8Array
    if (message.kind === 'ugn2') {
      out = fmt_build(message.snap)
    } else if (message.kind === 'kwz') {
      out = await kwz_build({ frames: message.frames, speed: message.speed, loop: message.loop, name: message.name, thumbJpeg: message.thumbJpeg, thumbIdx: message.thumbIdx, bgm: message.bgm, se: message.se, meta: message.meta })
    } else {
      out = await ppm_build({ frames: message.frames, speed: message.speed, loop: message.loop, name: message.name, thumb: message.thumb, thumbIdx: message.thumbIdx, bgm: message.bgm, se: message.se, meta: message.meta })
    }
    const buffer = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
    self.postMessage({ id: message.id, ok: 1, bytes: new Uint8Array(buffer) }, [buffer])
  } catch (error) {
    self.postMessage({ id: message.id, ok: 0, error: String(error) })
  }
}
