import { pixel_source_ready, pixel_source_prepare } from './pixel_source'
import { task_schedule } from './task_queue'
import { animfx_active, animfx_compose, animfx_time_for_tick } from './animfx'
import { animout_compose, animout_jobs, type anim_out_job_t } from './animout'
import { kwz_filename_make, ppm_filename_format, ppm_filename_local, rand_hex } from './codec/fname'
import { kwz_speed_from_fps, type kwz_frame_t } from './codec/kwz'
import type { flip_meta_t } from './codec/kwzdec'
import { kwz_canvas_w, kwz_canvas_h, kwz_pad_plane } from './codec/kwzgeom'
import { ppm_speed_from_fps, ppm_w, ppm_h, type ppm_frame_t } from './codec/ppm'
import { report_warning } from './diagnostics'
import { doc_layer_canvas, doc_compose, doc_frame_paper, doc_frame_order } from './doc'
import { prepare_flip_audio } from './flipnote/audio'
import { exact_color, kwz_paper_index, nearest_color, ppm_colors, quantize_kwz_planes, quantize_ppm_planes } from './flipnote/color'
import { native_frame_scratch, native_kwz_project_frame, native_ppm_project_frame } from './flipnote/native'
import { hold_max, l_p, max_frames_flipnote, mode_3_d, mode_dsi } from './h'
import { canvas_make, canvas_to_blob, clamp, hex_rgb } from './lib'
import { mode_allows_layer_alpha } from './mode'
import { dispatch } from './state/commands/index'
import { st } from './state/store'
import { build_kwz_async, build_ppm_async } from './workercli'

function meta_for_kwz(): flip_meta_t {
  const m = { ...st().doc.meta }
  const now = Math.floor(Date.now() / 1000)
  if (!m.created) m.created = now
  m.modified = now
  if (!m.cur_id) m.cur_id = '0' + rand_hex(6) + '0' + rand_hex(8) + '0000'
  m.cur_fn = kwz_filename_make(m.cur_id, m.created, now)
  if (!m.root_fn) m.root_fn = m.cur_fn
  if (!m.parent_fn) m.parent_fn = m.root_fn
  if (!m.root_id) m.root_id = m.cur_id
  if (!m.parent_id) m.parent_id = m.root_id
  return m
}

function meta_for_ppm(): flip_meta_t {
  const m = { ...st().doc.meta }
  const now = Math.floor(Date.now() / 1000)
  if (!m.created) m.created = now
  m.modified = now
  m.edits = Math.min(999, (m.edits | 0) + 1)
  const mm = /^([0-9A-F]{6})_([0-9A-F]{13})_\d{3}$/.exec(m.cur_fn)
  const mac = mm ? mm[1] : rand_hex(6)
  const r13 = mm ? mm[2] : rand_hex(13)
  m.cur_fn = ppm_filename_format(mac, r13, m.edits)
  if (!m.root_fn) m.root_fn = m.cur_fn
  if (!m.parent_fn) m.parent_fn = m.cur_fn
  if (!m.cur_id) m.cur_id = '0' + rand_hex(6) + '0' + rand_hex(8)
  if (!m.root_id) m.root_id = m.cur_id
  if (!m.parent_id) m.parent_id = m.cur_id
  return m
}

function fit_rect(tw: number, th: number): [number, number, number, number] {
  const g = st()
  const s = Math.min(tw / g.doc.w, th / g.doc.h)
  const dw = g.doc.w * s
  const dh = g.doc.h * s
  return [(tw - dw) / 2, (th - dh) / 2, dw, dh]
}

function raster_all(i: number, tw: number, th: number, cx: CanvasRenderingContext2D): ImageData {
  const ord = doc_frame_order(i)
  const sources: number[] = [l_p]
  for (let k = ord.length - 1; k >= 0; k--) sources.push(ord[k])
  return raster_slot(i, sources, tw, th, cx)
}

function raster_slot(i: number, sources: number[], tw: number, th: number, cx: CanvasRenderingContext2D): ImageData {
  const g = st()
  cx.clearRect(0, 0, tw, th)
  cx.imageSmoothingEnabled = true
  const [dx, dy, dw, dh] = fit_rect(tw, th)
  for (const l of sources) {
    if (!g.doc.lvis[l]) continue
    const src = doc_layer_canvas(i, l)
    if (!src) continue
    cx.globalAlpha = mode_allows_layer_alpha(g.doc.mode) ? g.doc.lalpha[l] / 255 : 1
    cx.drawImage(src, dx, dy, dw, dh)
  }
  cx.globalAlpha = 1
  return cx.getImageData(0, 0, tw, th)
}

function raster_animated(job: Readonly<anim_out_job_t>, tw: number, th: number, cx: CanvasRenderingContext2D, source: HTMLCanvasElement, source_context: CanvasRenderingContext2D): ImageData {
  const g = st()
  const [dx, dy, dw, dh] = fit_rect(tw, th)
  const sw = Math.max(1, Math.round(dw))
  const sh = Math.max(1, Math.round(dh))
  if (source.width !== sw || source.height !== sh) {
    source.width = sw
    source.height = sh
  }
  source_context.clearRect(0, 0, sw, sh)
  animout_compose(job, source_context, sw, sh, 0, g.doc.fps, g.doc.anim)
  cx.clearRect(0, 0, tw, th)
  cx.imageSmoothingEnabled = true
  cx.drawImage(source, dx, dy, dw, dh)
  return cx.getImageData(0, 0, tw, th)
}

export function exp_kwz(on_p: (p: number) => void, done: (bytes: Uint8Array | null, note: string, filename: string) => void): void {
  let completed = 0
  const complete = (bytes: Uint8Array | null, note: string, filename: string): void => {
    if (completed) return
    completed = 1
    done(bytes, note, filename)
  }
  const xmeta = meta_for_kwz()
  dispatch('frame.sync_live', null)
  const g = st()
  const n = g.doc.frames.length
  const jobs = animout_jobs(g.doc.frames, 0, n - 1, g.doc.fps, g.doc.anim, 0)
  if (jobs.length > max_frames_flipnote) {
    complete(null, 'KWZは再生時の展開後' + max_frames_flipnote + 'コマまでです', '')
    return
  }
  const vw = kwz_canvas_w
  const vh = kwz_canvas_h
  const [, cx] = canvas_make(vw, vh, 1)
  const [animated_canvas, animated_context] = canvas_make(1, 1, 1)
  const animated = animfx_active(g.doc.anim)
  const frames: kwz_frame_t[] = []
  const native_ready = !animated && g.doc.mode === mode_3_d && g.doc.w === vw && g.doc.h === vh
  const native_scratch = native_frame_scratch(vw * vh)
  let job_index = 0
  let cached_frame = -1
  let cached_raster: { layers: [Uint8Array, Uint8Array, Uint8Array], colors: [number, number][], meta?: kwz_frame_t['meta'] } | null = null
  const step = (): void => {
    const started = performance.now()
    while (job_index < jobs.length && performance.now() - started < 24) {
      const job = jobs[job_index]
      const frame = g.doc.frames[job.frame]
      if (!pixel_source_ready(frame)) { void pixel_source_prepare(frame).then(step, error => complete(null, String(error), '')); return }
      const paper_idx = kwz_paper_index(doc_frame_paper(job.frame))
      let layers: [Uint8Array, Uint8Array, Uint8Array]
      let colors: [number, number][]
      if (animated) {
        const quantized = quantize_kwz_planes(raster_animated(job, vw, vh, cx, animated_canvas, animated_context))
        layers = [kwz_pad_plane(quantized.layers[0]), kwz_pad_plane(quantized.layers[1]), kwz_pad_plane(quantized.layers[2])]
        colors = quantized.colors
      } else {
        if (cached_frame !== job.frame || !cached_raster) {
          const native = native_ready ? native_kwz_project_frame(frame.pk, g.doc.lvis, g.doc.lalpha, native_scratch, frame.kwz?.colors) : null
          const quantized = native || quantize_kwz_planes(raster_all(job.frame, vw, vh, cx))
          cached_raster = {
            layers: [kwz_pad_plane(quantized.layers[0]), kwz_pad_plane(quantized.layers[1]), kwz_pad_plane(quantized.layers[2])],
            colors: quantized.colors,
            meta: native ? frame.kwz || { depth: [1, 2, 3].map(layer => doc_frame_order(job.frame).indexOf(layer)), colors: native.colors.flat(), author: xmeta.cur_id, camera: 0, reserved: 0 } : undefined,
          }
          cached_frame = job.frame
        }
        layers = cached_raster.layers
        colors = cached_raster.colors
      }
      frames.push({ layers, paper: paper_idx, colors, se: job.first ? frame.se & 0xf : 0, meta: animated ? undefined : cached_raster?.meta })
      job_index++
      on_p((job_index / jobs.length) * 0.8)
    }
    if (job_index < jobs.length) {
      task_schedule(step)
      return
    }
    finish()
  }
  const finish = () => {
    const current = g.doc.frames[Math.min(g.doc.cur, g.doc.frames.length - 1)]
    if (!pixel_source_ready(current)) { void pixel_source_prepare(current).then(finish, error => complete(null, String(error), '')); return }
    const [tc, tx] = canvas_make(80, 64)
    const thumb_frame = Math.min(g.doc.cur, g.doc.frames.length - 1)
    if (animated) animfx_compose(thumb_frame, tx, 80, 64, 1, animfx_time_for_tick(thumb_frame_idx(), g.doc.fps))
    else doc_compose(thumb_frame, tx, 80, 64, 1)
    tx.globalCompositeOperation = 'destination-over'
    tx.fillStyle = '#FFFFFF'
    tx.fillRect(0, 0, 80, 64)
    tx.globalCompositeOperation = 'source-over'
    canvas_to_blob(tc, 'image/jpeg', 0.85, (blob, blob_error) => {
      if (!blob) {
        report_warning('KWZサムネイルを作成できませんでした', blob_error)
        complete(null, 'サムネイルを作れませんでした', '')
        return
      }
      blob.arrayBuffer().then(
        buffer => {
          try {
            on_p(0.9)
            const audio = prepare_flip_audio('kwz')
            build_kwz_async(
              {
                frames,
                speed: kwz_speed_from_fps(g.doc.fps),
                loop: g.doc.loop,
                name: g.doc.name.slice(0, 10),
                thumb_jpeg: new Uint8Array(buffer),
                thumb_idx: thumb_frame_idx(),
                bgm: audio.bgm,
                se: audio.se,
                meta: xmeta,
              },
              (bytes, error) => {
                on_p(1)
                if (!bytes) {
                  complete(null, error || 'KWZの生成に失敗', '')
                  return
                }
                dispatch('doc.set_meta', xmeta)
                complete(bytes, frames.length !== n ? animated ? '再生時の動きとホールドをコマへ展開しました' : 'ホールドはコマ複製で再現しました' : '', xmeta.cur_fn + '.kwz')
              }
            )
          } catch (error) {
            report_warning('KWZ書き出しデータを準備できませんでした', error)
            complete(null, 'KWZの生成準備に失敗', '')
          }
        },
        error => {
          report_warning('KWZサムネイルを読み出せませんでした', error)
          complete(null, 'サムネイルを読めませんでした', '')
        }
      )
    })
  }
  step()
}

const ppm_thumb_pal: [number, number, number][] = [
  [255, 255, 255],
  [82, 82, 82],
  [255, 255, 255],
  [156, 156, 156],
  [255, 72, 68],
  [200, 81, 79],
  [255, 173, 172],
  [0, 255, 0],
  [72, 64, 255],
  [81, 79, 184],
  [173, 171, 255],
  [0, 255, 0],
  [182, 87, 183],
]

function thumb_frame_idx(): number {
  const g = st()
  let t = 0
  const cur = Math.min(g.doc.cur, g.doc.frames.length - 1)
  for (let k = 0; k < cur; k++) t += clamp(g.doc.frames[k].hold, 1, hold_max)
  return t
}

function ppm_thumb(): Uint8Array {
  const g = st()
  const [, tx] = canvas_make(64, 48)
  tx.fillStyle = '#FFFFFF'
  tx.fillRect(0, 0, 64, 48)
  const frame = Math.min(g.doc.cur, g.doc.frames.length - 1)
  if (animfx_active(g.doc.anim)) animfx_compose(frame, tx, 64, 48, 1, animfx_time_for_tick(thumb_frame_idx(), g.doc.fps))
  else doc_compose(frame, tx, 64, 48, 1)
  const img = tx.getImageData(0, 0, 64, 48)
  const out = new Uint8Array(1536)
  let off = 0
  for (let ty = 0; ty < 48; ty += 8) {
    for (let txx = 0; txx < 64; txx += 8) {
      for (let line = 0; line < 8; line++) {
        for (let px = 0; px < 8; px += 2) {
          const x0 = txx + px
          const y0 = ty + line
          const p0 = (y0 * 64 + x0) * 4
          const p1 = (y0 * 64 + x0 + 1) * 4
          const a = nearest_color(img.data[p0], img.data[p0 + 1], img.data[p0 + 2], ppm_thumb_pal)
          const b = nearest_color(img.data[p1], img.data[p1 + 1], img.data[p1 + 2], ppm_thumb_pal)
          out[off++] = (a & 0xf) | ((b & 0xf) << 4)
        }
      }
    }
  }
  return out
}

export function exp_ppm(on_p: (p: number) => void, done: (bytes: Uint8Array | null, note: string, filename: string) => void): void {
  const xmeta = meta_for_ppm()
  dispatch('frame.sync_live', null)
  const g = st()
  const n = g.doc.frames.length
  const jobs = animout_jobs(g.doc.frames, 0, n - 1, g.doc.fps, g.doc.anim, 0)
  if (jobs.length > max_frames_flipnote) {
    done(null, 'PPMは再生時の展開後' + max_frames_flipnote + 'コマまでです', '')
    return
  }
  const [, cx] = canvas_make(ppm_w, ppm_h, 1)
  const [animated_canvas, animated_context] = canvas_make(1, 1, 1)
  const animated = animfx_active(g.doc.anim)
  const frames: ppm_frame_t[] = []
  const native_ready = !animated && g.doc.mode === mode_dsi && g.doc.w === ppm_w && g.doc.h === ppm_h
  const native_scratch = native_frame_scratch(ppm_w * ppm_h)
  let dropped = 0
  let job_index = 0
  let cached_frame = -1
  let cached_layers: [Uint8Array, Uint8Array] | null = null
  let cached_pens: [number, number] | null = null
  const step = (): void => {
    const started = performance.now()
    while (job_index < jobs.length && performance.now() - started < 24) {
      const job = jobs[job_index]
      const frame = g.doc.frames[job.frame]
      if (!pixel_source_ready(frame)) { void pixel_source_prepare(frame).then(step, error => done(null, String(error), '')); return }
      const paper_rgb = hex_rgb(doc_frame_paper(job.frame).slice(0, 7))
      const paper_index = nearest_color(...paper_rgb, ppm_colors.slice(0, 2))
      const paper = paper_index === 0 ? 1 : 0
      const native_paper = exact_color(...paper_rgb, ppm_colors.slice(0, 2))
      if (frame.se & 0x8) dropped = 1
      let layers: [Uint8Array, Uint8Array]
      let pens: [number, number]
      if (animated) {
        const quantized = quantize_ppm_planes(raster_animated(job, ppm_w, ppm_h, cx, animated_canvas, animated_context), paper)
        layers = [quantized.layers[0], quantized.layers[1]]
        pens = [quantized.pens[0], quantized.pens[1]]
      } else {
        if (cached_frame !== job.frame || !cached_layers || !cached_pens) {
          const order = doc_frame_order(job.frame)
          const slots = [0, ...order, 3]
          const native = native_ready && native_paper >= 0 ? native_ppm_project_frame(slots.map(layer => layer === 3 ? null : frame.pk[layer]), slots.map(layer => layer === 3 ? 0 : g.doc.lvis[layer]), slots.map(layer => g.doc.lalpha[layer]), native_paper, native_scratch) : null
          const quantized = native || quantize_ppm_planes(raster_all(job.frame, ppm_w, ppm_h, cx), paper)
          cached_layers = [quantized.layers[0], quantized.layers[1]]
          cached_pens = [quantized.pens[0], quantized.pens[1]]
          cached_frame = job.frame
        }
        layers = cached_layers
        pens = cached_pens
      }
      frames.push({ layers, paper, pen: pens, se: job.first ? frame.se & 0x7 : 0 })
      job_index++
      on_p((job_index / jobs.length) * 0.85)
    }
    if (job_index < jobs.length) {
      task_schedule(step)
      return
    }
    if (!pixel_source_ready(g.doc.frames[g.doc.cur])) { void pixel_source_prepare(g.doc.frames[g.doc.cur]).then(step, error => done(null, String(error), '')); return }
    const audio = prepare_flip_audio('ppm')
    build_ppm_async(
      {
        frames,
        speed: ppm_speed_from_fps(g.doc.fps),
        loop: g.doc.loop,
        name: g.doc.name.slice(0, 10),
        thumb: ppm_thumb(),
        thumb_idx: thumb_frame_idx(),
        bgm: audio.bgm,
        se: audio.se,
        meta: xmeta,
      },
      (bytes, err) => {
        on_p(1)
        if (!bytes) {
          done(null, err || 'PPMの生成に失敗', '')
          return
        }
        const notes: string[] = []
        if (dropped) notes.push('SE4はPPM非対応なので外しました')
        if (frames.length !== n) notes.push(animated ? '再生時の動きとホールドをコマへ展開' : 'ホールドはコマ複製で再現')
        dispatch('doc.set_meta', xmeta)
        done(bytes, notes.join('・'), ppm_filename_local(xmeta.cur_fn) + '.ppm')
      }
    )
  }
  step()
}
