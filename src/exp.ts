import { animfx_active, animfx_compose, animfx_time_for_tick } from './animfx'
import { animout_compose, animout_jobs, type AnimOutJob } from './animout'
import { kwz_filename_make, ppm_filename_format, ppm_filename_local, rand_hex } from './codec/fname'
import { kwz_speed_from_fps, type KwzFrame } from './codec/kwz'
import type { FlipMeta } from './codec/kwzdec'
import { KWZ_CANVAS_W, KWZ_CANVAS_H, kwz_pad_plane } from './codec/kwzgeom'
import { ppm_speed_from_fps, PPM_W, PPM_H, type PpmFrame } from './codec/ppm'
import { report_warning } from './diagnostics'
import { doc_layer_canvas, doc_compose } from './doc'
import { prepare_flip_audio } from './flipnote/audio'
import { exact_color, KWZ_COLORS, nearest_color, PPM_COLORS, quantize_kwz_planes, quantize_ppm_planes } from './flipnote/color'
import { native_frame_scratch, native_kwz_project_frame, native_ppm_project_frame } from './flipnote/native'
import { HOLD_MAX, L_P, MAX_FRAMES_FLIPNOTE, MODE_3D, MODE_DSI } from './h'
import { canvas_make, canvas_to_blob, clamp, hex_rgb } from './lib'
import { mode_allows_layer_alpha, mode_order } from './mode'
import { dispatch } from './state/commands/index'
import { st } from './state/store'
import { build_kwz_async, build_ppm_async } from './workercli'

function meta_for_kwz(): FlipMeta {
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

function meta_for_ppm(): FlipMeta {
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
  const g = st()
  const ord = mode_order(g.doc.mode, g.doc.lord)
  const sources: number[] = [L_P]
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

function raster_animated(job: Readonly<AnimOutJob>, tw: number, th: number, cx: CanvasRenderingContext2D, source: HTMLCanvasElement, sourceContext: CanvasRenderingContext2D): ImageData {
  const g = st()
  const [dx, dy, dw, dh] = fit_rect(tw, th)
  const sw = Math.max(1, Math.round(dw))
  const sh = Math.max(1, Math.round(dh))
  if (source.width !== sw || source.height !== sh) {
    source.width = sw
    source.height = sh
  }
  sourceContext.clearRect(0, 0, sw, sh)
  animout_compose(job, sourceContext, sw, sh, 0, g.doc.fps, g.doc.anim)
  cx.clearRect(0, 0, tw, th)
  cx.imageSmoothingEnabled = true
  cx.drawImage(source, dx, dy, dw, dh)
  return cx.getImageData(0, 0, tw, th)
}

export function exp_kwz(onP: (p: number) => void, done: (bytes: Uint8Array | null, note: string, filename: string) => void): void {
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
  if (jobs.length > MAX_FRAMES_FLIPNOTE) {
    complete(null, 'KWZは再生時の展開後' + MAX_FRAMES_FLIPNOTE + 'コマまでです', '')
    return
  }
  const VW = KWZ_CANVAS_W
  const VH = KWZ_CANVAS_H
  const [, cx] = canvas_make(VW, VH, 1)
  const [animatedCanvas, animatedContext] = canvas_make(1, 1, 1)
  const animated = animfx_active(g.doc.anim)
  const frames: KwzFrame[] = []
  const paperRgb = hex_rgb(g.doc.paper)
  const paperIdx = nearest_color(...paperRgb, KWZ_COLORS)
  const nativePaper = exact_color(...paperRgb, KWZ_COLORS)
  const nativeReady = !animated && g.doc.mode === MODE_3D && g.doc.w === VW && g.doc.h === VH && nativePaper >= 0
  const nativeScratch = native_frame_scratch(VW * VH)
  let jobIndex = 0
  let cachedFrame = -1
  let cachedRaster: { layers: [Uint8Array, Uint8Array, Uint8Array], colors: [number, number][] } | null = null
  const step = (): void => {
    const started = performance.now()
    while (jobIndex < jobs.length && performance.now() - started < 24) {
      const job = jobs[jobIndex]
      const frame = g.doc.frames[job.frame]
      let layers: [Uint8Array, Uint8Array, Uint8Array]
      let colors: [number, number][]
      if (animated) {
        const quantized = quantize_kwz_planes(raster_animated(job, VW, VH, cx, animatedCanvas, animatedContext))
        layers = [kwz_pad_plane(quantized.layers[0]), kwz_pad_plane(quantized.layers[1]), kwz_pad_plane(quantized.layers[2])]
        colors = quantized.colors
      } else {
        if (cachedFrame !== job.frame || !cachedRaster) {
          const native = nativeReady ? native_kwz_project_frame(frame.pk, g.doc.lvis, g.doc.lalpha, nativeScratch) : null
          const quantized = native || quantize_kwz_planes(raster_all(job.frame, VW, VH, cx))
          cachedRaster = {
            layers: [kwz_pad_plane(quantized.layers[0]), kwz_pad_plane(quantized.layers[1]), kwz_pad_plane(quantized.layers[2])],
            colors: quantized.colors,
          }
          cachedFrame = job.frame
        }
        layers = cachedRaster.layers
        colors = cachedRaster.colors
      }
      frames.push({ layers, paper: paperIdx, colors, se: job.first ? frame.se & 0xf : 0 })
      jobIndex++
      onP((jobIndex / jobs.length) * 0.8)
    }
    if (jobIndex < jobs.length) {
      setTimeout(step, 0)
      return
    }
    finish()
  }
  const finish = () => {
    const [tc, tx] = canvas_make(80, 64)
    tx.fillStyle = '#FFFFFF'
    tx.fillRect(0, 0, 80, 64)
    const thumbFrame = Math.min(g.doc.cur, g.doc.frames.length - 1)
    if (animated) animfx_compose(thumbFrame, tx, 80, 64, 1, animfx_time_for_tick(thumb_frame_idx(), g.doc.fps))
    else doc_compose(thumbFrame, tx, 80, 64, 1)
    canvas_to_blob(tc, 'image/jpeg', 0.85, (blob, blobError) => {
      if (!blob) {
        report_warning('KWZサムネイルを作成できませんでした', blobError)
        complete(null, 'サムネイルを作れませんでした', '')
        return
      }
      blob.arrayBuffer().then(
        buffer => {
          try {
            onP(0.9)
            const audio = prepare_flip_audio('kwz')
            build_kwz_async(
              {
                frames,
                speed: kwz_speed_from_fps(g.doc.fps),
                loop: g.doc.loop,
                name: g.doc.name.slice(0, 10),
                thumbJpeg: new Uint8Array(buffer),
                thumbIdx: thumb_frame_idx(),
                bgm: audio.bgm,
                se: audio.se,
                meta: xmeta,
              },
              (bytes, error) => {
                onP(1)
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

const PPM_THUMB_PAL: [number, number, number][] = [
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
  for (let k = 0; k < cur; k++) t += clamp(g.doc.frames[k].hold, 1, HOLD_MAX)
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
          const a = nearest_color(img.data[p0], img.data[p0 + 1], img.data[p0 + 2], PPM_THUMB_PAL)
          const b = nearest_color(img.data[p1], img.data[p1 + 1], img.data[p1 + 2], PPM_THUMB_PAL)
          out[off++] = (a & 0xf) | ((b & 0xf) << 4)
        }
      }
    }
  }
  return out
}

export function exp_ppm(onP: (p: number) => void, done: (bytes: Uint8Array | null, note: string, filename: string) => void): void {
  const xmeta = meta_for_ppm()
  dispatch('frame.sync_live', null)
  const g = st()
  const n = g.doc.frames.length
  const jobs = animout_jobs(g.doc.frames, 0, n - 1, g.doc.fps, g.doc.anim, 0)
  if (jobs.length > MAX_FRAMES_FLIPNOTE) {
    done(null, 'PPMは再生時の展開後' + MAX_FRAMES_FLIPNOTE + 'コマまでです', '')
    return
  }
  const [, cx] = canvas_make(PPM_W, PPM_H, 1)
  const [animatedCanvas, animatedContext] = canvas_make(1, 1, 1)
  const animated = animfx_active(g.doc.anim)
  const frames: PpmFrame[] = []
  const paperRgb = hex_rgb(g.doc.paper)
  const paperIndex = nearest_color(...paperRgb, PPM_COLORS.slice(0, 2))
  const paper = paperIndex === 0 ? 1 : 0
  const nativePaper = exact_color(...paperRgb, PPM_COLORS.slice(0, 2))
  const nativeReady = !animated && g.doc.mode === MODE_DSI && g.doc.w === PPM_W && g.doc.h === PPM_H && nativePaper >= 0
  const nativeScratch = native_frame_scratch(PPM_W * PPM_H)
  let dropped = 0
  let jobIndex = 0
  let cachedFrame = -1
  let cachedLayers: [Uint8Array, Uint8Array] | null = null
  let cachedPens: [number, number] | null = null
  const step = (): void => {
    const started = performance.now()
    while (jobIndex < jobs.length && performance.now() - started < 24) {
      const job = jobs[jobIndex]
      const frame = g.doc.frames[job.frame]
      if (frame.se & 0x8) dropped = 1
      let layers: [Uint8Array, Uint8Array]
      let pens: [number, number]
      if (animated) {
        const quantized = quantize_ppm_planes(raster_animated(job, PPM_W, PPM_H, cx, animatedCanvas, animatedContext), paper)
        layers = [quantized.layers[0], quantized.layers[1]]
        pens = [quantized.pens[0], quantized.pens[1]]
      } else {
        if (cachedFrame !== job.frame || !cachedLayers || !cachedPens) {
          const native = nativeReady ? native_ppm_project_frame(frame.pk, g.doc.lvis, g.doc.lalpha, nativePaper, nativeScratch) : null
          const quantized = native || quantize_ppm_planes(raster_all(job.frame, PPM_W, PPM_H, cx), paper)
          cachedLayers = [quantized.layers[0], quantized.layers[1]]
          cachedPens = [quantized.pens[0], quantized.pens[1]]
          cachedFrame = job.frame
        }
        layers = cachedLayers
        pens = cachedPens
      }
      frames.push({ layers, paper, pen: pens, se: job.first ? frame.se & 0x7 : 0 })
      jobIndex++
      onP((jobIndex / jobs.length) * 0.85)
    }
    if (jobIndex < jobs.length) {
      setTimeout(step, 0)
      return
    }
    const audio = prepare_flip_audio('ppm')
    build_ppm_async(
      {
        frames,
        speed: ppm_speed_from_fps(g.doc.fps),
        loop: g.doc.loop,
        name: g.doc.name.slice(0, 10),
        thumb: ppm_thumb(),
        thumbIdx: thumb_frame_idx(),
        bgm: audio.bgm,
        se: audio.se,
        meta: xmeta,
      },
      (bytes, err) => {
        onP(1)
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
