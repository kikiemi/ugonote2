// うごメモの1ビットの絵を、通常モードのキャンバス向けに描きなおす。
// 絵の作りを読みとり (layer_read)、線は通常モードのペンで引いた線に、模様は平らな色の塗りにして、大きなキャンバスへかき出す。

import { getStroke } from 'perfect-freehand'
import { rle_pack } from '../pixel'
import { ai_run, type ai_net_t } from './ai_lines'
import { and_not, blob_list, block_art } from './bitmap'
import { read_layer, type layer_plan_t, type rgb_t, type shade_t, type smooth_ink_t } from './layer_read'
import { along, outline_path } from './outline'
import { pen_lines, thick_split, type pen_line_t } from './pen_trace'

type ctx_t = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// 描きなおしの仕事。うごメモの1レイヤー (w×h の、色ごとの点) を、out_w×out_h のキャンバスへ描く。
// xs (w+1 個) と ys (h+1 個) は、元の点のさかいめが、かき出す先のどこになるか (fit.ts)。scale は線の太さに使う倍率。
// covered は、上のレイヤーにおおわれて見えない所。paper は紙の色。lines が 0 なら、線はなめらかにせず、元の点のまま描く。
// keep が 1 なら、模様は塗りにせず、元の点のまま描く (lines が 0 で keep が 1 なら、絵を読みとらず、すべての点を元のまま描く)。
// ai は AI で描くもの (1 が線、2 が塗り。β)。
export type smooth_job_t = { inks: smooth_ink_t[], covered: Uint8Array, paper: rgb_t, w: number, h: number, out_w: number, out_h: number, xs: Float32Array, ys: Float32Array, scale: number, lines: number, keep: number, ai: number }

// 描きなおした、線のレイヤーと塗り (模様を残すときは模様) のレイヤー (つめた RGBA)。描くものがなければ null。
export type smooth_out_t = { line: Uint32Array | null, fill: Uint32Array | null }

// 元の絵とかき出す先のキャンバスの、大きさと置き方。
type place_t = Pick<smooth_job_t, 'w' | 'h' | 'out_w' | 'out_h' | 'xs' | 'ys' | 'scale'>

// かき出す先の大きさの作業用キャンバスと、その描き先。
type sheet_t = { canvas: OffscreenCanvas | HTMLCanvasElement, ctx: ctx_t }

// 小さな文字や印の点を結ぶ向き (右、下、右下、左下)。
const link_x = Int8Array.of(1, 0, 1, -1)
const link_y = Int8Array.of(0, 1, 1, 1)

// かき出す先の点の中心ごとに、元の絵のどこにあたるか (along の逆)。
function back(edges: Float32Array, size: number): Float32Array {
  const out = new Float32Array(size)
  const last = edges.length - 2
  let i = 0
  for (let p = 0; p < size; p++) {
    const v = p + 0.5
    while (i < last && edges[i + 1] <= v) i++
    out[p] = i + (v - edges[i]) / (edges[i + 1] - edges[i] || 1)
  }
  return out
}

// 元の大きさのまま (1倍で) 描く置き方。ペンの線が元の線をおおったかを確かめるのに使う。
function unit_place(w: number, h: number): place_t {
  const xs = new Float32Array(w + 1)
  const ys = new Float32Array(h + 1)
  for (let i = 0; i <= w; i++) xs[i] = i
  for (let i = 0; i <= h; i++) ys[i] = i
  return { w, h, out_w: w, out_h: h, scale: 1, xs, ys }
}

// Worker からも呼ぶ。
export function smooth_pack(job: smooth_job_t): smooth_out_t {
  if (!job.lines && job.keep) return { line: dots_layer(job, ink_masks(job.inks)), fill: null }
  const plan = read_layer(job.inks, job.covered, job.paper, job.w, job.h)
  return { line: pen_layer(plan, job), fill: pack_fill(plan, job) }
}

// 色ごとの点 (なにもなめらかにしないときは、これをそのまま描く)。
function ink_masks(inks: readonly smooth_ink_t[]): Uint8Array[] {
  const masks: Uint8Array[] = []
  for (let k = 0; k < inks.length; k++) masks.push(inks[k].mask)
  return masks
}

// 色ごとの点を、元の点の位置のまま四角で描いたレイヤー。
function dots_layer(job: smooth_job_t, masks: Uint8Array[]): Uint32Array | null {
  const sheet = sheet_open(job)
  try {
    return paint_patterns(sheet.ctx, job.inks, masks, job) ? pack(sheet.ctx.getImageData(0, 0, job.out_w, job.out_h).data) : null
  } finally {
    sheet.canvas.width = 0
  }
}

// 線をペンで描いたレイヤー (線をなめらかにしないときは、元の点のまま)。
function pen_layer(plan: layer_plan_t, job: smooth_job_t): Uint32Array | null {
  if (!job.lines) return dots_layer(job, plan.lines)
  const inks = job.inks
  const n = job.w * job.h
  const sheet = sheet_open(job)
  try {
    let drawn = 0
    for (let k = 0; k < inks.length; k++) {
      const others = new Uint8Array(n)
      for (let j = 0; j < inks.length; j++) {
        if (j !== k) for (let i = 0; i < n; i++) others[i] |= inks[j].mask[i]
      }
      drawn |= paint_lines(sheet.ctx, inks[k].rgb, plan.lines[k], others, job)
    }
    return drawn ? pack(sheet.ctx.getImageData(0, 0, job.out_w, job.out_h).data) : null
  } finally {
    sheet.canvas.width = 0
  }
}

// AI を使って描く (β)。job.ai が 1 なら線を、2 なら塗りを、AI で 4 倍にしてなめらかにする。
export async function smooth_pack_ai(job: smooth_job_t, net: ai_net_t): Promise<smooth_out_t> {
  if (!job.lines && job.keep) return smooth_pack(job)
  const inks = job.inks
  const w = job.w
  const h = job.h
  const n = w * h
  const plan = read_layer(inks, job.covered, job.paper, w, h)
  let fill: Uint32Array | null
  if (job.ai & 2 && !job.keep && plan.shade) {
    const patch = plan.shade.patch
    const alpha = plan.shade.alpha
    const light = new Float32Array(n)
    for (let i = 0; i < n; i++) light[i] = patch[i] ? 1 - alpha[i] : 1
    const big = await ai_run(net, light, w, h)
    fill = pack(fill_pixels(plan.shade, job, big))
  } else fill = pack_fill(plan, job)
  if (!(job.ai & 1) || !job.lines) return { line: pen_layer(plan, job), fill }
  const out = new Uint8ClampedArray(job.out_w * job.out_h * 4)
  let drawn = 0
  for (let k = 0; k < inks.length; k++) {
    const line = plan.lines[k]
    if (!line.includes(1)) continue
    const light = new Float32Array(n)
    for (let i = 0; i < n; i++) light[i] = line[i] ? 0 : 1
    blend_lines(out, await ai_run(net, light, w, h), inks[k].rgb, job)
    drawn = 1
  }
  return { line: drawn ? pack(out) : null, fill }
}

// AI で 4 倍にした濃さ (4w×4h) の、元の絵の座標 (u, v) の所の値 (まわり4点からなめらかに)。
function sample4(big: Float32Array, w: number, h: number, u: number, v: number): number {
  const bw = w * 4
  const x = Math.max(0, Math.min(bw - 1, u * 4 - 0.5))
  const y = Math.max(0, Math.min(h * 4 - 1, v * 4 - 0.5))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(bw - 1, x0 + 1)
  const y1 = Math.min(h * 4 - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  return (big[y0 * bw + x0] * (1 - fx) + big[y0 * bw + x1] * fx) * (1 - fy) + (big[y1 * bw + x0] * (1 - fx) + big[y1 * bw + x1] * fx) * fy
}

// 塗りのレイヤー (模様を残すときは、元の点のままの模様)。
function pack_fill(plan: layer_plan_t, job: smooth_job_t): Uint32Array | null {
  if (job.keep) return dots_layer(job, plan.patterns)
  return plan.shade ? pack(fill_pixels(plan.shade, job)) : null
}

// AI で 4 倍にした線の濃さ (4w×4h) を、かき出す先の大きさへ写して重ねる。縮めるときは、1点の広さの中を
// いくつかの所で見て平均する (細い線がとぎれたり、ちらついたりしないように)。うすいもや (0.04 まで) は消す。
function blend_lines(out: Uint8ClampedArray, dark: Float32Array, rgb: rgb_t, at: place_t): void {
  const w = at.w
  const h = at.h
  const out_w = at.out_w
  const out_h = at.out_h
  const ux = back(at.xs, out_w)
  const vy = back(at.ys, out_h)
  for (let y = 0; y < out_h; y++) {
    const dv = (vy[Math.min(out_h - 1, y + 1)] - vy[Math.max(0, y - 1)]) / 2
    for (let x = 0; x < out_w; x++) {
      const du = (ux[Math.min(out_w - 1, x + 1)] - ux[Math.max(0, x - 1)]) / 2
      const steps = Math.max(1, Math.min(4, Math.ceil(Math.max(du, dv) * 4)))
      let sum = 0
      for (let j = 0; j < steps; j++) {
        for (let i = 0; i < steps; i++) sum += sample4(dark, w, h, ux[x] + ((i + 0.5) / steps - 0.5) * du, vy[y] + ((j + 0.5) / steps - 0.5) * dv)
      }
      const a = Math.max(0, Math.min(1, (sum / (steps * steps) - 0.04) / 0.96))
      if (a <= 0) continue
      const o = (y * out_w + x) * 4
      const below = out[o + 3] / 255
      const alpha = a + below * (1 - a)
      for (let c = 0; c < 3; c++) out[o + c] = (rgb[c] * a + out[o + c] * below * (1 - a)) / alpha
      out[o + 3] = alpha * 255
    }
  }
}

// RGBA の点をつめる。
function pack(data: Uint8ClampedArray): Uint32Array {
  return rle_pack(new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2))
}

// かき出す先の大きさの作業用キャンバスを用意する (使いおわったら canvas.width を 0 にして捨てる)。
function sheet_open(at: place_t): sheet_t {
  const canvas = work_canvas(at.out_w, at.out_h)
  return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) as ctx_t }
}

// 作業用のキャンバス。Worker の中では OffscreenCanvas を使う。
function work_canvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

// 色の CSS の書き方。
function css(rgb: rgb_t): string {
  return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')'
}

// 塗り id の濃さを、まわり4点 (corner、重み weight) のうち、その塗りの点だけからなめらかに求める
// (となりの塗りの濃さがまざって、さかいめがぼやけないように)。0 番 (空) は 0。
function shade_of(shade: shade_t, corner: Int32Array, weight: Float64Array, id: number): number {
  if (id <= 0) return 0
  let sum = 0
  let total = 0
  for (let k = 0; k < 4; k++) {
    if (shade.patch[corner[k]] !== id) continue
    sum += shade.alpha[corner[k]] * weight[k]
    total += weight[k]
  }
  return total > 0 ? sum / total : shade.colors[id * 4 + 3]
}

// 塗りを、かき出す先の大きさの点 (RGBA) で作る。塗りの番号ごとに「その塗りの所」を少しぼかし、かき出す先の点ごとに
// いちばん強い塗りをえらぶ。さかいめは点の階段ではなくなめらかな曲線になり、となりあう塗りが重なったり (こくなる)、
// すきまがあいたり (うすくなる) しない。さかいめの1点だけは2つの塗りをまぜる。
// big があれば、濃さは AI で 4 倍にした濃さを使う。
function fill_pixels(shade: shade_t, at: place_t, big?: Float32Array): Uint8ClampedArray<ArrayBuffer> {
  const label = shade.patch
  const colors = shade.colors
  const ids = colors.length / 4
  const w = at.w
  const h = at.h
  const out_w = at.out_w
  const out_h = at.out_h
  const n = w * h
  // それぞれの塗りの所を [1 4 6 4 1] で縦横にぼかす (なにも塗らない所も「空」の塗りとしてぼかす)。
  // ぼかすのは、その塗りのある所のまわり (2点の余白つき) だけ。box_of は塗りごとの [左, 上, 右, 下]。
  const box_of = new Int32Array(ids * 4)
  for (let id = 0; id < ids; id++) {
    box_of[id * 4] = w
    box_of[id * 4 + 1] = h
    box_of[id * 4 + 2] = -1
    box_of[id * 4 + 3] = -1
  }
  for (let i = 0; i < n; i++) {
    const b = label[i] * 4
    const x = i % w
    const y = (i - x) / w
    if (x < box_of[b]) box_of[b] = x
    if (y < box_of[b + 1]) box_of[b + 1] = y
    if (x > box_of[b + 2]) box_of[b + 2] = x
    if (y > box_of[b + 3]) box_of[b + 3] = y
  }
  const soft: Float32Array[] = []
  const line = new Float32Array(Math.max(w, h))
  const taps = Float32Array.of(1, 4, 6, 4, 1)
  for (let id = 0; id < ids; id++) {
    const f = new Float32Array(n)
    soft.push(f)
    if (box_of[id * 4 + 2] < 0) continue
    const xa = Math.max(0, box_of[id * 4] - 2)
    const ya = Math.max(0, box_of[id * 4 + 1] - 2)
    const xb = Math.min(w - 1, box_of[id * 4 + 2] + 2)
    const yb = Math.min(h - 1, box_of[id * 4 + 3] + 2)
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) if (label[y * w + x] === id) f[y * w + x] = 1
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        let v = 0
        for (let k = -2; k <= 2; k++) v += f[y * w + Math.min(w - 1, Math.max(0, x + k))] * taps[k + 2]
        line[x] = v / 16
      }
      for (let x = xa; x <= xb; x++) f[y * w + x] = line[x]
    }
    for (let x = xa; x <= xb; x++) {
      for (let y = ya; y <= yb; y++) {
        let v = 0
        for (let k = -2; k <= 2; k++) v += f[Math.min(h - 1, Math.max(0, y + k)) * w + x] * taps[k + 2]
        line[y] = v / 16
      }
      for (let y = ya; y <= yb; y++) f[y * w + x] = line[y]
    }
  }
  const out = new Uint8ClampedArray(out_w * out_h * 4)
  const near: number[] = []
  const ux = back(at.xs, out_w)
  const vy = back(at.ys, out_h)
  // まわり4点 (元の絵) と、その重み。
  const corner = new Int32Array(4)
  const weight = new Float64Array(4)
  // さかいめでまぜるはば。ぼかした強さの差が、かき出す先の1点ぶんで変わるくらい。
  const edge = 2 * at.scale
  for (let y = 0; y < out_h; y++) {
    const v = vy[y] - 0.5
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(v)))
    const y1 = Math.min(h - 1, y0 + 1)
    const fy = Math.max(0, Math.min(1, v - y0))
    for (let x = 0; x < out_w; x++) {
      const u = ux[x] - 0.5
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(u)))
      const x1 = Math.min(w - 1, x0 + 1)
      const fx = Math.max(0, Math.min(1, u - x0))
      corner[0] = y0 * w + x0
      corner[1] = y0 * w + x1
      corner[2] = y1 * w + x0
      corner[3] = y1 * w + x1
      if (!label[corner[0]] && !label[corner[1]] && !label[corner[2]] && !label[corner[3]]) continue
      near.length = 0
      for (let k = 0; k < 4; k++) if (!near.includes(label[corner[k]])) near.push(label[corner[k]])
      let best = -1
      let best_v = -1
      let next = -1
      let next_v = -1
      for (let e = 0; e < near.length; e++) {
        const id = near[e]
        const f = soft[id]
        const val = (f[corner[0]] * (1 - fx) + f[corner[1]] * fx) * (1 - fy) + (f[corner[2]] * (1 - fx) + f[corner[3]] * fx) * fy
        if (val > best_v) {
          next = best
          next_v = best_v
          best = id
          best_v = val
        } else if (val > next_v) {
          next = id
          next_v = val
        }
      }
      const mix = next < 0 ? 0 : Math.max(0, Math.min(0.5, 0.5 - (best_v - next_v) * edge * 0.5))
      weight[0] = (1 - fx) * (1 - fy)
      weight[1] = fx * (1 - fy)
      weight[2] = (1 - fx) * fy
      weight[3] = fx * fy
      const p = best * 4
      const q = (next < 0 ? best : next) * 4
      const ai = big ? sample4(big, w, h, u + 0.5, v + 0.5) : -1
      const wp = (ai >= 0 && best > 0 ? ai : shade_of(shade, corner, weight, best)) * (1 - mix)
      const wq = (ai >= 0 && next > 0 ? ai : shade_of(shade, corner, weight, next)) * mix
      const alpha = wp + wq
      if (alpha <= 0) continue
      const o = (y * out_w + x) * 4
      out[o] = (colors[p] * wp + colors[q] * wq) / alpha
      out[o + 1] = (colors[p + 1] * wp + colors[q + 1] * wq) / alpha
      out[o + 2] = (colors[p + 2] * wp + colors[q + 2] * wq) / alpha
      out[o + 3] = alpha * 255
    }
  }
  return out
}

// ペンのはしを細めるときの、太さの変わり方 (perfect-freehand にわたす)。
function tip_easing(t: number): number {
  return 0.4 + 0.6 * t * (2 - t)
}

// 中心のすじを、通常モードのペン (ふとさ一定・なめらかさ ふつう) で引いた線の形にする。座標はかき出す先のキャンバス。
// taper が 1 なら、ほかの線につながっていないはしを、ペンを払ったように少し細める。
function pen_path(line: pen_line_t, at: place_t, taper: number): Path2D {
  let pts = line.pts
  // 点の中心をたどった階段を、となりどうしの平均で4回ならしてから引く (はしはそのまま)。
  for (let pass = 0; pass < 2 && pts.length >= 6; pass++) {
    const next = pts.slice()
    const count = pts.length / 2
    for (let i = 0; i < count; i++) {
      if (!line.closed && (i === 0 || i === count - 1)) continue
      const a = line.closed ? (i - 1 + count - 1) % (count - 1) : i - 1
      const b = line.closed ? (i + 1) % (count - 1) : i + 1
      next[i * 2] = (pts[a * 2] + pts[i * 2] * 2 + pts[b * 2]) / 4
      next[i * 2 + 1] = (pts[a * 2 + 1] + pts[i * 2 + 1] * 2 + pts[b * 2 + 1]) / 4
    }
    if (line.closed) {
      next[next.length - 2] = next[0]
      next[next.length - 1] = next[1]
    }
    pts = next
  }
  // perfect-freehand は [x, y] のならびを受けとる。
  const input: number[][] = []
  let length = 0
  for (let i = 0; i < pts.length; i += 2) {
    input.push([along(at.xs, pts[i]), along(at.ys, pts[i + 1])])
    if (i) length += Math.hypot(input[i / 2][0] - input[i / 2 - 1][0], input[i / 2][1] - input[i / 2 - 1][1])
  }
  const size = Math.max(1, line.width * at.scale * 1.12)
  // 短い線は追いかけを弱くする (点や短い線が、ずれたり丸くつぶれたりしないように)。
  const streamline = input.length < 10 ? 0.12 : 0.25
  // はしは、太さの 1.2 倍の長さで、太さの 4 割まで細める (長さが太さの 4 倍に満たない線は細めない)。
  const tip = taper && length >= size * 4 ? { taper: size * 1.2, easing: tip_easing } : {}
  let outline = getStroke(input, {
    size, thinning: 0, smoothing: 0.64, streamline, simulatePressure: false, last: true,
    start: line.tips & 1 ? tip : {}, end: line.tips & 2 ? tip : {},
  })
  if (outline.length < 3) {
    const cx = input[input.length - 1][0]
    const cy = input[input.length - 1][1]
    outline = []
    for (let a = 0; a < 16; a++) outline.push([cx + Math.cos(a / 16 * Math.PI * 2) * size / 2, cy + Math.sin(a / 16 * Math.PI * 2) * size / 2])
  }
  const path = new Path2D()
  path.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length; i++) path.lineTo(outline[i][0], outline[i][1])
  path.closePath()
  return path
}

// 線のはし (pts の at 番目の座標) のまわり 5×5 に、ふさがれた所 (blocked) か絵のふちの外があるか。
function tip_blocked(item: pen_line_t, at: number, blocked: Uint8Array, w: number, h: number): boolean {
  const x = Math.floor(item.pts[at])
  const y = Math.floor(item.pts[at + 1])
  for (let yy = y - 2; yy <= y + 2; yy++) {
    for (let xx = x - 2; xx <= x + 2; xx++) {
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && !blocked[yy * w + xx]) continue
      return true
    }
  }
  return false
}

// 線のはしのうち、本当にそこで終わっているはし。ほかの色の点・太い形・絵のふちから2点以内のはしは、
// 重なった点にかくれて切れて見えているだけなので、はしとみない (細めると、すきまがあいて見える)。
function free_tips(item: pen_line_t, blocked: Uint8Array, w: number, h: number): number {
  let tips = item.tips
  for (let k = 0; k < 2; k++) {
    if (!(tips & (1 << k))) continue
    if (tip_blocked(item, k === 0 ? 0 : item.pts.length - 2, blocked, w, h)) tips &= ~(1 << k)
  }
  return tips
}

// 線を描く。太い形はなめらかな形のまま、細い線は通常モードのペンで引き、ペンの線から2点以上はなれて
// 取りこぼした所 (細かい形や分かれ目) は、形のまま描きたす。others は、同じレイヤーのほかの色の点。
function paint_lines(ctx: ctx_t, rgb: rgb_t, line: Uint8Array, others: Uint8Array, at: place_t): number {
  const w = at.w
  const h = at.h
  const scale = at.scale
  const n = w * h
  if (!line.includes(1)) return 0
  // 2倍にしたドット絵の字などは、細くてもペンの線にせず、ドット絵の形 (角を残し、四角の階段をまっすぐな斜めに) で描く。
  // 小さな文字や印は、ペンの線にも曲線にもせず、角を残して描く。
  const art = block_art(line, w, h)
  const glyphs = glyph_parts(and_not(line, art), w, h)
  const plain = and_not(and_not(line, glyphs), art)
  let parts = thick_split(plain, w, h)
  let traced = pen_lines(parts.thin, w, h)
  // ペンの線が元の線のどこをおおったかを、元の大きさで確かめる (はしを細める前の形で)。
  const unit = unit_place(w, h)
  const probe = work_canvas(w, h)
  const pctx = probe.getContext('2d', { willReadFrequently: true }) as ctx_t
  for (let k = 0; k < traced.length; k++) pctx.fill(pen_path(traced[k], unit, 0))
  let alpha = pctx.getImageData(0, 0, w, h).data
  // ペンの線やなめらかな形にすると、字の中のせまいすきまがふさがってしまう、太めの小さな形 (太いドット絵の字など) は、
  // ドット絵の形で描く。
  const shape_probe = new Path2D()
  outline_path(parts.thick, w, h, unit, shape_probe)
  pctx.fill(shape_probe)
  const fine = closed_gaps(plain, others, pctx.getImageData(0, 0, w, h).data, w, h)
  if (fine) {
    for (let i = 0; i < n; i++) art[i] |= fine[i]
    parts = thick_split(and_not(and_not(line, glyphs), art), w, h)
    traced = pen_lines(parts.thin, w, h)
    pctx.clearRect(0, 0, w, h)
    for (let k = 0; k < traced.length; k++) pctx.fill(pen_path(traced[k], unit, 0))
    alpha = pctx.getImageData(0, 0, w, h).data
  }
  probe.width = 0
  const near = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (alpha[i * 4 + 3] < 100) continue
    const x = i % w
    near[i] = 1
    if (x > 0) near[i - 1] = 1
    if (x < w - 1) near[i + 1] = 1
    if (i >= w) near[i - w] = 1
    if (i + w < n) near[i + w] = 1
  }
  const missed = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (parts.thin[i] && !near[i]) missed[i] = 1
  // 2点までの取りこぼし (線のはしの小さなかぎなど) は描きたさない (線のはしや分かれ目に、こぶができないように)。
  const bits = blob_list(missed, w, h, 1)
  for (let k = 0; k < bits.count; k++) {
    if (bits.start[k + 1] - bits.start[k] > 2) continue
    for (let c = bits.start[k]; c < bits.start[k + 1]; c++) missed[bits.cells[c]] = 0
  }
  // 取りこぼした点 (線の分かれ目や角) には、ペン先を1点ずつおす (形として描くと、まわりがふくらんでこぶになる)。
  const widths = new Float64Array(traced.length)
  for (let k = 0; k < traced.length; k++) widths[k] = traced[k].width
  widths.sort()
  const tip = (widths.length ? widths[widths.length >> 1] : 1) * scale * 1.12 / 2
  const shape = new Path2D()
  outline_path(parts.thick, w, h, at, shape)
  outline_path(art, w, h, at, shape, 1, 1)
  for (let i = 0; i < n; i++) {
    if (!missed[i]) continue
    const cx = along(at.xs, i % w + 0.5)
    const cy = along(at.ys, Math.floor(i / w) + 0.5)
    shape.moveTo(cx + tip, cy)
    shape.arc(cx, cy, tip, 0, Math.PI * 2)
  }
  const color = css(rgb)
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineJoin = 'round'
  ctx.lineWidth = 0.2 * scale
  ctx.fill(shape)
  ctx.stroke(shape)
  ctx.lineCap = 'round'
  ctx.lineWidth = 1.05 * scale
  ctx.stroke(glyph_path(glyphs, w, h, at))
  // ペンと同じく1本ずつ塗る (重なった所が抜けないように)。本当に終わっているはしは、細めて引く。
  const blocked = others.slice()
  for (let i = 0; i < n; i++) blocked[i] |= parts.thick[i] | art[i]
  for (let k = 0; k < traced.length; k++) {
    const item = traced[k]
    const tips = free_tips(item, blocked, w, h)
    ctx.fill(pen_path({ pts: item.pts, width: item.width, closed: item.closed, tips }, at, tips ? 1 : 0))
  }
  ctx.restore()
  return 1
}

// j が line の点か (絵の外は点でない)。
function dot_on(line: Uint8Array, n: number, j: number): boolean {
  return j >= 0 && j < n && line[j] === 1
}

// 描いた線や形 (alpha は、元の大きさで描いた RGBA) が、元の絵の線のあいだの1点のすきま (左右か上下が、同じまとまりの線) を
// ふさいでしまう、字ほどの大きさ (24点四方まで) で太めの (面積を、輪郭の長さの半分でわった太さが 1.4 点以上) 線のまとまり
// (1点の穴が 20点に1つより多い、網の目のような模様は入れない)。
// ふさいだすきまが 2 つ以上で、すきまの 1/3 以上のもの。なければ null。others は、ほかの色の点 (すきまに入れない)。
// 大きな線画では、近づいた線のあいだがふさがるのはなめらかにした結果なので、入れない。
function closed_gaps(line: Uint8Array, others: Uint8Array, alpha: Uint8ClampedArray, w: number, h: number): Uint8Array | null {
  const n = w * h
  const list = blob_list(line, w, h, 1)
  if (!list.count) return null
  const label = new Int32Array(n).fill(-1)
  for (let k = 0; k < list.count; k++) for (let c = list.start[k]; c < list.start[k + 1]; c++) label[list.cells[c]] = k
  const gaps = new Int32Array(list.count)
  const closed = new Int32Array(list.count)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (line[i] || others[i]) continue
      let c = -1
      if (x > 0 && x < w - 1 && label[i - 1] >= 0 && label[i - 1] === label[i + 1]) c = label[i - 1]
      else if (y > 0 && y < h - 1 && label[i - w] >= 0 && label[i - w] === label[i + w]) c = label[i - w]
      if (c < 0) continue
      gaps[c]++
      if (alpha[i * 4 + 3] >= 200) closed[c]++
    }
  }
  let out: Uint8Array | null = null
  for (let k = 0; k < list.count; k++) {
    if (closed[k] < 2 || closed[k] * 3 < gaps[k]) continue
    const begin = list.start[k]
    const end = list.start[k + 1]
    let edge = 0
    let holes = 0
    let x0 = w
    let x1 = -1
    let y0 = h
    let y1 = -1
    for (let c = begin; c < end; c++) {
      const j = list.cells[c]
      const x = j % w
      const y = (j - x) / w
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
      if (x === 0 || !line[j - 1]) edge++
      if (x === w - 1 || !line[j + 1]) edge++
      if (j < w || !line[j - w]) edge++
      if (j + w >= n || !line[j + w]) edge++
      if (x < w - 2 && !dot_on(line, n, j + 1) && dot_on(line, n, j + 2) && dot_on(line, n, j + 1 - w) && dot_on(line, n, j + 1 + w)) holes++
    }
    if (x1 - x0 >= 24 || y1 - y0 >= 24 || (end - begin) / (edge / 2) < 1.4 || holes * 20 > end - begin) continue
    if (!out) out = new Uint8Array(n)
    for (let c = begin; c < end; c++) out[list.cells[c]] = 1
  }
  return out
}

// 小さな文字や印のような形と、ドット絵の字。どちらも細い線 (中まで点のつまった所が 1/4 未満) でできたもので、
// 小さな文字や印は 12点四方まで、ドット絵の字は、1点の太さの線で、点の 85% 以上が縦か横に 3点以上まっすぐならび、縦と横の線が直角に
// 出会う所が 25点に1つ以上あり、1点の穴 (網の目) が 20点に1つまでのもの (となりの字とくっついて大きなまとまりに
// なっていてもよい)。
// ペンの線や曲線にすると、角がまるまったり線がゆれたりして読めなくなるので、glyph_path で点をそのまま結んで描く。
function glyph_parts(line: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h
  const out = new Uint8Array(n)
  // 点をふくむ、横と縦のまっすぐなならびの長さ。
  const across = new Uint16Array(n)
  const down = new Uint16Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w;) {
      if (!line[y * w + x]) {
        x++
        continue
      }
      let k = x
      while (k < w && line[y * w + k]) k++
      for (let j = x; j < k; j++) across[y * w + j] = k - x
      x = k
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h;) {
      if (!line[y * w + x]) {
        y++
        continue
      }
      let k = y
      while (k < h && line[k * w + x]) k++
      for (let j = y; j < k; j++) down[j * w + x] = k - y
      y = k
    }
  }
  const list = blob_list(line, w, h, 1)
  for (let b = 0; b < list.count; b++) {
    const begin = list.start[b]
    const end = list.start[b + 1]
    const size = end - begin
    if (size > 6000) continue
    let x0 = w
    let x1 = -1
    let y0 = h
    let y1 = -1
    for (let c = begin; c < end; c++) {
      const j = list.cells[c]
      const x = j % w
      const y = (j - x) / w
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
    if (size < 4) continue
    let inner = 0
    let straight = 0
    let cross = 0
    let holes = 0
    let blocks = 0
    let zig = 0
    for (let c = begin; c < end; c++) {
      const j = list.cells[c]
      const x = j % w
      if (x > 0 && dot_on(line, n, j - 1) && x < w - 1 && dot_on(line, n, j + 1) && dot_on(line, n, j - w) && dot_on(line, n, j + w)) inner++
      // ゆれの山 (たてよこのとなりがなく、ななめのとなりが同じがわに2つだけ)。
      if (x > 0 && x < w - 1 && !dot_on(line, n, j - 1) && !dot_on(line, n, j + 1) && !dot_on(line, n, j - w) && !dot_on(line, n, j + w)) {
        const ul = dot_on(line, n, j - w - 1)
        const ur = dot_on(line, n, j - w + 1)
        const dl = dot_on(line, n, j + w - 1)
        const dr = dot_on(line, n, j + w + 1)
        if (+ul + +ur + +dl + +dr === 2 && (ul && dl || ur && dr || ul && ur || dl && dr)) zig++
      }
      if (x < w - 1 && dot_on(line, n, j + 1) && dot_on(line, n, j + w) && dot_on(line, n, j + w + 1)) blocks++
      if (across[j] >= 3 || down[j] >= 3) straight++
      if (across[j] >= 3 && down[j] >= 3) cross++
      // 右どなりが、上下左右を点にかこまれた1点の穴 (網の目)。
      if (x < w - 2 && !dot_on(line, n, j + 1) && dot_on(line, n, j + 2) && dot_on(line, n, j + 1 - w) && dot_on(line, n, j + 1 + w)) holes++
    }
    if (inner * 4 >= size) continue
    const small = x1 - x0 < 12 && y1 - y0 < 12 && size <= 144
    // 1点ずつ左右にゆれる線 (ゆれの山が 1/3 以上。点々のペンで書いた字の短い線など) は、ペンの線にしてゆれをならす。
    if (small && zig * 3 >= size) continue
    // 網の目のような模様 (1点の穴が多いもの) と、2点ほどの太さの手描きの線 (2×2 の点のかたまりが 1 割以上) は字とみない。
    if (!small && (straight < size * 0.85 || cross * 25 < size || holes * 20 > size || blocks * 10 >= size)) continue
    for (let c = begin; c < end; c++) out[list.cells[c]] = 1
  }
  return out
}

// (x, y) が小さな文字や印の点か (絵の外は点でない)。
function glyph_at(glyphs: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h && glyphs[y * w + x] === 1
}

// 小さな文字や印を、点の中心どうしを結んだ線 (点1つ分の太さで引く) にする。たて・よこのとなりは結び、ななめの
// となりは、間のたて・よこの点がどちらも空いているときだけ結ぶ (角が三角に埋まって太らないように)。
// まっすぐな線はまっすぐ、角は角のまま、点の階段は同じ太さの斜めの線になる。となりのない点は丸い点にする。
function glyph_path(glyphs: Uint8Array, w: number, h: number, at: place_t): Path2D {
  const path = new Path2D()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!glyph_at(glyphs, w, h, x, y)) continue
      const ax = along(at.xs, x + 0.5)
      const ay = along(at.ys, y + 0.5)
      let alone = 1
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && glyph_at(glyphs, w, h, x + dx, y + dy)) alone = 0
      if (alone) {
        path.moveTo(ax, ay)
        path.lineTo(ax + 0.01, ay)
        continue
      }
      for (let k = 0; k < 4; k++) {
        const dx = link_x[k]
        const dy = link_y[k]
        if (!glyph_at(glyphs, w, h, x + dx, y + dy) || dx && dy && (glyph_at(glyphs, w, h, x + dx, y) || glyph_at(glyphs, w, h, x, y + dy))) continue
        path.moveTo(ax, ay)
        path.lineTo(along(at.xs, x + dx + 0.5), along(at.ys, y + dy + 0.5))
      }
    }
  }
  return path
}

// 「模様を残す」ときの模様。元の点の位置のまま、かき出す先の大きさの四角で描く (色ごとに1つの形にまとめて塗るので、
// となりあう点のあいだに細いすきまは出ない)。
function paint_patterns(ctx: ctx_t, inks: readonly smooth_ink_t[], patterns: Uint8Array[], at: place_t): number {
  const w = at.w
  const h = at.h
  const xs = at.xs
  const ys = at.ys
  let drawn = 0
  for (let k = 0; k < inks.length; k++) {
    const m = patterns[k]
    if (!m.includes(1)) continue
    const path = new Path2D()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!m[y * w + x]) continue
        // 横につづく点は1つの四角にまとめる。
        let run = 1
        while (x + run < w && m[y * w + x + run]) run++
        path.rect(xs[x], ys[y], xs[x + run] - xs[x], ys[y + 1] - ys[y])
        x += run - 1
      }
    }
    ctx.fillStyle = css(inks[k].rgb)
    ctx.fill(path)
    drawn = 1
  }
  return drawn
}
