import { kwz_decode } from './codec/kwzdec'
import { KWZ_BORDER, KWZ_CANVAS_W, KWZ_CANVAS_H, KWZ_FRAME_W, KWZ_FRAME_H } from './codec/kwzgeom'
import { ppm_decode } from './codec/ppmdec'
import { report_warning } from './diagnostics'
import { doc_frame_new } from './doc'
import { KWZ_PAL, L_N, MAX_FRAMES_FLIPNOTE, MODE_3D, MODE_DSI } from './h'
import { canvas_make, rle_pack, hex_rgb, wav_encode } from './lib'
import { snd_load_epoch } from './snd'
import { dispatch, type FlipLoaded } from './state/commands/index'
import { snd_load_bytes } from './ui/sound_io'

function pack_rgba(c: HTMLCanvasElement, x: CanvasRenderingContext2D): Uint32Array {
  const img = x.getImageData(0, 0, c.width, c.height)
  return rle_pack(new Uint32Array(img.data.buffer))
}

type FlipParsed = { d: FlipLoaded, n: number, bgm: Int16Array | null, rate: number, bgmFps: number, se: (Int16Array | null)[] }

function ppm_to_frames(buf: ArrayBuffer): FlipParsed | null {
  const dec = ppm_decode(buf)
  if (!dec) return null
  const n = Math.min(dec.frameCount, MAX_FRAMES_FLIPNOTE)
  const frames = []
  for (let f = 0; f < n; f++) {
    const fr = doc_frame_new()
    const whitePaper = dec.paper[f] === 1
    const inv = whitePaper ? '#0E0E0E' : '#FFFFFF'
    const penMap = [inv, inv, '#FF2A2A', '#0A39FF']
    const penHex = dec.penIdx[f].map(i => penMap[i & 3])
    for (let l = 0; l < 2; l++) {
      const [c, x] = canvas_make(dec.w, dec.h)
      const img = x.createImageData(dec.w, dec.h)
      const [pr, pg, pb] = hex_rgb(penHex[l])
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
    fr.se = dec.seFlags[f]
    frames.push(fr)
  }
  const d: FlipLoaded = {
    mode: MODE_DSI, w: dec.w, h: dec.h, ratio: '4:3', res: 'dsi',
    fps: dec.fps, loop: dec.loop,
    paper: dec.paper[0] === 1 ? '#FFFFFF' : '#0E0E0E',
    meta: dec.meta,
    frames, cur: Math.min(dec.thumbIdx, n - 1),
    bgm: dec.bgm, bgmRate: dec.bgmRate, bgmFps: dec.bgmFps, se: dec.se,
  }
  return { d, n, bgm: dec.bgm, rate: dec.bgmRate, bgmFps: dec.bgmFps, se: dec.se }
}

function kwz_to_frames(buf: ArrayBuffer): FlipParsed | null {
  const dec = kwz_decode(buf)
  if (!dec || dec.w !== KWZ_FRAME_W || dec.h !== KWZ_FRAME_H) return null
  const n = Math.min(dec.frameCount, MAX_FRAMES_FLIPNOTE)
  const frames = []
  for (let f = 0; f < n; f++) {
    const fr = doc_frame_new()
    const col = dec.frameColors[f]
    const dep = dec.layerDepths[f] || [0, 0, 0]
    const drawOrder = [2, 1, 0].sort((a, b) => dep[b] - dep[a])
    for (let k = 0; k < 3 && k + 1 < L_N; k++) {
      const l = drawOrder[2 - k]
      const vw = KWZ_CANVAS_W
      const vh = KWZ_CANVAS_H
      const [c, x] = canvas_make(vw, vh)
      const img = x.createImageData(vw, vh)
      const ca = KWZ_PAL[col[l * 2]] || KWZ_PAL[1]
      const cb = KWZ_PAL[col[l * 2 + 1]] || KWZ_PAL[1]
      const src = dec.layers[f][l]
      for (let y = 0; y < vh; y++) {
        for (let xx = 0; xx < vw; xx++) {
          const v = src[(y + KWZ_BORDER) * dec.w + xx + KWZ_BORDER]
          if (!v) continue
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
    fr.se = dec.seFlags[f]
    frames.push(fr)
  }
  const pCount = [0, 0, 0, 0, 0, 0]
  for (const pv of dec.paper) if (pv >= 0 && pv <= 5) pCount[pv]++
  let pIdx = 0
  for (let i = 1; i < 6; i++) if (pCount[i] > pCount[pIdx]) pIdx = i
  const pp = KWZ_PAL[pIdx]
  const d: FlipLoaded = {
    mode: MODE_3D, w: KWZ_CANVAS_W, h: KWZ_CANVAS_H, ratio: '4:3', res: '3ds',
    fps: dec.fps, loop: dec.loop,
    paper: '#' + ((1 << 24) | (pp[0] << 16) | (pp[1] << 8) | pp[2]).toString(16).slice(1).toUpperCase(),
    meta: dec.meta,
    frames, cur: Math.min(dec.thumbIdx, n - 1),
    bgm: dec.bgm, bgmRate: dec.bgmRate, bgmFps: dec.bgmFps, se: dec.se,
  }
  return { d, n, bgm: dec.bgm, rate: dec.bgmRate, bgmFps: dec.bgmFps, se: dec.se }
}

function i16_to_f32(src: Int16Array): Float32Array {
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = src[i] / 32768
  return out
}

function load_audio(bgm: Int16Array | null, bgmRate: number, se: (Int16Array | null)[], epoch: number, done: (stale: number) => void): void {
  const jobs: { kind: string, pcm: Int16Array, rate: number }[] = []
  if (bgm && bgm.length) jobs.push({ kind: 'bgm0', pcm: bgm, rate: bgmRate })
  for (let i = 0; i < 4 && i < se.length; i++) {
    const s = se[i]
    if (s && s.length) jobs.push({ kind: 'se' + i, pcm: s, rate: bgmRate })
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

export function flip_import(file: File, done: (added: number, kind: string) => void): void {
  file
    .arrayBuffer()
    .then(buf => {
      const ext = file.name.toLowerCase()
      const b = new Uint8Array(buf)
      const isPpm = ext.endsWith('.ppm') || (b[0] === 0x50 && b[1] === 0x41 && b[2] === 0x52 && b[3] === 0x41)
      const kind = isPpm ? 'PPM' : 'KWZ'
      const res = isPpm ? ppm_to_frames(buf) : kwz_to_frames(buf)
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
      report_warning('うごメモファイルの読み込みに失敗しました', error)
      done(0, '')
    })
}
