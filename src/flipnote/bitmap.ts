// 1ビットの絵 (1 がその色の点) を調べるための、小さな道具。

// 点のまとまりの一覧。まとまり k の点は cells[start[k]] から cells[start[k + 1] - 1] まで。
export type blob_list_t = { count: number, start: Int32Array, cells: Int32Array }

// 左上から数えた点の合計 ((w+1)×(h+1))。box で四角の中の合計をすぐに求められる。
export function integral(src: ArrayLike<number>, w: number, h: number): Int32Array {
  const out = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += src[y * w + x]
      out[(y + 1) * (w + 1) + x + 1] = out[y * (w + 1) + x + 1] + row
    }
  }
  return out
}

// (x, y) を中心とする、半径 r の四角の中の合計 (絵の外は数えない)。
export function box(sum: Int32Array, w: number, h: number, x: number, y: number, r: number): number {
  const x0 = Math.max(0, x - r)
  const y0 = Math.max(0, y - r)
  const x1 = Math.min(w, x + r + 1)
  const y1 = Math.min(h, y + r + 1)
  const s = w + 1
  return sum[y1 * s + x1] - sum[y0 * s + x1] - sum[y1 * s + x0] + sum[y0 * s + x0]
}

// 点のまとまりを、左上から見つけた順にならべる。diagonal が 1 なら、斜めのとなりもつながりとみる。
// まとまりの中の点は、最初の点から幅優先でたどった順 (となりは上の行から、左から見る)。
export function blob_list(m: Uint8Array, w: number, h: number, diagonal: number): blob_list_t {
  const n = w * h
  const seen = new Uint8Array(n)
  const cells = new Int32Array(n)
  const start = new Int32Array(n + 1)
  let count = 0
  let total = 0
  for (let i = 0; i < n; i++) {
    if (!m[i] || seen[i]) continue
    let head = total
    cells[total++] = i
    seen[i] = 1
    while (head < total) {
      const j = cells[head++]
      const x = j % w
      const y = (j - x) / w
      const y1 = Math.min(h - 1, y + 1)
      const x1 = Math.min(w - 1, x + 1)
      for (let yy = Math.max(0, y - 1); yy <= y1; yy++) {
        for (let xx = Math.max(0, x - 1); xx <= x1; xx++) {
          if (!diagonal && xx !== x && yy !== y) continue
          const k = yy * w + xx
          if (!m[k] || seen[k]) continue
          seen[k] = 1
          cells[total++] = k
        }
      }
    }
    count++
    start[count] = total
  }
  return { count, start, cells }
}

// 最大公約数。
function gcd(p: number, q: number): number {
  while (q) {
    const r = p % q
    p = q
    q = r
  }
  return p
}

// (x, y) がその色の点か (絵の外は点でない)。
function dot_at(m: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1
}

// 2点以上の四角 (同じ大きさで、ずれなくならんだもの) を1点として描いた、線の絵 (2倍にしたドット絵の字など) の点。
// 斜めにもつながったまとまりごとに、横と縦の点のならびのはじまりと長さが、すべて同じ大きさの四角にそろうもの。
// 四角2つ以上の高さと幅があり、四角の 7 割以上が、たてかよこで、となりの四角とつながっていて、四角1つの穴 (網の目) が
// 四角 20 に1つまでのもの (1本のしまや、四角の市松・網の目の模様は入れない)。
export function block_art(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  const list = blob_list(m, w, h, 1)
  for (let k = 0; k < list.count; k++) {
    const begin = list.start[k]
    const end = list.start[k + 1]
    if (end - begin < 12) continue
    let x0 = w
    let y0 = h
    let x1 = -1
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
    // ならびのはじまりは、まとまりの左上からのずれで数える (四角がずれなくならぶなら、ずれも四角の大きさでわりきれる)。
    let g = 0
    for (let c = begin; c < end; c++) {
      const j = list.cells[c]
      const x = j % w
      const y = (j - x) / w
      if (x === 0 || !m[j - 1]) {
        let e = x
        while (e < w && m[y * w + e]) e++
        g = gcd(gcd(g, e - x), x - x0)
      }
      if (y === 0 || !m[j - w]) {
        let e = y
        while (e < h && m[e * w + x]) e++
        g = gcd(gcd(g, e - y), y - y0)
      }
      if (g < 2) break
    }
    if (g < 2) continue
    if (x1 - x0 + 1 < g * 2 || y1 - y0 + 1 < g * 2) continue
    let blocks = 0
    let joined = 0
    let holes = 0
    for (let c = begin; c < end; c++) {
      const j = list.cells[c]
      const x = j % w
      const y = (j - x) / w
      if ((x - x0) % g || (y - y0) % g) continue
      blocks++
      if (dot_at(m, w, h, x - g, y) || dot_at(m, w, h, x + g, y) || dot_at(m, w, h, x, y - g) || dot_at(m, w, h, x, y + g)) joined++
      // 右どなりが、上下左右を四角にかこまれた四角1つの穴 (網の目)。
      if (!dot_at(m, w, h, x + g, y) && dot_at(m, w, h, x + g * 2, y) && dot_at(m, w, h, x + g, y - g) && dot_at(m, w, h, x + g, y + g)) holes++
    }
    if (joined < blocks * 0.7 || holes * 20 > blocks) continue
    for (let c = begin; c < end; c++) out[list.cells[c]] = 1
  }
  return out
}

// たてよこに steps 歩ぶん広げた形。wall の点へは広げない。
export function grow4(m: Uint8Array, w: number, h: number, steps: number, wall?: Uint8Array): Uint8Array {
  const n = w * h
  let cur = m.slice()
  for (let step = 0; step < steps; step++) {
    const next = cur.slice()
    for (let i = 0; i < n; i++) {
      if (cur[i] || wall && wall[i]) continue
      const x = i % w
      if (x > 0 && cur[i - 1] || x < w - 1 && cur[i + 1] || i >= w && cur[i - w] || i + w < n && cur[i + w]) next[i] = 1
    }
    cur = next
  }
  return cur
}

// a の点のうち、b の点でないもの。
export function and_not(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] && !b[i] ? 1 : 0
  return out
}

// a の点のうち、b の点でもあるもの。
export function and(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] && b[i] ? 1 : 0
  return out
}

// key の小さい順にならべた番号 (同じ key は元の順のまま)。となりどうしの組をまぜていく (merge sort)。
export function stable_order(key: ArrayLike<number>, len: number): Int32Array {
  let order = new Int32Array(len)
  let spare = new Int32Array(len)
  for (let i = 0; i < len; i++) order[i] = i
  for (let width = 1; width < len; width *= 2) {
    for (let lo = 0; lo < len; lo += width * 2) {
      const mid = Math.min(len, lo + width)
      const hi = Math.min(len, lo + width * 2)
      let a = lo
      let b = mid
      let o = lo
      while (a < mid && b < hi) spare[o++] = key[order[b]] < key[order[a]] ? order[b++] : order[a++]
      while (a < mid) spare[o++] = order[a++]
      while (b < hi) spare[o++] = order[b++]
    }
    const t = order
    order = spare
    spare = t
  }
  return order
}

// i のたてよこのとなりの k 番目 (0 左、1 右、2 上、3 下。絵の外は -1)。
export function side(i: number, w: number, n: number, k: number): number {
  const x = i % w
  if (k === 0) return x > 0 ? i - 1 : -1
  if (k === 1) return x < w - 1 ? i + 1 : -1
  if (k === 2) return i >= w ? i - w : -1
  return i + w < n ? i + w : -1
}
