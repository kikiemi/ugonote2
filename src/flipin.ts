import { kwz_frame_meta_clone } from './codec/kwzmeta'
import { kwz_decode } from './codec/kwzdec'
import { kwz_border, kwz_canvas_w, kwz_canvas_h, kwz_frame_w, kwz_frame_h } from './codec/kwzgeom'
import { ppm_decode } from './codec/ppmdec'
import { report_warning } from './diagnostics'
import { kwz_paper_hex } from './flipnote/color'
import { doc_frame_new } from './doc'
import { kwz_pal, l_n, max_frames_flipnote, mode_3_d, mode_dsi } from './h'
import { canvas_make, rle_pack, hex_rgb, wav_encode } from './lib'
import { snd_load_epoch } from './snd'
import { dispatch, type flip_loaded_t } from './state/commands/index'
import { snd_load_bytes } from './ui/sound_io'

function pack_rgba(c: HTMLCanvasElement, x: CanvasRenderingContext2D): Uint32Array {
  const img = x.getImageData(0, 0, c.width, c.height)
  return rle_pack(new Uint32Array(img.data.buffer))
}

type flip_parsed_t = { d: flip_loaded_t, n: number, bgm: Int16Array | null, rate: number, bgm_fps: number, se: (Int16Array | null)[] }

function ppm_to_frames(buf: ArrayBuffer): flip_parsed_t | null {
  const dec = ppm_decode(buf)
  if (!dec) return null
  const n = Math.min(dec.frame_count, max_frames_flipnote)
  const frames = []
  for (let f = 0; f < n; f++) {
    const fr = doc_frame_new()
    const white_paper = dec.paper[f] === 1
    fr.paper = white_paper ? '#FFFFFF' : '#0E0E0E'
    const inv = white_paper ? '#0E0E0E' : '#FFFFFF'
    const pen_map = [inv, inv, '#FF2A2A', '#0A39FF']
    const pen_hex = dec.pen_idx[f].map(i => pen_map[i & 3])
    for (let l = 0; l < 2; l++) {
      const [c, x] = canvas_make(dec.w, dec.h)
      const img = x.createImageData(dec.w, dec.h)
      const [pr, pg, pb] = hex_rgb(pen_hex[l])
      const src = dec.layers[f][l]
      for (let i = 0; i < src.length; i++) {
        if (src[i]) {
          img.data[i * 4] = pr
          img.data[i * 4 + 1] = pg
          img.data[i * 4 + 2] = pb
          img.data[i * 4 + 3] = 255
        }
      }
      x.putImageData(img, 0, 0)
      fr.pk[l + 1] = pack_rgba(c, x)
    }
    fr.se = dec.se_flags[f]
    frames.push(fr)
  }
  const d: flip_loaded_t = {
    mode: mode_dsi, w: dec.w, h: dec.h, ratio: '4:3', res: 'dsi',
    fps: dec.fps, loop: dec.loop,
    paper: dec.paper[0] === 1 ? '#FFFFFF' : '#0E0E0E',
    meta: dec.meta,
    frames, cur: Math.min(dec.thumb_idx, n - 1),
    bgm: dec.bgm, bgm_rate: dec.bgm_rate, bgm_fps: dec.bgm_fps, se: dec.se,
  }
  return { d, n, bgm: dec.bgm, rate: dec.bgm_rate, bgm_fps: dec.bgm_fps, se: dec.se }
}

function kwz_to_frames(buf: ArrayBuffer): flip_parsed_t | null {
  const dec = kwz_decode(buf)
  if (!dec || dec.w !== kwz_frame_w || dec.h !== kwz_frame_h) return null
  const n = Math.min(dec.frame_count, max_frames_flipnote)
  const frames = []
  for (let f = 0; f < n; f++) {
    const fr = doc_frame_new()
    fr.paper = kwz_paper_hex(dec.paper[f])
    const col = dec.frame_colors[f]
    fr.kwz = kwz_frame_meta_clone(dec.frame_meta[f])
    for (let k = 0; k < 3 && k + 1 < l_n; k++) {
      const l = k
      const vw = kwz_canvas_w
      const vh = kwz_canvas_h
      const [c, x] = canvas_make(vw, vh)
      const img = x.createImageData(vw, vh)
      const ca = kwz_pal[col[l * 2]] || kwz_pal[1]
      const cb = kwz_pal[col[l * 2 + 1]] || kwz_pal[1]
      const src = dec.layers[f][l]
      for (let y = 0; y < vh; y++) {
        for (let xx = 0; xx < vw; xx++) {
          const v = src[(y + kwz_border) * dec.w + xx + kwz_border]
          if (!v || col[l * 2 + (v === 1 ? 0 : 1)] === 6) continue
          const cc = v === 1 ? ca : cb
          const di = (y * vw + xx) * 4
          img.data[di] = cc[0]
          img.data[di + 1] = cc[1]
          img.data[di + 2] = cc[2]
          img.data[di + 3] = 255
        }
      }
      x.putImageData(img, 0, 0)
      fr.pk[1 + k] = pack_rgba(c, x)
    }
    fr.se = dec.se_flags[f]
    frames.push(fr)
  }
  const p_count = [0, 0, 0, 0, 0, 0]
  for (const pv of dec.paper) if (pv >= 0 && pv <= 5) p_count[pv]++
  let p_idx = 0
  for (let i = 1; i < 6; i++) if (p_count[i] > p_count[p_idx]) p_idx = i
  const pp = kwz_pal[p_idx]
  const d: flip_loaded_t = {
    mode: mode_3_d, w: kwz_canvas_w, h: kwz_canvas_h, ratio: '4:3', res: '3ds',
    fps: dec.fps, loop: dec.loop,
    paper: '#' + ((1 << 24) | (pp[0] << 16) | (pp[1] << 8) | pp[2]).toString(16).slice(1).toUpperCase(),
    meta: dec.meta,
    frames, cur: Math.min(dec.thumb_idx, n - 1),
    bgm: dec.bgm, bgm_rate: dec.bgm_rate, bgm_fps: dec.bgm_fps, se: dec.se,
  }
  return { d, n, bgm: dec.bgm, rate: dec.bgm_rate, bgm_fps: dec.bgm_fps, se: dec.se }
}

function i16_to_f32(src: Int16Array): Float32Array {
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = src[i] / 32768
  return out
}

function load_audio(bgm: Int16Array | null, bgm_rate: number, se: (Int16Array | null)[], epoch: number, done: (stale: number) => void): void {
  const jobs: { kind: string, pcm: Int16Array, rate: number }[] = []
  if (bgm && bgm.length) jobs.push({ kind: 'bgm0', pcm: bgm, rate: bgm_rate })
  for (let i = 0; i < 4 && i < se.length; i++) {
    const s = se[i]
    if (s && s.length) jobs.push({ kind: 'se' + i, pcm: s, rate: bgm_rate })
  }
  let left = jobs.length
  if (!left) {
    done(snd_load_epoch() === epoch ? 0 : 1)
    return
  }
  for (const j of jobs) {
    const wav = wav_encode([i16_to_f32(j.pcm)], j.rate)
    snd_load_bytes(j.kind, wav, 'うごメモ', () => {
      left--
      if (left === 0) done(snd_load_epoch() === epoch ? 0 : 1)
    })
  }
}

export function flip_import(file: File, done: (added: number, kind: string) => void, current: () => boolean = () => true): void {
  const request_epoch = snd_load_epoch()
  file
    .arrayBuffer()
    .then(buf => {
      if (request_epoch !== snd_load_epoch() || !current()) { done(-1, ''); return }
      const ext = file.name.toLowerCase()
      const b = new Uint8Array(buf)
      const is_ppm = ext.endsWith('.ppm') || (b[0] === 0x50 && b[1] === 0x41 && b[2] === 0x52 && b[3] === 0x41)
      const kind = is_ppm ? 'PPM' : 'KWZ'
      const res = is_ppm ? ppm_to_frames(buf) : kwz_to_frames(buf)
      if (!res || !res.n) {
        done(0, kind)
        return
      }
      if (dispatch('project.apply_flip', res.d) < 0) {
        done(0, kind)
        return
      }
      const epoch = snd_load_epoch()
      load_audio(res.bgm, res.rate, res.se, epoch, stale => {
        done(stale ? -1 : res.n, kind)
      })
    })
    .catch(error => {
      if (request_epoch !== snd_load_epoch() || !current()) { done(-1, ''); return }
      report_warning('うごメモファイルの読み込みに失敗しました', error)
      done(0, '')
    })
}
