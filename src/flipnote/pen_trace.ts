// うごメモの線を、通常モードのペンで描いた線にするために、点の集まりから「線の中心のすじ」と太さを読みとる。
// 太さ 5 点以上のぬりつぶした形 (ベタ・太い字など) は形のまま残し、それより細い所だけをすじにする。

import { stable_order } from './bitmap'

// pts: 中心のすじ (x, y のくり返し)。tips: ほかの線につながっていない、線のはし (1 が始まり、2 が終わり)。
export type pen_line_t = { pts: number[], width: number, closed: number, tips: number }

// thick_split の結果。thick は形のまま描く所、thin はペンの線にする所。
export type split_t = { thick: Uint8Array, thin: Uint8Array }

// 8 方向のとなり (上から時計まわり)。
const nx = Int8Array.of(0, 1, 1, 1, 0, -1, -1, -1)
const ny = Int8Array.of(-1, -1, 0, 1, 1, 1, 0, -1)
// すじをたどるとき、となりを見る順 (たてよこを先に)。
const step_order = Int8Array.of(0, 2, 4, 6, 1, 3, 5, 7)

// 点からいちばん近いすきままでの近さ (縦横 3・ななめ 4 で数える)。ふちの点が 3。
function chamfer(m: Uint8Array, w: number, h: number): Uint16Array {
  const d = new Uint16Array(w * h)
  const far = 60000
  for (let i = 0; i < w * h; i++) d[i] = m[i] ? far : 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!d[i]) continue
      let v = d[i]
      v = Math.min(v, (x > 0 ? d[i - 1] : 0) + 3, (y > 0 ? d[i - w] : 0) + 3)
      v = Math.min(v, (x > 0 && y > 0 ? d[i - w - 1] : 0) + 4, (x < w - 1 && y > 0 ? d[i - w + 1] : 0) + 4)
      d[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!d[i]) continue
      let v = d[i]
      v = Math.min(v, (x < w - 1 ? d[i + 1] : 0) + 3, (y < h - 1 ? d[i + w] : 0) + 3)
      v = Math.min(v, (x < w - 1 && y < h - 1 ? d[i + w + 1] : 0) + 4, (x > 0 && y < h - 1 ? d[i + w - 1] : 0) + 4)
      d[i] = v
    }
  }
  return d
}

// m の点のうち from の点から steps 歩 (ななめも1歩) 以内の点。
function grow(from: Uint8Array, m: Uint8Array, w: number, h: number, steps: number): Uint8Array {
  let cur = from.slice()
  for (let s = 0; s < steps; s++) {
    const next = cur.slice()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (cur[i] || !m[i]) continue
        for (let k = 0; k < 8; k++) {
          const xx = x + nx[k]
          const yy = y + ny[k]
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && cur[yy * w + xx]) {
            next[i] = 1
            break
          }
        }
      }
    }
    cur = next
  }
  return cur
}

// 太い形 (幅 5 点以上) と細い線に分ける。
// 細い所でも、すじの長さが 12 点に満たない小さなもの (目・口・はなの形など) と、幅 3 点ほどの太めの線 (面積を、すじの長さで
// わって 2.6 以上。太いペンで書いた字など) は形のまま残す (ペンの線と形のつぎはぎになって、でこぼこに見えないように)。
// ただし、ななめにだけつながった1点の幅の短い線は、線にする。
// 太い形につながった細い所は、長い細い線 (すじが 40 点以上で、幅 3.5 点まで) だけを線にし、短いものや太めの所は形に入れる
// (筆で書いた太い字のはらいなどが、形とペンの線のつぎはぎになって、くずれて見えないように)。
export function thick_split(m: Uint8Array, w: number, h: number): split_t {
  const n = w * h
  const d = chamfer(m, w, h)
  const core = new Uint8Array(n)
  let any = 0
  for (let i = 0; i < n; i++) {
    if (d[i] >= 9) {
      core[i] = 1
      any = 1
    }
  }
  const thick = any ? grow(core, m, w, h, 3) : core
  const thin = new Uint8Array(n)
  for (let i = 0; i < n; i++) thin[i] = m[i] && !thick[i] ? 1 : 0
  const bone = skeleton(thin, w, h)
  const seen = new Uint8Array(n)
  const cells: number[] = []
  for (let i = 0; i < n; i++) {
    if (!thin[i] || seen[i]) continue
    cells.length = 0
    cells.push(i)
    seen[i] = 1
    let touch = 0
    let length = 0
    let span = 0
    let slant = 0
    for (let c = 0; c < cells.length; c++) {
      const j = cells[c]
      length += bone[j]
      const x = j % w
      const y = (j - x) / w
      if (bone[j]) span += bone_step(bone, w, h, x, y)
      if (!(x > 0 && thin[j - 1] || x < w - 1 && thin[j + 1] || j >= w && thin[j - w] || j + w < n && thin[j + w])) slant++
      for (let k = 0; k < 8; k++) {
        const xx = x + nx[k]
        const yy = y + ny[k]
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const q = yy * w + xx
        if (thick[q]) touch = 1
        if (thin[q] && !seen[q]) {
          seen[q] = 1
          cells.push(q)
        }
      }
    }
    if (length >= 12 && cells.length / (span + 1) < 2.6 && (!touch || length >= 40 && cells.length / length <= 3.5)) continue
    // 短くても、1点の幅で、ほとんど (2/3 以上) の点がななめにだけつながった線 (点々のペンで書いた字の短い線など) は線にする
    // (形のまま描くと、点のゆれがぎざぎざに残る)。
    if (!touch && length >= 5 && cells.length <= length + 1 && slant * 3 >= cells.length * 2) continue
    for (let c = 0; c < cells.length; c++) {
      thin[cells[c]] = 0
      thick[cells[c]] = 1
    }
  }
  return { thick, thin }
}

// (x, y) の点の値 (絵の外は 0)。
function px_at(m: Uint8Array, w: number, h: number, x: number, y: number): number {
  return x >= 0 && y >= 0 && x < w && y < h ? m[y * w + x] : 0
}

// すじの点 (x, y) から、右・下・右下・左下のとなりのすじの点までの長さの和 (すじの長さを、ななめは 1.4 として数える)。
// 角の三角 (たてよこでもつながっている所) のななめは数えない。
function bone_step(bone: Uint8Array, w: number, h: number, x: number, y: number): number {
  const right = px_at(bone, w, h, x + 1, y) === 1
  const below = px_at(bone, w, h, x, y + 1) === 1
  let sum = (right ? 1 : 0) + (below ? 1 : 0)
  if (px_at(bone, w, h, x + 1, y + 1) === 1 && !right && !below) sum += Math.SQRT2
  if (px_at(bone, w, h, x - 1, y + 1) === 1 && px_at(bone, w, h, x - 1, y) !== 1 && !below) sum += Math.SQRT2
  return sum
}

// 細い線を1点の幅まで削る (Zhang-Suen の方法)。つながりと線のはしは残る。
function skeleton(m: Uint8Array, w: number, h: number): Uint8Array {
  const s = m.slice()
  const kill: number[] = []
  for (let changed = 1; changed;) {
    changed = 0
    for (let step = 0; step < 2; step++) {
      kill.length = 0
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!s[y * w + x]) continue
          const p2 = px_at(s, w, h, x, y - 1)
          const p3 = px_at(s, w, h, x + 1, y - 1)
          const p4 = px_at(s, w, h, x + 1, y)
          const p5 = px_at(s, w, h, x + 1, y + 1)
          const p6 = px_at(s, w, h, x, y + 1)
          const p7 = px_at(s, w, h, x - 1, y + 1)
          const p8 = px_at(s, w, h, x - 1, y)
          const p9 = px_at(s, w, h, x - 1, y - 1)
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (b < 2 || b > 6) continue
          const a = (!p2 && p3 ? 1 : 0) + (!p3 && p4 ? 1 : 0) + (!p4 && p5 ? 1 : 0) + (!p5 && p6 ? 1 : 0) + (!p6 && p7 ? 1 : 0) + (!p7 && p8 ? 1 : 0) + (!p8 && p9 ? 1 : 0) + (!p9 && p2 ? 1 : 0)
          if (a !== 1) continue
          if (step === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue
          kill.push(y * w + x)
        }
      }
      for (let k = 0; k < kill.length; k++) s[kill[k]] = 0
      if (kill.length) changed = 1
    }
  }
  return s
}

// すじの点 i が、はしか分かれ目 (となりのすじの点が 2 つでない所) か。
function is_node(s: Uint8Array, count: Uint8Array, i: number): boolean {
  return s[i] === 1 && count[i] !== 2
}

// cur のつぎに進むすじの点 (なければ -1)。たてよこのとなりを先に見る (ななめの近道で角を落とさないように)。
// loop が 0 なら、はしか分かれ目に出たらそこで止まる (その点を返す)。
function next_step(s: Uint8Array, count: Uint8Array, seen: Uint8Array, w: number, h: number, cur: number, prev: number, loop: number): number {
  const x = cur % w
  const y = (cur - x) / w
  let pick = -1
  for (let o = 0; o < 8; o++) {
    const k = step_order[o]
    const xx = x + nx[k]
    const yy = y + ny[k]
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
    const j = yy * w + xx
    if (!s[j] || j === prev) continue
    if (is_node(s, count, j) && !loop) return j
    if (!seen[j] && pick < 0) pick = j
  }
  return pick
}

// 細い線を、中心のすじ (点の中心を通る折れ線) と太さの組にする。
// すじは、はし・分かれ目でくぎって1本ずつにし、分かれ目から出る短いひげは捨てる。
// 太さは、そのすじにいちばん近い点の数 (面積) をすじの長さでわって求める。
export function pen_lines(thin: Uint8Array, w: number, h: number): pen_line_t[] {
  const n = w * h
  const s = skeleton(thin, w, h)
  const count = new Uint8Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!s[y * w + x]) continue
      let c = 0
      for (let k = 0; k < 8; k++) {
        const xx = x + nx[k]
        const yy = y + ny[k]
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && s[yy * w + xx]) c++
      }
      count[y * w + x] = c
    }
  }
  const seen = new Uint8Array(n)
  const paths: number[][] = []
  for (let i = 0; i < n; i++) {
    if (!is_node(s, count, i)) continue
    if (count[i] === 0) {
      paths.push([i])
      continue
    }
    const x = i % w
    const y = (i - x) / w
    for (let k = 0; k < 8; k++) {
      const xx = x + nx[k]
      const yy = y + ny[k]
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
      const j = yy * w + xx
      if (!s[j]) continue
      if (is_node(s, count, j)) {
        if (j > i) paths.push([i, j])
        continue
      }
      if (seen[j]) continue
      const path = [i, j]
      seen[j] = 1
      for (let prev = i, cur = j; ;) {
        const next = next_step(s, count, seen, w, h, cur, prev, 0)
        if (next < 0) break
        path.push(next)
        if (is_node(s, count, next)) break
        seen[next] = 1
        prev = cur
        cur = next
      }
      paths.push(path)
    }
  }
  // 分かれ目もはしもない輪は、ひとまわりたどる。
  for (let i = 0; i < n; i++) {
    if (!s[i] || seen[i] || is_node(s, count, i)) continue
    const path = [i]
    seen[i] = 1
    for (let prev = -1, cur = i; ;) {
      const next = next_step(s, count, seen, w, h, cur, prev, 1)
      if (next < 0) break
      path.push(next)
      seen[next] = 1
      prev = cur
      cur = next
    }
    path.push(i)
    paths.push(path)
  }
  // 太さをはかるため、細い線の点をいちばん近いすじに分ける。
  const owner = new Int32Array(n).fill(-1)
  let queue: number[] = []
  for (let k = 0; k < paths.length; k++) {
    const path = paths[k]
    for (let p = 0; p < path.length; p++) {
      if (owner[path[p]] >= 0) continue
      owner[path[p]] = k
      queue.push(path[p])
    }
  }
  const area = new Float64Array(paths.length)
  for (let q = 0; q < queue.length; q++) area[owner[queue[q]]]++
  while (queue.length) {
    const next: number[] = []
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]
      const x = i % w
      const y = (i - x) / w
      for (let k = 0; k < 8; k++) {
        const xx = x + nx[k]
        const yy = y + ny[k]
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const j = yy * w + xx
        if (!thin[j] || owner[j] >= 0) continue
        owner[j] = owner[i]
        area[owner[i]]++
        next.push(j)
      }
    }
    queue = next
  }
  // 太さは、その色の線でいちばん多い太さにそろえる (分かれ目でくぎった線ごとに太さがばらつかないように)。
  // かけ離れた太さの線だけは、その線の太さ (整数) で引く。
  const raw_length = new Float64Array(paths.length)
  const raw_width = new Float64Array(paths.length)
  for (let k = 0; k < paths.length; k++) {
    const path = paths[k]
    let length = 0
    for (let p = 1; p < path.length; p++) {
      const a = path[p - 1]
      const b = path[p]
      length += Math.hypot(a % w - b % w, Math.floor(a / w) - Math.floor(b / w))
    }
    raw_length[k] = length
    raw_width[k] = length < 1 ? 2 * Math.sqrt(area[k] / Math.PI) : area[k] / (length + 1)
  }
  // 4 点以上の長さの線を、太さの細い順にならべ、長さの合計の半分に届いた所の太さを、ふつうの太さとする。
  const long: number[] = []
  const long_width: number[] = []
  for (let k = 0; k < paths.length; k++) {
    if (raw_length[k] < 4) continue
    long.push(k)
    long_width.push(raw_width[k])
  }
  const order = stable_order(long_width, long.length)
  let common = 0
  let total = 0
  for (let r = 0; r < order.length; r++) total += raw_length[long[order[r]]]
  for (let acc = 0, r = 0; r < order.length; r++) {
    acc += raw_length[long[order[r]]]
    if (acc * 2 >= total) {
      common = Math.max(1, raw_width[long[order[r]]])
      break
    }
  }
  const out: pen_line_t[] = []
  for (let k = 0; k < paths.length; k++) {
    const path = paths[k]
    const pts: number[] = []
    let length = 0
    for (let p = 0; p < path.length; p++) {
      const x = path[p] % w
      const y = (path[p] - x) / w
      if (p) length += Math.hypot(x + 0.5 - pts[pts.length - 2], y + 0.5 - pts[pts.length - 1])
      pts.push(x + 0.5, y + 0.5)
    }
    const guess = raw_width[k]
    // 分かれ目のあいだの短いすじ (長さが 4 点か、ふつうの太さの 3 倍まで) は、まわりの点を多く受けもつので太さを大きく見つもりがち。
    // その色の線のふつうの太さで引く (太く見つもると、分かれ目に丸いこぶができる)。
    const width = common && (Math.abs(guess - common) <= 0.75 || raw_length[k] < Math.max(4, common * 3)) ? common : Math.min(5, Math.max(1, guess))
    // 分かれ目から出る、太さより短いひげは捨てる (細らせたときにできる、元の絵にない小さな枝)。
    const a = path[0]
    const b = path[path.length - 1]
    const spur = path.length > 1 && (count[a] === 1) !== (count[b] === 1) && length < width * 1.5
    if (spur) continue
    const closed = path.length > 2 && a === b ? 1 : 0
    const tips = closed || path.length < 2 ? 0 : (count[a] === 1 ? 1 : 0) | (count[b] === 1 ? 2 : 0)
    unzig(pts)
    const pieces = split_corners(pts, closed)
    for (let p = 0; p < pieces.length; p++) {
      const ends = (p === 0 ? tips & 1 : 0) | (p === pieces.length - 1 ? tips & 2 : 0)
      out.push({ pts: pieces[p], width, closed: pieces.length === 1 ? closed : 0, tips: ends })
    }
  }
  return out
}

// 1点ずつ左右にゆれる、ななめにだけつながった線 (点々のペンで書いた線など) のゆれを、まっすぐにならす。
// 前後へのななめの1歩がたがいに直角な点 (ゆれの山) だけを、前後の点との [1 2 1] の平均にする。
function unzig(pts: number[]): void {
  const count = pts.length / 2
  const src = pts.slice()
  for (let i = 1; i < count - 1; i++) {
    const ax = src[i * 2] - src[i * 2 - 2]
    const ay = src[i * 2 + 1] - src[i * 2 - 1]
    const bx = src[i * 2 + 2] - src[i * 2]
    const by = src[i * 2 + 3] - src[i * 2 + 1]
    if (Math.abs(ax) !== 1 || Math.abs(ay) !== 1 || Math.abs(bx) !== 1 || Math.abs(by) !== 1 || ax * bx + ay * by) continue
    pts[i * 2] = (src[i * 2 - 2] + src[i * 2] * 2 + src[i * 2 + 2]) / 4
    pts[i * 2 + 1] = (src[i * 2 - 1] + src[i * 2 + 1] * 2 + src[i * 2 + 3]) / 4
  }
}

// すじを、急に曲がる角 (前後 3 点の向きが 70° 以上かわる所) で切りわける。ペンの線は角をまるくけずるので、
// 角でつないだまま引くと角の点がこぼれ、こぼれた所がこぶになって描きたされてしまう。切りわけて、それぞれの
// まるいはしで角をおおう。
function split_corners(pts: number[], closed: number): number[][] {
  const count = pts.length / 2
  const out: number[][] = []
  if (count < 7) {
    out.push(pts)
    return out
  }
  const turn = new Float64Array(count)
  for (let i = 3; i < count - 3; i++) {
    const ax = pts[i * 2] - pts[(i - 3) * 2]
    const ay = pts[i * 2 + 1] - pts[(i - 3) * 2 + 1]
    const bx = pts[(i + 3) * 2] - pts[i * 2]
    const by = pts[(i + 3) * 2 + 1] - pts[i * 2 + 1]
    turn[i] = 1 - (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1)
  }
  const cuts: number[] = []
  for (let i = 3; i < count - 3; i++) {
    if (turn[i] < 0.66) continue
    let peak = 1
    for (let j = i - 3; j <= i + 3; j++) if (turn[j] > turn[i] || turn[j] === turn[i] && j < i) peak = 0
    if (peak) cuts.push(i)
  }
  if (!cuts.length) {
    out.push(pts)
    return out
  }
  cuts.push(count - 1)
  let from = 0
  for (let c = 0; c < cuts.length; c++) {
    out.push(pts.slice(from * 2, cuts[c] * 2 + 2))
    from = cuts[c]
  }
  // 輪は、最初と最後の切れはしをつなぐ (輪の始まりは角とはかぎらないため)。
  if (closed && out.length > 1) {
    const joined = out.pop()!
    for (let p = 2; p < out[0].length; p++) joined.push(out[0][p])
    out[0] = joined
  }
  return out
}
