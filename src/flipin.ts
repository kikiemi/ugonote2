import { kwz_frame_meta_clone } from './codec/kwzmeta'
import { kwz_decode } from './codec/kwzdec'
import { kwz_border, kwz_canvas_w, kwz_canvas_h, kwz_frame_w, kwz_frame_h } from './codec/kwzgeom'
import { ppm_decode } from './codec/ppmdec'
import { report_warning } from './diagnostics'
import { kwz_paper_hex } from './flipnote/color'
import { doc_frame_new } from './doc'
import { kwz_pal, l_n, max_frames_flipnote, mode_3_d, mode_dsi, mode_normal } from './h'
import { grow4 } from './flipnote/bitmap'
import { flip_fit } from './flipnote/fit'
import { hide_covered, type smooth_ink_t } from './flipnote/layer_read'
import type { smooth_out_t } from './flipnote/smooth'
import { smooth_pool_open } from './flipnote/smooth_pool'
import { canvas_make, rle_pack, hex_rgb, wav_encode } from './lib'
import { app_asset } from './runtime'
import { snd_load_epoch } from './snd'
import { dispatch, type flip_loaded_t } from './state/commands/index'
import { snd_load_bytes } from './ui/sound_io'

function pack_rgba(c: HTMLCanvasElement, x: CanvasRenderingContext2D): Uint32Array {
  const img = x.getImageData(0, 0, c.width, c.height)
  return rle_pack(new Uint32Array(img.data.buffer))
}

type flip_parsed_t = { d: flip_loaded_t, n: number, bgm: Int16Array | null, rate: number, bgm_fps: number, se: (Int16Array | null)[] }

// 通常モードへ描きなおすための、コマごとの絵 (レイヤーごとの、色ごとの点の集まり)。
type flip_frame_t = { paper: string, layers: smooth_ink_t[][], se: number }
type flip_source_t = { w: number, h: number, frame: (f: number) => flip_frame_t }

function ppm_frame(dec: NonNullable<ReturnType<typeof ppm_decode>>, f: number): flip_frame_t {
  const white_paper = dec.paper[f] === 1
  const inv = white_paper ? '#0E0E0E' : '#FFFFFF'
  const pen_map = [inv, inv, '#FF2A2A', '#0A39FF']
  return {
    paper: white_paper ? '#FFFFFF' : '#0E0E0E',
    layers: [0, 1].map(l => [{ rgb: hex_rgb(pen_map[dec.pen_idx[f][l] & 3]), mask: dec.layers[f][l] }]),
    se: dec.se_flags[f],
  }
}

function kwz_frame(dec: NonNullable<ReturnType<typeof kwz_decode>>, f: number): flip_frame_t {
  const col = dec.frame_colors[f]
  const w = kwz_canvas_w
  const h = kwz_canvas_h
  const layers: smooth_ink_t[][] = []
  for (let l = 0; l < 3; l++) {
    const inks: smooth_ink_t[] = []
    for (let v = 1; v <= 2; v++) {
      const color = col[l * 2 + v - 1]
      if (color === 6) continue
      const mask = new Uint8Array(w * h)
      const src = dec.layers[f][l]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) if (src[(y + kwz_border) * dec.w + x + kwz_border] === v) mask[y * w + x] = 1
      }
      inks.push({ rgb: kwz_pal[color] || kwz_pal[1], mask })
    }
    layers.push(inks)
  }
  return { paper: kwz_paper_hex(dec.paper[f]), layers, se: dec.se_flags[f] }
}

// 同じ絵のレイヤーは描きなおしを1回ですませるための目印 (色と点の並びから作る 64 ビットのハッシュ)。
function inks_key(inks: smooth_ink_t[]): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (const ink of inks) {
    for (const v of [...ink.rgb, 256]) {
      a = Math.imul(a ^ v, 0x01000193)
      b = Math.imul(b ^ v, 0x5bd1e995) + 0x9e3779b9
    }
    const m = ink.mask
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue
      a = Math.imul(a ^ i, 0x01000193)
      b = Math.imul(b ^ i, 0x5bd1e995) + 0x9e3779b9
    }
  }
  return (a >>> 0).toString(36) + ':' + (b >>> 0).toString(36)
}

// 列ごと・行ごとの、線や形のある割合 (0〜1)。48 コマまでを選んで、たてよこにとなりのある点 (線や形の点。
// 市松やあみ点の、ばらばらの点は数えない) を数える。キャンバスへのばすときに、絵のある所をなるべくのばさないために使う。
function flip_ink(src: flip_source_t, count: number): { x: Float64Array, y: Float64Array } {
  const { w, h } = src
  const x_ink = new Float64Array(w)
  const y_ink = new Float64Array(h)
  const step = Math.max(1, Math.floor(count / 48))
  let frames = 0
  const any = new Uint8Array(w * h)
  for (let f = 0; f < count; f += step) {
    any.fill(0)
    for (const inks of src.frame(f).layers) for (const ink of inks) for (let i = 0; i < w * h; i++) any[i] |= ink.mask[i]
    for (let i = 0; i < w * h; i++) {
      if (!any[i]) continue
      const x = i % w
      if (!(x > 0 && any[i - 1] || x < w - 1 && any[i + 1] || i >= w && any[i - w] || i + w < w * h && any[i + w])) continue
      x_ink[x]++
      y_ink[(i - x) / w]++
    }
    frames++
  }
  for (let x = 0; x < w; x++) x_ink[x] /= Math.max(1, frames * h)
  for (let y = 0; y < h; y++) y_ink[y] /= Math.max(1, frames * w)
  return { x: x_ink, y: y_ink }
}

async function ai_weights(): Promise<ArrayBuffer | null> {
  const inline = (globalThis as { __ug2_ai_lines?: string }).__ug2_ai_lines
  if (inline) return Uint8Array.from(atob(inline), c => c.charCodeAt(0)).buffer
  return fetch(app_asset('assets/ai/lines-v3.bin')).then(r => r.ok ? r.arrayBuffer() : null, () => null)
}

// うごメモの作品を、通常モードのキャンバスへ描きなおす。線は通常モードのペンの線に、模様は色の塗りに。
// 絵の置き方は fit.ts (stretch が 0 ならそのままの形でまん中へ、1 ならキャンバスいっぱいにのばす)。
// うごメモのレイヤー1枚を「線」と「塗り」の2枚に分ける (上から 線A・塗りA・線B・塗りB…)。
// レイヤーごとの描きなおしは Worker に分けて同時に進め、同じ絵のレイヤーは1回だけ描く。
async function flip_to_normal(src: flip_source_t, base: flip_parsed_t, normal: flip_normal_t, current: () => boolean): Promise<flip_parsed_t | null> {
  const { w, h, keep, progress } = normal
  const ink = normal.stretch ? flip_ink(src, base.n) : { x: new Float64Array(src.w), y: new Float64Array(src.h) }
  const { xs, ys, scale } = flip_fit(src.w, src.h, w, h, ink.x, ink.y, normal.stretch)
  // AI を使うときは重みを読みこむ (読めなければ、ふつうに描く)。1つのファイルにまとめた版では、ページに入れてある。
  const ai = normal.ai ? await ai_weights() : null
  const pool = smooth_pool_open(w * h, ai)
  const jobs = new Map<string, Promise<smooth_out_t>>()
  const frames = base.d.frames.map(() => doc_frame_new())
  const parts: [number, number, Promise<smooth_out_t>][] = []
  let layer_n = 0
  const pending = new Set<Promise<unknown>>()
  let finished = 0
  let stop = 0
  // 進み具合は、まだ見ていないコマの仕事の数も見こんで求め、もどらないようにする
  // (見たコマの仕事の数だけでわると、仕事がふえるたびにバーが行ったり来たりする)。
  let seen = 0
  let shown = 0
  const report = (): void => {
    const total = jobs.size * base.n / Math.max(1, seen)
    const p = Math.min(1, finished / Math.max(1, total))
    if (p <= shown) return
    shown = p
    progress(p)
  }
  try {
    for (let f = 0; f < base.n; f++) {
      const s = src.frame(f)
      const fr = frames[f]
      fr.paper = s.paper
      fr.se = s.se
      layer_n = Math.max(layer_n, s.layers.length)
      const layers = hide_covered(s.layers, src.w, src.h)
      for (let l = 0; l < layers.length; l++) {
        const used = layers[l].inks.filter(ink => ink.mask.includes(1))
        if (!used.length) continue
        // おおわれている所は、このレイヤーの絵の近く (3点以内) だけを使う (遠くの上の絵がかわっても、同じ絵として1回で描けるように)。
        const ink_at = new Uint8Array(src.w * src.h)
        for (const ink of used) for (let i = 0; i < ink_at.length; i++) ink_at[i] |= ink.mask[i]
        const near = grow4(ink_at, src.w, src.h, 3)
        const covered = layers[l].covered.map((v, i) => v && near[i] ? 1 : 0)
        const paper = hex_rgb(s.paper)
        const key = inks_key([...used, { rgb: paper, mask: covered }])
        let job = jobs.get(key)
        if (!job) {
          job = pool.run({ inks: used, covered, paper, w: src.w, h: src.h, out_w: w, out_h: h, xs, ys, scale, lines: normal.lines, keep, ai: ai ? normal.ai : 0 })
          const settled: Promise<unknown> = job.then(() => {
            finished++
            report()
          }, () => {}).finally(() => pending.delete(settled))
          pending.add(settled)
          jobs.set(key, job)
        }
        parts.push([f, l, job])
      }
      seen = f + 1
      // 描き終わるのを待ちながら進める (まだの仕事をためこみすぎない)。
      while (pending.size > pool.size * 3) {
        await Promise.race(pending)
        if (!current()) {
          stop = 1
          return null
        }
      }
    }
    for (const [f, l, job] of parts) {
      const packed = await job
      frames[f].pk[l * 2 + 1] = packed.line
      frames[f].pk[l * 2 + 2] = packed.fill
      if (!current()) {
        stop = 1
        return null
      }
    }
  } finally {
    pool.close()
    if (stop) jobs.clear()
  }
  const lord = Array.from({ length: layer_n * 2 }, (_, i) => i + 1)
  const d: flip_loaded_t = { ...base.d, mode: mode_normal, w, h, ratio: normal.ratio, res: normal.res, frames, lord }
  return { ...base, d }
}

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

// normal があれば通常モードで開く。w×h はキャンバスの大きさ、ratio と res はそのかたちと画質の名前。
// stretch が 1 なら絵をキャンバスいっぱいにのばす。lines が 0 なら線は元の点のまま、keep が 1 なら模様は元の点のまま残す
// (どちらもなら、なにもなめらかにしない)。ai は AI で描くもの (1 が線、2 が塗り。β)。progress は描きなおしの進み具合 (0〜1)。
export type flip_normal_t = { w: number, h: number, ratio: string, res: string, stretch: number, lines: number, keep: number, ai: number, progress: (p: number) => void }

export function flip_import(file: File, done: (added: number, kind: string) => void, current: () => boolean = () => true, normal?: flip_normal_t): void {
  const request_epoch = snd_load_epoch()
  file
    .arrayBuffer()
    .then(async buf => {
      if (request_epoch !== snd_load_epoch() || !current()) { done(-1, ''); return }
      const ext = file.name.toLowerCase()
      const b = new Uint8Array(buf)
      const is_ppm = ext.endsWith('.ppm') || (b[0] === 0x50 && b[1] === 0x41 && b[2] === 0x52 && b[3] === 0x41)
      const kind = is_ppm ? 'PPM' : 'KWZ'
      let res = is_ppm ? ppm_to_frames(buf) : kwz_to_frames(buf)
      if (res && res.n && normal) {
        const ppm = is_ppm ? ppm_decode(buf) : null
        const kwz = is_ppm ? null : kwz_decode(buf)
        const src: flip_source_t | null = ppm ? { w: ppm.w, h: ppm.h, frame: f => ppm_frame(ppm, f) } : kwz ? { w: kwz_canvas_w, h: kwz_canvas_h, frame: f => kwz_frame(kwz, f) } : null
        if (!src) {
          done(0, kind)
          return
        }
        const smooth = await flip_to_normal(src, res, normal, () => request_epoch === snd_load_epoch() && current())
        if (!smooth) { done(-1, ''); return }
        res = smooth
      }
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
