// 2枚の絵のあいだの動きを、AI (motion_net.ts) で読む。中割り・つづきのコマ・色のつづき・カクつきさがしで使う。
// AI にわたす絵は長い辺が side くらいの大きさにそろえ、結果の動きを元の絵の大きさへ読みかえる。
// 2枚のちがいが動きで説明できない所 (文字が出る、場面が変わるなど) は、動かさない。
// AI には時間 0.5 (2枚のまん中) の動きをたずねる。この時の動きがいちばん正確で、絵のない所までなめらかにつながっている。
// ほかの時間の動きは、そこから直線でのばして求める (1 に近い時間を AI にたずねると、前の絵への動きがくずれる)。

import { motion_net_read, net_align, type motion_net_t } from './motion_net'

// 動きのマップ。data は 5 面 (w×h) で、2枚のまん中の時の点が前の絵のどこにあったか (x, y の差)、後の絵のどこにあったか (x, y の差)、重なり。
// 差は AI の絵の点の数。to_x, to_y は AI の絵の 1 点が元の絵の何点か。score は2枚のちがいが動きで説明できた割合 (同じ絵なら -1)。
export type flow_t = { data: Float32Array, w: number, h: number, to_x: number, to_y: number, score: number }

// 説明できた割合を見る所の広さ (AI の絵の長い辺に対する割合)。
const gate_reach = 1 / 32
// 所ごとの説明できた割合がこの範囲で、動きを 0 から 1 倍へ強める。
const gate_low = 0.2
const gate_high = 0.6
// 2枚のちがいとして数える濃さのちがい。
const change_least = 0.1
// 時間 0.5 の位置へもどるくり返しの数。
const back_rounds = 4
// AI にたずねる時間。
const middle = 0.5

const near_old = new Float32Array(2)
const near_new = new Float32Array(2)

// 長さ v を、net_align の倍数へ切り上げる。
function aligned(v: number): number {
  return Math.max(net_align, Math.ceil(v / net_align) * net_align)
}

// 点 i の r, g, b を、白い紙にのせた値 (0〜1) にして、重み weight をかけて out の o の所へ足す。
function white_add(px: Uint32Array, i: number, weight: number, out: Float32Array, o: number, n: number): void {
  const word = px[i]
  const a = (word >>> 24) / 255
  const white = 1 - a
  out[o] += ((word & 255) / 255 * a + white) * weight
  out[n + o] += ((word >>> 8 & 255) / 255 * a + white) * weight
  out[n * 2 + o] += ((word >>> 16 & 255) / 255 * a + white) * weight
}

// 絵 (RGBA の点) を、白い紙にのせて work_w×work_h の r, g, b の 3 面にする。
// ちぢめるときは広さの平均をとり、大きくするときはまわりの 4 点からなめらかに求める (点のかどや、あみ点を AI が動きと見まちがえないように)。
function rgb_plane(px: Uint32Array, w: number, h: number, work_w: number, work_h: number): Float32Array {
  const n = work_w * work_h
  const out = new Float32Array(n * 3)
  if (work_w <= w && work_h <= h) {
    const hits = new Int32Array(n)
    for (let y = 0; y < h; y++) {
      const row = Math.min(work_h - 1, Math.floor(y * work_h / h)) * work_w
      for (let x = 0; x < w; x++) {
        const o = row + Math.min(work_w - 1, Math.floor(x * work_w / w))
        white_add(px, y * w + x, 1, out, o, n)
        hits[o]++
      }
    }
    for (let i = 0; i < n * 3; i++) out[i] /= Math.max(1, hits[i % n])
    return out
  }
  for (let y = 0; y < work_h; y++) {
    const v = Math.max(0, Math.min(h - 1, (y + 0.5) * h / work_h - 0.5))
    const y0 = Math.floor(v)
    const y1 = Math.min(h - 1, y0 + 1)
    const fy = v - y0
    for (let x = 0; x < work_w; x++) {
      const u = Math.max(0, Math.min(w - 1, (x + 0.5) * w / work_w - 0.5))
      const x0 = Math.floor(u)
      const x1 = Math.min(w - 1, x0 + 1)
      const fx = u - x0
      const o = y * work_w + x
      white_add(px, y0 * w + x0, (1 - fx) * (1 - fy), out, o, n)
      white_add(px, y0 * w + x1, fx * (1 - fy), out, o, n)
      white_add(px, y1 * w + x0, (1 - fx) * fy, out, o, n)
      white_add(px, y1 * w + x1, fx * fy, out, o, n)
    }
  }
  return out
}

// 絵 a, b (w×h の RGBA の点) の動きのマップを求める。side は AI にわたす絵の長い辺の点の数。
export async function flow_read(net: motion_net_t, a: Uint32Array, b: Uint32Array, w: number, h: number, side: number): Promise<flow_t> {
  const scale = side / Math.max(w, h)
  const work_w = aligned(w * scale)
  const work_h = aligned(h * scale)
  const plane_a = rgb_plane(a, w, h, work_w, work_h)
  const plane_b = rgb_plane(b, w, h, work_w, work_h)
  const data = await motion_net_read(net, plane_a, plane_b, work_w, work_h, middle)
  const flow: flow_t = { data, w: work_w, h: work_h, to_x: w / work_w, to_y: h / work_h, score: 0 }
  flow.score = flow_gate(flow, plane_a, plane_b)
  return flow
}

// 面 c の (x, y) の値を、まわりの 4 点から求める。
function plane_at(plane: Float32Array, w: number, h: number, c: number, x: number, y: number): number {
  const u = x < 0 ? 0 : x > w - 1 ? w - 1 : x
  const v = y < 0 ? 0 : y > h - 1 ? h - 1 : y
  const x0 = Math.floor(u)
  const y0 = Math.floor(v)
  const x1 = x0 + 1 < w ? x0 + 1 : x0
  const y1 = y0 + 1 < h ? y0 + 1 : y0
  const fx = u - x0
  const fy = v - y0
  const base = c * w * h
  const top = plane[base + y0 * w + x0] * (1 - fx) + plane[base + y0 * w + x1] * fx
  const low = plane[base + y1 * w + x0] * (1 - fx) + plane[base + y1 * w + x1] * fx
  return top * (1 - fy) + low * fy
}

// たて横に、まわり reach 点の平均をとる。
function box_mean(v: Float32Array, w: number, h: number, reach: number): Float32Array {
  const across = new Float32Array(v.length)
  const out = new Float32Array(v.length)
  const size = reach * 2 + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let k = -reach; k <= reach; k++) sum += v[row + Math.max(0, Math.min(w - 1, k))]
    for (let x = 0; x < w; x++) {
      across[row + x] = sum / size
      sum += v[row + Math.min(w - 1, x + reach + 1)] - v[row + Math.max(0, x - reach)]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let k = -reach; k <= reach; k++) sum += across[Math.max(0, Math.min(h - 1, k)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / size
      sum += across[Math.min(h - 1, y + reach + 1) * w + x] - across[Math.max(0, y - reach) * w + x]
    }
  }
  return out
}

// 2枚を動きに合わせて重ねて、ちがいがどれだけ減ったかを見る。減らなかった所は動きを弱めて、元の絵のままにする。
// 返すのは、ちがいのある所全体で説明できた割合 (ちがいがなければ -1)。
function flow_gate(f: flow_t, a: Float32Array, b: Float32Array): number {
  const w = f.w
  const h = f.h
  const n = w * h
  const d = f.data
  const before = new Float32Array(n)
  const after = new Float32Array(n)
  const change = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let near = 0
      let moved = 0
      let most = 0
      for (let c = 0; c < 3; c++) {
        const gap = Math.abs(a[c * n + i] - b[c * n + i])
        near += gap
        if (gap > most) most = gap
        moved += Math.abs(plane_at(a, w, h, c, x + d[i], y + d[n + i]) - plane_at(b, w, h, c, x + d[n * 2 + i], y + d[n * 3 + i]))
      }
      before[i] = near / 3
      after[i] = moved / 3
      if (most > change_least) change[i] = 1
    }
  }
  // ちがいのある所のまわりも数える。
  const seen = box_mean(change, w, h, 2)
  let sum_before = 0
  let sum_after = 0
  for (let i = 0; i < n; i++) {
    if (seen[i] <= 0) continue
    sum_before += before[i]
    sum_after += after[i]
  }
  if (sum_before < 1e-3) return -1
  const reach = Math.round(Math.max(w, h) * gate_reach)
  const mean_before = box_mean(before, w, h, reach)
  const mean_after = box_mean(after, w, h, reach)
  for (let i = 0; i < n; i++) {
    const gain = 1 - mean_after[i] / (mean_before[i] + 1e-3)
    const trust = Math.max(0, Math.min(1, (gain - gate_low) / (gate_high - gate_low)))
    for (let c = 0; c < 4; c++) d[c * n + i] *= trust
  }
  return 1 - sum_after / sum_before
}

// 元の絵の点 (x, y) の動きを、まわりの 4 点からなめらかに求めて out (x, y の差、元の絵の点の数) へ入れる。
// at は 0 なら前の絵への動き、2 なら後の絵への動き。
function flow_at(f: flow_t, x: number, y: number, at: number, out: Float32Array): void {
  const w = f.w
  const h = f.h
  const gx = Math.max(0, Math.min(w - 1, x / f.to_x - 0.5))
  const gy = Math.max(0, Math.min(h - 1, y / f.to_y - 0.5))
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const fx = gx - x0
  const fy = gy - y0
  const base_x = at * w * h
  const base_y = (at + 1) * w * h
  const p00 = y0 * w + x0
  const p10 = y0 * w + x1
  const p01 = y1 * w + x0
  const p11 = y1 * w + x1
  const d = f.data
  out[0] = ((d[base_x + p00] * (1 - fx) + d[base_x + p10] * fx) * (1 - fy) + (d[base_x + p01] * (1 - fx) + d[base_x + p11] * fx) * fy) * f.to_x
  out[1] = ((d[base_y + p00] * (1 - fx) + d[base_y + p10] * fx) * (1 - fy) + (d[base_y + p01] * (1 - fx) + d[base_y + p11] * fx) * fy) * f.to_y
}

// 時間 t に点 (x, y) を通る絵が、前の絵から後の絵までに動く量を out へ入れる。
// 動きは時間 0.5 の位置で読むので、(x, y) を動きにそって時間 0.5 へもどした所を探す。
export function flow_through(f: flow_t, x: number, y: number, t: number, out: Float32Array): void {
  let rx = x
  let ry = y
  for (let k = 0; k < back_rounds; k++) {
    flow_at(f, rx, ry, 0, near_old)
    flow_at(f, rx, ry, 2, near_new)
    out[0] = near_new[0] - near_old[0]
    out[1] = near_new[1] - near_old[1]
    rx = x - (t - middle) * out[0]
    ry = y - (t - middle) * out[1]
  }
}
