// あみ点・しま・市松などの、くり返し模様を見つける。
// 模様は2つの向きにくり返すので、1つの向きにしかつづかない線と見分けられる。

import { blob_list, box, integral } from './bitmap'

// まばらな点の模様 (sparse_tone の結果)。dots は模様の点、cover は模様が広がっている所。
export type sparse_t = { dots: Uint8Array, cover: Uint8Array }

// 模様のくり返しを調べるずらし幅 (x, y のくり返し)。うごメモの模様はほとんど 4 点以内でくり返す。
// 6 点のものは、6 点ごとに切れ目のあるしま (れんがのような模様) のため。
const shifts = Int8Array.of(
  1, 0, 0, 1, 1, 1, 1, -1, 2, 0, 0, 2, 2, 2, 2, -2, 2, 1, 1, 2, 2, -1, 1, -2,
  3, 0, 0, 3, 3, 3, 3, -3, 4, 0, 0, 4, 6, 0, 0, 6,
)
const shift_n = shifts.length / 2
const long_from = 18
// 縦か横に1点ずらしても重なる所 (線がつづいている所)。
const along_line = 1 << 0 | 1 << 1

// 向きが 40° 以上ちがう2つのずらし幅の組 (短いものから。ずらし幅の番号2つのくり返し)。
const pairs = make_pairs()
// 2つのずらし幅の組の順位 (使えない組は -1)。くり返している向きのうち、いちばん短い組を選ぶのに使う。
const pair_rank = make_pair_rank(pairs)

// 向きが 40° 以上ちがう2つのずらし幅の組を、2つの長さの和の短い順に (同じ長さは見つけた順に) ならべる。
// 階段になった線のふちは、ふちに沿った近い2方向 (たとえば 2:1 と 1:0) でもくり返して見えるので、その組は使わない。
function make_pairs(): Int16Array {
  const first: number[] = []
  const second: number[] = []
  const length: number[] = []
  for (let i = 0; i < shift_n; i++) {
    for (let j = i + 1; j < shift_n; j++) {
      const ax = shifts[i * 2]
      const ay = shifts[i * 2 + 1]
      const bx = shifts[j * 2]
      const by = shifts[j * 2 + 1]
      if (Math.abs(ax * bx + ay * by) > Math.cos(40 * Math.PI / 180) * Math.hypot(ax, ay) * Math.hypot(bx, by)) continue
      // 長さの順の所へ入れる (同じ長さのものの後ろへ)。
      const len = Math.hypot(ax, ay) + Math.hypot(bx, by)
      let at = length.length
      while (at > 0 && length[at - 1] > len) at--
      first.splice(at, 0, i)
      second.splice(at, 0, j)
      length.splice(at, 0, len)
    }
  }
  const out = new Int16Array(first.length * 2)
  for (let k = 0; k < first.length; k++) {
    out[k * 2] = first[k]
    out[k * 2 + 1] = second[k]
  }
  return out
}

// ずらし幅の番号2つから、その組の順位を引く表。
function make_pair_rank(list: Int16Array): Int16Array {
  const out = new Int16Array(shift_n * shift_n).fill(-1)
  for (let k = 0; k < list.length / 2; k++) {
    out[list[k * 2] * shift_n + list[k * 2 + 1]] = k
    out[list[k * 2 + 1] * shift_n + list[k * 2]] = k
  }
  return out
}


// 規則正しい模様の点 (残りは模様では説明できない点で、線として描く)。模様がなければ null。
// radius はくり返しを調べる窓の半径、ratio は窓の中で重ならなければならない割合 (ふつうは 7×7 で 95%)。
// 絵のある所だけを (まわりに余白をつけて) 切り出して調べる。
export function tone_pattern(m: Uint8Array, w: number, h: number, radius = 3, ratio = 0.95): Uint8Array | null {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  let count = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue
      count++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (count < 24) return null
  const pad = 16
  const cx = Math.max(0, x0 - pad)
  const cy = Math.max(0, y0 - pad)
  const cw = Math.min(w, x1 + pad + 1) - cx
  const ch = Math.min(h, y1 + pad + 1) - cy
  if (cw === w && ch === h) return pattern_area(m, w, h, radius, ratio)
  const crop = new Uint8Array(cw * ch)
  for (let y = 0; y < ch; y++) crop.set(m.subarray((y + cy) * w + cx, (y + cy) * w + cx + cw), y * cw)
  const part = pattern_area(crop, cw, ch, radius, ratio)
  if (!part) return null
  const out = new Uint8Array(w * h)
  for (let y = 0; y < ch; y++) out.set(part.subarray(y * cw, y * cw + cw), (y + cy) * w + cx)
  return out
}

// tone_pattern の本体 (切り出した所で調べる)。
function pattern_area(m: Uint8Array, w: number, h: number, radius: number, ratio: number): Uint8Array | null {
  const n = w * h
  const s1 = w + 1
  const sum = integral(m, w, h)
  // 1. 窓の中が「点もすきまもある」所だけを調べる。窓の四すみの位置と広さはここで覚えておく。
  const list: number[] = []
  const corners: number[] = []
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - radius) * s1
    const yb = Math.min(h, y + radius + 1) * s1
    const wh = Math.min(h, y + radius + 1) - Math.max(0, y - radius)
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - radius)
      const xb = Math.min(w, x + radius + 1)
      const a = (xb - xa) * wh
      const c = sum[yb + xb] - sum[ya + xb] - sum[yb + xa] + sum[ya + xa]
      if (c >= 4 && a - c >= 4 && c >= a * 0.06 && c <= a * 0.94) {
        list.push(y * w + x)
        corners.push(ya + xa, ya + xb, yb + xa, yb + xb, a, c)
      }
    }
  }
  const cand_n = list.length
  if (cand_n < 8) return null
  // 2. それぞれのずらし幅で、窓の中の点がほぼすべて重なるか (くり返しになっているか) を調べる。
  // 前へずらした数と後ろへずらした数の多いほうで見る (模様のきわや絵のはしでも、内側へ向けて数えられる)。
  // ほとんどがベタで穴が少しだけの所は、どうずらしても重なってしまうので、少ないほうの点 (模様の目) どうしが
  // ずらした先でも重なることも確かめる。
  const pass = new Uint32Array(n)
  const all = new Int32Array(s1 * (h + 1))
  const on = new Int32Array(s1 * (h + 1))
  for (let si = 0; si < shift_n; si++) {
    const bit = 1 << si
    for (let k = 1; k >= -1; k -= 2) {
      const dx = shifts[si * 2] * k
      const dy = shifts[si * 2 + 1] * k
      // ずらした先が絵の外になる所は「重ならない」とする。内側の範囲だけ比べる。
      const xa = Math.max(0, -dx)
      const xb = Math.min(w, w - dx)
      for (let y = 0; y < h; y++) {
        const yy = y + dy
        const at = (y + 1) * s1 + 1
        const up = y * s1 + 1
        const row = y * w
        const shifted = yy * w + dx
        const inside = yy >= 0 && yy < h
        let ra = 0
        let ro = 0
        for (let x = 0; x < w; x++) {
          if (inside && x >= xa && x < xb) {
            const v = m[row + x]
            if (m[shifted + x] === v) {
              ra++
              ro += v
            }
          }
          all[at + x] = all[up + x] + ra
          on[at + x] = on[up + x] + ro
        }
      }
      for (let c = 0; c < cand_n; c++) {
        const i = list[c]
        if (pass[i] & bit) continue
        const o = c * 6
        const a = corners[o + 4]
        const hit = all[corners[o + 3]] - all[corners[o + 1]] - all[corners[o + 2]] + all[corners[o]]
        if (hit < a * ratio) continue
        const set = corners[o + 5]
        const on_hit = on[corners[o + 3]] - on[corners[o + 1]] - on[corners[o + 2]] + on[corners[o]]
        const minority = set * 2 <= a ? on_hit / set : (hit - on_hit) / (a - set)
        if (minority >= 0.9) pass[i] |= bit
      }
    }
  }
  // 3. 2方向にくり返している所を、模様の芯とする。
  const core = new Uint8Array(n)
  const pair = new Int16Array(n).fill(-1)
  let core_n = 0
  const on_bits = new Int32Array(32)
  for (let i = 0; i < n; i++) {
    const bits = pass[i]
    if (!bits || !(bits & (bits - 1))) continue
    let bit_n = 0
    for (let b = bits; b; b &= b - 1) on_bits[bit_n++] = 31 - Math.clz32(b & -b)
    let best = -1
    for (let a = 0; a < bit_n; a++) {
      for (let b = a + 1; b < bit_n; b++) {
        const k = pair_rank[on_bits[a] * shift_n + on_bits[b]]
        if (k >= 0 && (best < 0 || k < best)) best = k
      }
    }
    if (best < 0) continue
    // 6 点のくり返しは、線がつづいている所では使わない (等間隔にならべた線を、塗りにしてしまわないように)。
    if ((pairs[best * 2] >= long_from || pairs[best * 2 + 1] >= long_from) && bits & along_line) continue
    core[i] = 1
    pair[i] = best
    core_n++
  }
  // 線のかどなどで、たまたま数点だけ芯になった所は捨てる (本当の模様の芯はまとまった広さがある)。
  const cores = blob_list(core, w, h, 1)
  for (let k = 0; k < cores.count; k++) {
    if (cores.start[k + 1] - cores.start[k] > 7) continue
    for (let c = cores.start[k]; c < cores.start[k + 1]; c++) {
      const j = cores.cells[c]
      core[j] = 0
      pair[j] = -1
      core_n--
    }
  }
  if (!core_n) return null
  // 4. 芯のまわり (窓の広さ) に、その模様のくり返し方を広げる。
  const near = new Int16Array(n).fill(-1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = pair[y * w + x]
      if (k < 0) continue
      for (let yy = Math.max(0, y - radius); yy <= Math.min(h - 1, y + radius); yy++) {
        for (let xx = Math.max(0, x - radius); xx <= Math.min(w - 1, x + radius); xx++) {
          if (near[yy * w + xx] < 0) near[yy * w + xx] = k
        }
      }
    }
  }
  // 5. 模様がそこにあるべき点 (くり返した先の、芯とそのとなりの点の多数決) を求め、実際の点と合っているかを見る。
  // 窓が入りきらない細い模様では、芯にならない段もあるので、芯のとなりまでを手本にする。
  const trust = new Uint8Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!core[y * w + x]) continue
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) trust[yy * w + xx] = 1
      }
    }
  }
  const expect = new Int8Array(n).fill(-1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const k = near[i]
      if (k < 0) continue
      const ax = shifts[pairs[k * 2] * 2]
      const ay = shifts[pairs[k * 2] * 2 + 1]
      const bx = shifts[pairs[k * 2 + 1] * 2]
      const by = shifts[pairs[k * 2 + 1] * 2 + 1]
      let on = 0
      let votes = 0
      for (let p = -3; p <= 3; p++) {
        for (let q = -3; q <= 3; q++) {
          if (!p && !q) continue
          const xx = x + p * ax + q * bx
          const yy = y + p * ay + q * by
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const j = yy * w + xx
          if (!trust[j]) continue
          votes++
          on += m[j]
        }
      }
      if (votes) expect[i] = on * 2 > votes ? 1 : on * 2 < votes ? 0 : m[i]
    }
  }
  // 6. まわり 3×3 がすべて模様どおりの所を芯にし、1点ぶん広げて模様の所とする (線のきわまで模様とみる)。
  const strict = new Uint8Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!as_expected(expect, m, y * w + x)) continue
      let all = 1
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1) && all; yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          if (as_expected(expect, m, yy * w + xx)) continue
          all = 0
          break
        }
      }
      strict[y * w + x] = all
    }
  }
  const region = new Uint8Array(n)
  let region_n = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (expect[i] < 0) continue
      let hit = 0
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1) && !hit; yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          if (!strict[yy * w + xx]) continue
          hit = 1
          break
        }
      }
      if (!hit) continue
      region[i] = 1
      region_n++
    }
  }
  if (!region_n) return null
  // 7. 模様で説明できない点が線。模様の点と重なって1点だけ切れた線は、両どなりが線ならつなぐ。
  const pattern = new Uint8Array(n)
  const line = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!m[i]) continue
    if (region[i] && expect[i] === 1) pattern[i] = 1
    else line[i] = 1
  }
  const joined = line.slice()
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (!pattern[i]) continue
      if (line[i - 1] && line[i + 1] || line[i - w] && line[i + w] || line[i - w - 1] && line[i + w + 1] || line[i - w + 1] && line[i + w - 1]) {
        joined[i] = 1
        pattern[i] = 0
      }
    }
  }
  // 模様の中やきわに残った、6点までの小さな線のかけらは模様の点とみなす (曲線にすると黒い粒に見えるため)。
  // 先に模様にしたかけらの所も、あとのかけらのまわりとして数える。
  const bits = blob_list(joined, w, h, 1)
  for (let b = 0; b < bits.count; b++) {
    const begin = bits.start[b]
    const end = bits.start[b + 1]
    if (end - begin > 6) continue
    let touch = 0
    let edge = 0
    for (let c = begin; c < end; c++) {
      const j = bits.cells[c]
      const x = j % w
      const y = (j - x) / w
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          const k = yy * w + xx
          if (joined[k]) continue
          edge++
          touch += region[k]
        }
      }
    }
    if (touch * 2 < edge) continue
    for (let c = begin; c < end; c++) {
      const j = bits.cells[c]
      joined[j] = 0
      pattern[j] = 1
      region[j] = 1
    }
  }
  return pattern
}

// i の点が、模様からあるべき点のとおりか。
function as_expected(expect: Int8Array, m: Uint8Array, i: number): boolean {
  return expect[i] >= 0 && expect[i] === m[i]
}

// 最大公約数 (負の数は正にしてから)。
function gcd_abs(p: number, q: number): number {
  p = Math.abs(p)
  q = Math.abs(q)
  while (q) {
    const t = p % q
    p = q
    q = t
  }
  return p
}

// まばらな点の模様 (小さな点が、6点ほどまでの間をあけて規則正しくならんだもの) と、それを間引いて濃さを変えた
// ぼかし (横線のぼかしなど)。7×7 の窓には点が数個しか入らず、tone_pattern ではくり返しを確かめられないので、
// 点どうしの位置で調べる。まわり (13×13) の 8 つ以上の点が、すべて1つの格子 (点のない格子の目があってもよい) に
// 乗っていて、点が線のように1列や2列にならんでいない所の点と、そこから同じ格子でつながる点を、模様の点とする。
// dots は模様の点、cover は模様が広がっている所 (模様の点のあいだの、12点までのすきまを埋めた所)。
// 模様がなければ null。
export function sparse_tone(m: Uint8Array, w: number, h: number): sparse_t | null {
  const n = w * h
  const reach = 6
  // 1. 点: 2×2 に入る、4点までのまとまり。いちばん上の左の点を、その点の位置とする。
  // part は、点ごとの、まとまりの一覧での番号。
  const at = new Int32Array(n).fill(-1)
  const pos: number[] = []
  const part: number[] = []
  const list = blob_list(m, w, h, 1)
  for (let k = 0; k < list.count; k++) {
    const begin = list.start[k]
    const end = list.start[k + 1]
    if (end - begin > 4) continue
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
    if (x1 - x0 > 1 || y1 - y0 > 1) continue
    at[list.cells[begin]] = pos.length
    pos.push(list.cells[begin])
    part.push(k)
  }
  if (pos.length < 12) return null
  // 2. 点ごとに、まわりの点へのずれがすべて乗る、いちばん細かい格子を求める。格子は、横の向き (a, 0) と
  // もう1つの向き (s, b) で表す (ずれを1つずつ加えて、互除法でまとめる)。
  const keep = new Uint8Array(pos.length)
  // 模様の点ごとの格子 (a, s, b)。
  const grid = new Int32Array(pos.length * 3)
  let keep_n = 0
  const near: number[] = []
  for (let d = 0; d < pos.length; d++) {
    const x = pos[d] % w
    const y = (pos[d] - x) / w
    near.length = 0
    for (let yy = Math.max(0, y - reach); yy <= Math.min(h - 1, y + reach); yy++) {
      for (let xx = Math.max(0, x - reach); xx <= Math.min(w - 1, x + reach); xx++) if (at[yy * w + xx] >= 0) near.push(xx - x, yy - y)
    }
    if (near.length < 16) continue
    let a = 0
    let s = 0
    let b = 0
    for (let k = 0; k < near.length; k += 2) {
      let dx = near[k]
      let dy = near[k + 1]
      if (dy < 0) {
        dx = -dx
        dy = -dy
      }
      // もう格子に乗っているずれは、とばす。
      if (b && dy % b === 0 && (a ? (dx - dy / b * s) % a === 0 : dx === dy / b * s)) continue
      if (!dy) a = gcd_abs(a, dx)
      else if (!b) {
        s = dx
        b = dy
      } else {
        // p·b + q·dy = g となる p, q (拡張互除法)。
        let r0 = b
        let r1 = dy
        let p0 = 1
        let p1 = 0
        let q0 = 0
        let q1 = 1
        while (r1) {
          const t = Math.floor(r0 / r1)
          const r = r0 - t * r1
          const p = p0 - t * p1
          const q = q0 - t * q1
          r0 = r1
          r1 = r
          p0 = p1
          p1 = p
          q0 = q1
          q1 = q
        }
        a = gcd_abs(a, dy / r0 * s - b / r0 * dx)
        s = p0 * s + q0 * dx
        b = r0
      }
      if (a) s = (s % a + a) % a
      // 細かすぎる格子 (どの点も乗る) になったら、そこでやめる。
      if (a && b && a * b < 3) break
    }
    if (!a || !b || a * b < 3 || a * b > 36) continue
    // 点が1列や2列にならんだだけの所 (点線など) は模様とみない。点の広がりの、いちばんせまい向きの分散が 4 以上。
    const count = near.length / 2
    let mx = 0
    let my = 0
    for (let k = 0; k < near.length; k += 2) {
      mx += near[k]
      my += near[k + 1]
    }
    mx /= count
    my /= count
    let sxx = 0
    let syy = 0
    let sxy = 0
    for (let k = 0; k < near.length; k += 2) {
      const ex = near[k] - mx
      const ey = near[k + 1] - my
      sxx += ex * ex
      syy += ey * ey
      sxy += ex * ey
    }
    sxx /= count
    syy /= count
    sxy /= count
    const minor = (sxx + syy) / 2 - Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy)
    if (minor < 4) continue
    keep[d] = 1
    grid[d * 3] = a
    grid[d * 3 + 1] = s
    grid[d * 3 + 2] = b
    keep_n++
  }
  if (keep_n < 8) return null
  // ぼかしのうすいはしなど、まわりの点が少なくて確かめられなかった点も、8点以内の模様の点から見て同じ格子に
  // 乗っていれば、模様の点とする (そこからさらに広げていく)。
  const queue: number[] = []
  for (let d = 0; d < pos.length; d++) if (keep[d]) queue.push(d)
  for (let q = 0; q < queue.length; q++) {
    const d = queue[q]
    const x = pos[d] % w
    const y = (pos[d] - x) / w
    const a = grid[d * 3]
    const s = grid[d * 3 + 1]
    const b = grid[d * 3 + 2]
    for (let yy = Math.max(0, y - 8); yy <= Math.min(h - 1, y + 8); yy++) {
      const dy = yy - y
      if (dy % b) continue
      for (let xx = Math.max(0, x - 8); xx <= Math.min(w - 1, x + 8); xx++) {
        const e = at[yy * w + xx]
        if (e < 0 || keep[e] || (xx - x - dy / b * s) % a) continue
        keep[e] = 1
        grid[e * 3] = a
        grid[e * 3 + 1] = s
        grid[e * 3 + 2] = b
        queue.push(e)
      }
    }
  }
  const dots = new Uint8Array(n)
  const mark = new Uint8Array(n)
  for (let d = 0; d < pos.length; d++) {
    if (!keep[d]) continue
    mark[pos[d]] = 1
    for (let c = list.start[part[d]]; c < list.start[part[d] + 1]; c++) dots[list.cells[c]] = 1
  }
  // 3. 模様の点のあいだのすきま (12点まで) を埋めた所 (13×13 の四角で広げてから、同じだけけずる)。
  const sum = integral(mark, w, h)
  const wide = new Uint8Array(n)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (box(sum, w, h, x, y, reach)) wide[y * w + x] = 1
  const wsum = integral(wide, w, h)
  const cover = new Uint8Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const area = (Math.min(w, x + reach + 1) - Math.max(0, x - reach)) * (Math.min(h, y + reach + 1) - Math.max(0, y - reach))
      if (box(wsum, w, h, x, y, reach) === area) cover[y * w + x] = 1
    }
  }
  return { dots, cover }
}

// 塗りの所の中だけで数えた模様の点の割合 (5×5) を、2回求める (模様の目のくり返しによるむらを消す)。
// 塗りの所の外は数えないので、塗りのきわでもうすくならない。
export function tone_level(pattern: Uint8Array, region: Uint8Array, w: number, h: number): Float32Array {
  const n = w * h
  const rs = integral(region, w, h)
  let tone = new Float32Array(pattern)
  for (let pass = 0; pass < 2; pass++) {
    const ts = new Float64Array((w + 1) * (h + 1))
    for (let y = 0; y < h; y++) {
      let row = 0
      for (let x = 0; x < w; x++) {
        row += region[y * w + x] ? tone[y * w + x] : 0
        ts[(y + 1) * (w + 1) + x + 1] = ts[y * (w + 1) + x + 1] + row
      }
    }
    const next = new Float32Array(n)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (!region[i]) continue
        const r = box(rs, w, h, x, y, 2)
        const x0 = Math.max(0, x - 2)
        const y0 = Math.max(0, y - 2)
        const x1 = Math.min(w, x + 3)
        const y1 = Math.min(h, y + 3)
        const t = ts[y1 * (w + 1) + x1] - ts[y0 * (w + 1) + x1] - ts[y1 * (w + 1) + x0] + ts[y0 * (w + 1) + x0]
        next[i] = r ? t / r : 0
      }
    }
    tone = next
  }
  return tone
}
