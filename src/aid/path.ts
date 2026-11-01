// 指でなぞったみちすじ。点を等間隔にならべなおし、指のふるえをならす。

// xs, ys は 1 点ずつの位置、turns は最初の向きから回った角度。len は長さ。
export type path_t = { xs: Float32Array, ys: Float32Array, turns: Float32Array, len: number }

// ならす回数。
const calm_rounds = 24
// 向きをはかるときに見る前後の点の数。
const turn_reach = 6
// 穴のまわりがこの割合より描かれていれば、まわりの色でうめる。
const hole_closed = 0.75
// これより濃い点を、描かれた点として数える。
const hole_ink = 128

// 点の列を、間隔 1 にならべなおす。
function points_even(src: readonly number[]): number[] {
  const out = [src[0], src[1]]
  let left = 1
  for (let i = 2; i + 1 < src.length; i += 2) {
    let x = src[i - 2]
    let y = src[i - 1]
    let dist = Math.hypot(src[i] - x, src[i + 1] - y)
    while (dist >= left) {
      const t = left / dist
      x += (src[i] - x) * t
      y += (src[i + 1] - y) * t
      out.push(x, y)
      dist -= left
      left = 1
    }
    left -= dist
  }
  out.push(src[src.length - 2], src[src.length - 1])
  return out
}

// 両端を動かさずに、となりの点となじませる。
function points_calm(pts: number[]): void {
  const n = pts.length >> 1
  for (let round = 0; round < calm_rounds; round++) {
    let px = pts[0]
    let py = pts[1]
    for (let i = 1; i < n - 1; i++) {
      const x = pts[i * 2]
      const y = pts[i * 2 + 1]
      pts[i * 2] = (px + x * 2 + pts[i * 2 + 2]) / 4
      pts[i * 2 + 1] = (py + y * 2 + pts[i * 2 + 3]) / 4
      px = x
      py = y
    }
  }
}

// points は x, y のならび。短すぎれば null。
export function path_make(points: readonly number[]): path_t | null {
  if (points.length < 4) return null
  const calm = points_even(points)
  points_calm(calm)
  const pts = points_even(calm)
  const n = pts.length >> 1
  if (n < 3) return null
  const xs = new Float32Array(n)
  const ys = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    xs[i] = pts[i * 2]
    ys[i] = pts[i * 2 + 1]
  }
  const turns = new Float32Array(n)
  let last = 0
  let first = 0
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - turn_reach)
    const b = Math.min(n - 1, i + turn_reach)
    let angle = Math.atan2(ys[b] - ys[a], xs[b] - xs[a])
    if (!i) first = angle
    else angle += Math.round((last - angle) / (Math.PI * 2)) * Math.PI * 2
    last = angle
    turns[i] = angle - first
  }
  return { xs, ys, turns, len: n - 1 }
}

// みちすじの u (0 から 1) の所。out は [動いた x, 動いた y, 回った角度]。
export function path_at(p: path_t, u: number, out: number[]): void {
  const at = Math.max(0, Math.min(1, u)) * p.len
  const i = Math.min(Math.floor(at), p.len - 1)
  const t = at - i
  out[0] = p.xs[i] + (p.xs[i + 1] - p.xs[i]) * t - p.xs[0]
  out[1] = p.ys[i] + (p.ys[i + 1] - p.ys[i]) * t - p.ys[0]
  out[2] = p.turns[i] + (p.turns[i + 1] - p.turns[i]) * t
}

// i の上下左右の点を順に呼ぶ。
function near_each(i: number, w: number, n: number, f: (near: number) => void): void {
  const x = i % w
  if (x > 0) f(i - 1)
  if (x < w - 1) f(i + 1)
  if (i >= w) f(i - w)
  if (i + w < n) f(i + w)
}

// 穴のかたまりを、まわりに近い色でうめる。まわりが空いていれば透明のままにする。
function hole_patch(px: Uint32Array, open: Uint8Array, list: Int32Array, count: number, w: number, front: Int32Array): void {
  const n = px.length
  const rim_seen = new Set<number>()
  let rim = 0
  let tail = 0
  for (let k = 0; k < count; k++) {
    near_each(list[k], w, n, near => {
      if (open[near] || rim_seen.has(near)) return
      rim_seen.add(near)
      rim++
      if (px[near] >>> 24 >= hole_ink) front[tail++] = near
    })
  }
  for (let k = 0; k < count; k++) px[list[k]] = 0
  if (!tail || tail < rim * hole_closed) {
    for (let k = 0; k < count; k++) open[list[k]] = 0
    return
  }
  for (let head = 0; head < tail; head++) {
    const from = front[head]
    near_each(from, w, n, near => {
      if (!open[near]) return
      open[near] = 0
      px[near] = px[from]
      front[tail++] = near
    })
  }
}

// hole の点 (ふちを 1 点広げる) を消して、まわりが描かれていれば同じ色でうめる。
export function hole_fill(px: Uint32Array, hole: Uint8Array, w: number): void {
  const n = px.length
  const open = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!hole[i]) continue
    open[i] = 1
    near_each(i, w, n, near => { open[near] = 1 })
  }
  const seen = new Uint8Array(n)
  const list = new Int32Array(n)
  const front = new Int32Array(n)
  for (let start = 0; start < n; start++) {
    if (!open[start] || seen[start]) continue
    let tail = 0
    list[tail++] = start
    seen[start] = 1
    for (let head = 0; head < tail; head++) {
      near_each(list[head], w, n, near => {
        if (!open[near] || seen[near]) return
        seen[near] = 1
        list[tail++] = near
      })
    }
    hole_patch(px, open, list, tail, w, front)
  }
}
