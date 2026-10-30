import { pixel_source_bind, pixel_source_collect, type pixel_source_record_t } from './pixel_source'
import { frame_export, type frame_export_input_t } from './frame_export'
import { video_encode, type video_encode_input_t } from './video_encode'
import { canvas_rebuild_async, type canvas_rebuild_input_t } from './canvas_rebuild'
import { vid_import, type video_import_options_t } from './vid_import'
import { render_layers, render_prepare, type render_plan_t } from './render'
import { raster_cache } from './raster'
import { cache_clear } from './memory'
import { kwz_build, type kwz_frame_t } from './codec/kwz'
import type { flip_meta_t } from './codec/kwzdec'
import { ppm_build, type ppm_frame_t } from './codec/ppm'
import { flip_image_convert, type flip_image_input_t, type flip_image_result_t } from './flipnote/image'
import { fmt_build_blob, type proj_snap_t } from './fmt'
import { smooth_pack, smooth_pack_ai, type smooth_job_t } from './flipnote/smooth'
import { ai_open, type ai_net_t } from './flipnote/ai_lines'

type kwz_msg_t = {
  thumb_idx?: number
  meta?: flip_meta_t
  kind: 'kwz'
  id: number
  frames: kwz_frame_t[]
  speed: number
  loop: number
  name: string
  thumb_jpeg: Uint8Array
  bgm: Int16Array | null
  se: (Int16Array | null)[]
}
type ppm_msg_t = {
  thumb_idx?: number
  meta?: flip_meta_t
  kind: 'ppm'
  id: number
  frames: ppm_frame_t[]
  speed: number
  loop: number
  name: string
  thumb: Uint8Array
  bgm: Int16Array | null
  se: (Int16Array | null)[]
}
type ugn2_msg_t = { kind: 'ugn2', id: number, snap: proj_snap_t }
type flip_image_msg_t = { kind: 'flip-image', id: number, input: flip_image_input_t }
type thumbnail_msg_t = { kind: 'thumbnail', id: number, plan: render_plan_t, w: number, h: number }
type video_msg_t = { kind: 'video', id: number, file: File, options: video_import_options_t }
type resize_msg_t = { kind: 'resize', id: number, input: canvas_rebuild_input_t }
type encode_video_msg_t = { kind: 'encode-video', id: number, input: video_encode_input_t }
type export_frames_msg_t = { kind: 'export-frames', id: number, input: frame_export_input_t }
// うごメモの1レイヤーを、通常モードのキャンバスへなめらかに描きなおす (いくつもの Worker で同時に進める)。
type smooth_msg_t = { kind: 'smooth', id: number, job: smooth_job_t }
// AI の線の重み。最初に1回だけ受けとって、WebGPU の準備をしておく。
type smooth_ai_msg_t = { kind: 'smooth-ai', id: number, weights: ArrayBuffer }
type in_msg_t = smooth_msg_t | smooth_ai_msg_t | export_frames_msg_t | encode_video_msg_t | resize_msg_t | video_msg_t | kwz_msg_t | ppm_msg_t | ugn2_msg_t | flip_image_msg_t | thumbnail_msg_t

declare const self: DedicatedWorkerGlobalScope

let ai_net: Promise<ai_net_t | null> | null = null

function worker_post(message: Record<string, unknown>, transfers: Transferable[] = []): void { self.postMessage({ ...message, sources: pixel_source_collect(message) }, transfers) }

function image_transfers(result: flip_image_result_t): ArrayBuffer[] {
  const transfers: ArrayBuffer[] = []
  for (const frame of result.frames) {
    for (const packed of frame) if (packed) transfers.push(packed.buffer as ArrayBuffer)
  }
  return transfers
}

self.onmessage = async (event: MessageEvent<in_msg_t>) => {
  const message = event.data
  try {
    if (message.kind === 'smooth-ai') {
      ai_net = ai_open(message.weights).catch(() => null)
      return
    }
    if (message.kind === 'smooth') {
      if (typeof OffscreenCanvas === 'undefined' || typeof Path2D === 'undefined') {
        self.postMessage({ id: message.id, ok: 0, fallback: 1 })
        return
      }
      const net = message.job.ai && ai_net ? await ai_net : null
      const packed = net ? await smooth_pack_ai(message.job, net) : smooth_pack(message.job)
      const transfers: ArrayBuffer[] = []
      if (packed.line) transfers.push(packed.line.buffer as ArrayBuffer)
      if (packed.fill) transfers.push(packed.fill.buffer as ArrayBuffer)
      self.postMessage({ id: message.id, ok: 1, packed }, transfers)
      return
    }
    pixel_source_bind((message as in_msg_t & { sources?: pixel_source_record_t[] }).sources || [])
    if (message.kind === 'export-frames') {
      const blob = await frame_export(message.input, progress => worker_post({ id: message.id, ok: 1, progress }))
      worker_post({ id: message.id, ok: 1, blob })
      return
    }
    if (message.kind === 'encode-video') {
      try {
        const blob = await video_encode(message.input, progress => worker_post({ id: message.id, ok: 1, progress }))
        worker_post({ id: message.id, ok: 1, blob })
      } catch (error) {
        const audio = { pcm: message.input.pcm, sound: message.input.sound }
        const transfers = new Set<ArrayBuffer>()
        if (audio.pcm) transfers.add(audio.pcm.buffer as ArrayBuffer)
        for (const track of audio.sound?.tracks || []) for (const channel of track.channels) transfers.add(channel.buffer as ArrayBuffer)
        worker_post({ id: message.id, ok: 0, error: String(error), audio }, [...transfers])
      }
      return
    }
    if (message.kind === 'resize') {
      const frames = await canvas_rebuild_async(message.input, progress => worker_post({ id: message.id, ok: 1, progress }))
      const transfers = new Set<ArrayBuffer>()
      for (const frame of frames) for (const packed of frame.pk) if (packed) transfers.add(packed.buffer as ArrayBuffer)
      worker_post({ id: message.id, ok: 1, frames }, [...transfers])
      return
    }
    if (message.kind === 'video') {
      if (typeof OffscreenCanvas === 'undefined' || typeof VideoDecoder === 'undefined' || typeof AudioDecoder === 'undefined') {
        worker_post({ id: message.id, ok: 0, fallback: 1 })
        return
      }
      const project = await vid_import(message.file, message.options, progress => worker_post({ id: message.id, ok: 1, progress }))
      const transfers = new Set<ArrayBuffer>()
      for (const frame of project.frames) for (const packed of frame.pk) if (packed) transfers.add(packed.buffer as ArrayBuffer)
      for (const slot of project.slots) if (slot.bytes) transfers.add(slot.bytes)
      worker_post({ id: message.id, ok: 1, project }, [...transfers])
      return
    }
    if (message.kind === 'thumbnail') {
      const canvas = new OffscreenCanvas(message.w, message.h)
      const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
      const cache = raster_cache()
      await render_prepare(message.plan)
      render_layers(message.plan, context, message.w, message.h, cache, 16 << 20)
      const pixels = context.getImageData(0, 0, message.w, message.h).data
      cache_clear(cache)
      worker_post({ id: message.id, ok: 1, pixels }, [pixels.buffer])
      canvas.width = 0
      return
    }
    if (message.kind === 'flip-image') {
      const image = flip_image_convert(message.input)
      worker_post({ id: message.id, ok: 1, image }, image_transfers(image))
      return
    }
    if (message.kind === 'ugn2') {
      const blob = await fmt_build_blob(message.snap)
      worker_post({ id: message.id, ok: 1, blob })
      return
    }
    let out: Uint8Array
    if (message.kind === 'kwz') {
      out = await kwz_build({ frames: message.frames, speed: message.speed, loop: message.loop, name: message.name, thumb_jpeg: message.thumb_jpeg, thumb_idx: message.thumb_idx, bgm: message.bgm, se: message.se, meta: message.meta })
    } else {
      out = await ppm_build({ frames: message.frames, speed: message.speed, loop: message.loop, name: message.name, thumb: message.thumb, thumb_idx: message.thumb_idx, bgm: message.bgm, se: message.se, meta: message.meta })
    }
    const buffer = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
    worker_post({ id: message.id, ok: 1, bytes: new Uint8Array(buffer) }, [buffer])
  } catch (error) {
    worker_post({ id: message.id, ok: 0, error: String(error) })
  }
}
