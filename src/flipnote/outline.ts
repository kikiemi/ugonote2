// 点の集まりの輪郭をたどり、点の階段ではない、なめらかな曲線の形にする。

// 元の点のさかいめが、描く先のどこになるか (xs は w+1 個、ys は h+1 個)。
export type edges_t = { xs: Float32Array, ys: Float32Array }

// 輪郭の点の、元の輪郭の始まりからのずれ (px, py) と、その合計 (0 番から i 番の手前までの和)。fit_curve で使う。
type fit_sums_t = { n: number, px: Float64Array, py: Float64Array, sx: Float64Array, sy: Float64Array, sxx: Float64Array, sxy: Float64Array, syy: Float64Array }

// 輪郭をたどる向き (右、下、左、上)。
const walk_x = Int8Array.of(1, 0, -1, 0)
const walk_y = Int8Array.of(0, 1, 0, -1)

// 元の絵の座標 v を、描く先の座標にする (点のさかいめのあいだは、まっすぐにつなぐ)。
export function along(edges: Float32Array, v: number): number {
  const i = Math.max(0, Math.min(edges.length - 2, Math.floor(v)))
  return edges[i] + (v - i) * (edges[i + 1] - edges[i])
}

// 点の集まりのなめらかな形を、at で描く先の座標にして path に足す。corner は角のまま残すとがり具合 (小さいほど角が多く残る)。
// corner が 0 なら曲線にせず、ふちの中点を結んだ折れ線にする (小さな文字の角が、まるくつぶれないように)。
// 点を大きな四角でならべて描いた字 (ドット絵の字) の輪郭は、四角の大きさの階段をまっすぐな斜めにし、角は角のまま残す。
// block が 1 なら、どの輪郭もドット絵の形とみて描く (1点の階段だけをまっすぐな斜めにする)。
export function outline_path(m: Uint8Array, w: number, h: number, at: edges_t, path: Path2D, corner = 1, block = 0): void {
  const loops = contours(m, w, h)
  for (let l = 0; l < loops.length; l++) {
    const loop = loops[l]
    // まわりが 8 歩までの小さな穴 (字の中の1点のすきまなど) は、点のかどを結んだ、点の形のままの穴にする (曲線にすると、
    // ほとんど見えないほど小さくなるため)。
    if (corner > 0 && loop.length <= 16 && hole(loop)) exact(loop, path, at)
    else if (corner > 0) fit_curve(loop, path, at, corner, Math.max(block, block_step(loop)))
    else corners(loop, path, at)
  }
}

// 輪郭が穴 (反時計まわり) か。
function hole(loop: Int32Array): boolean {
  const n = loop.length / 2
  let area = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += loop[i * 2] * loop[j * 2 + 1] - loop[j * 2] * loop[i * 2 + 1]
  }
  return area < 0
}

// 輪郭を、点のかどを結んだ折れ線のまま path に足す。
function exact(loop: Int32Array, path: Path2D, at: edges_t): void {
  for (let i = 0; i < loop.length; i += 2) {
    const x = along(at.xs, loop[i])
    const y = along(at.ys, loop[i + 1])
    if (i) path.lineTo(x, y)
    else path.moveTo(x, y)
  }
  path.closePath()
}

// 輪郭の i 歩目 (n 歩でひとまわり。-1 は最後の歩み) の向き (0 右、1 下、2 左、3 上)。
function step_dir(loop: Int32Array, n: number, i: number): number {
  const a = (i % n + n) % n
  const b = (i + 1) % n
  const dx = loop[b * 2] - loop[a * 2]
  const dy = loop[b * 2 + 1] - loop[a * 2 + 1]
  return dx > 0 ? 0 : dy > 0 ? 1 : dx < 0 ? 2 : 3
}

// 輪郭がドット絵の形なら、その階段の1段の大きさ (点の数)。そうでなければ 0。
// 辺の長さがすべて同じ数 (2 以上) でわりきれるものは、その数を1段とする。ほかは、
// まっすぐな辺 (同じ向きに3歩以上) が輪郭の 85% 以上をしめるものをドット絵の形とみる。1段の大きさは、
// 左右に交互に曲がる「段」の辺の長さの、短い方から 1/4 の所 (2段ぶんの段もまざるため。段がなければ 1)。
function block_step(loop: Int32Array): number {
  const n = loop.length / 2
  // 向きがかわる所から数えはじめる。
  let start = 0
  while (start < n && step_dir(loop, n, start) === step_dir(loop, n, start + n - 1)) start++
  if (start === n) return 0
  const runs: number[] = []
  const dirs: number[] = []
  for (let i = start; i < start + n;) {
    let k = i + 1
    while (k < start + n && step_dir(loop, n, k) === step_dir(loop, n, i)) k++
    runs.push(k - i)
    dirs.push(step_dir(loop, n, i))
    i = k
  }
  const count = runs.length
  if (count < 4) return 0
  // 辺の長さがすべて 2 以上の同じ数でわりきれる輪郭は、その大きさの四角でならべた形 (2倍にしたドット絵の字など)。
  let block = 0
  for (let r = 0; r < count; r++) {
    let p = block
    let q = runs[r]
    while (q) {
      const t = p % q
      p = q
      q = t
    }
    block = p
  }
  if (block >= 2) return Math.min(6, block)
  let long = 0
  for (let r = 0; r < count; r++) if (runs[r] >= 3) long += runs[r]
  if (long < n * 0.85) return 0
  const steps: number[] = []
  for (let r = 0; r < count; r++) {
    const before = (dirs[r] - dirs[(r + count - 1) % count] + 4) % 4
    const after = (dirs[(r + 1) % count] - dirs[r] + 4) % 4
    if (before !== after && runs[r] < 12) steps.push(runs[r])
  }
  if (!steps.length) return 1
  const sorted = Int32Array.from(steps).sort()
  return Math.min(6, sorted[(sorted.length - 1) >> 2])
}

// 輪郭を、点のかどを通る閉じた折れ線としてたどる。斜めにふれあう点はつながった形にする。
// 外側の輪郭は時計まわり、穴は反時計まわりになるので、そのまま塗れば穴があく。
function contours(m: Uint8Array, w: number, h: number): Int32Array[] {
  const vw = w + 1
  const out = new Uint8Array(vw * (h + 1))
  let any = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue
      any = 1
      if (y === 0 || !m[(y - 1) * w + x]) out[y * vw + x] |= 1
      if (x === w - 1 || !m[y * w + x + 1]) out[y * vw + x + 1] |= 2
      if (y === h - 1 || !m[(y + 1) * w + x]) out[(y + 1) * vw + x + 1] |= 4
      if (x === 0 || !m[y * w + x - 1]) out[(y + 1) * vw + x] |= 8
    }
  }
  const loops: Int32Array[] = []
  if (!any) return loops
  const pts: number[] = []
  for (let start = 0; start < out.length; start++) {
    while (out[start]) {
      pts.length = 0
      let v = start
      let d = 31 - Math.clz32(out[start] & -out[start])
      for (;;) {
        out[v] &= ~(1 << d)
        pts.push(v % vw, Math.floor(v / vw))
        v += walk_x[d] + walk_y[d] * vw
        const bits = out[v]
        if (!bits) break
        // 1本なら進む。2本 (斜めにふれあう所) なら左へ曲がって、斜めの点をつなぐ。
        const left = (d + 3) & 3
        d = bits & (bits - 1) ? left : 31 - Math.clz32(bits)
        if (!(bits & (1 << d))) d = 31 - Math.clz32(bits & -bits)
      }
      if (pts.length >= 6) loops.push(Int32Array.from(pts))
    }
  }
  return loops
}

// 閉じた折れ線を、許すずれの中でできるだけ少ない点にまとめる (残す点の番号を返す)。
function simplify(xs: number[], ys: number[], eps: number): number[] {
  const n = xs.length
  const idx: number[] = []
  if (n <= 4) {
    for (let i = 0; i < n; i++) idx.push(i)
    return idx
  }
  let far = 0
  let best = -1
  for (let i = 1; i < n; i++) {
    const d = (xs[i] - xs[0]) ** 2 + (ys[i] - ys[0]) ** 2
    if (d > best) {
      best = d
      far = i
    }
  }
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[far] = 1
  // 調べる区間 (はじめ, おわり) のくり返し。うしろから取り出す。
  const stack: number[] = [0, far, far, n]
  while (stack.length) {
    const b = stack.pop()!
    const a = stack.pop()!
    if (b - a < 2) continue
    const ax = xs[a]
    const ay = ys[a]
    const bx = xs[b % n]
    const by = ys[b % n]
    const len = Math.hypot(bx - ax, by - ay) || 1
    let at = -1
    let max = eps
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - ys[i]) - (ax - xs[i]) * (by - ay)) / len
      if (d > max) {
        max = d
        at = i
      }
    }
    if (at < 0) continue
    keep[at] = 1
    stack.push(a, at, at, b)
  }
  for (let i = 0; i < n; i++) if (keep[i]) idx.push(i)
  return idx
}

// 輪郭を、ふちの中点 (点の階段は斜めの直線にならぶ) を結んだ折れ線にして path に足す (まっすぐにならぶ点だけをまとめる)。
function corners(loop: Int32Array, path: Path2D, at: edges_t): void {
  const count = loop.length / 2
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count
    xs.push((loop[i * 2] + loop[j * 2]) / 2)
    ys.push((loop[i * 2 + 1] + loop[j * 2 + 1]) / 2)
  }
  const idx = simplify(xs, ys, 0.05)
  if (idx.length < 3) return
  for (let k = 0; k < idx.length; k++) {
    const x = along(at.xs, xs[idx[k]])
    const y = along(at.ys, ys[idx[k]])
    if (k) path.lineTo(x, y)
    else path.moveTo(x, y)
  }
  path.closePath()
}

// ドット絵の輪郭の、本当の角。階段の角は、左右に交互に曲がる。同じ向きに続けて曲がる角 (線のはしなど) と、
// 前後の辺がどちらも段の 2 倍より長い角 (分かれ目など) を本当の角とする (となりの辺が 1 歩の所はのぞく)。
// 1点の段のドット絵 (block が 1) では、1歩ずつ左右に交互に曲がる所だけを階段とし、ほかはすべて角とする
// (太いドット絵の字の、1点のくぼみや2点の段が、斜めにけずられないように)。
function real_corners(loop: Int32Array, block: number): Uint8Array {
  const n = loop.length / 2
  const turns: number[] = []
  for (let i = 0; i < n; i++) if (step_dir(loop, n, i - 1) !== step_dir(loop, n, i)) turns.push(i)
  const keep = new Uint8Array(n)
  const count = turns.length
  if (count < 3) return keep
  const way = new Int32Array(count)
  for (let t = 0; t < count; t++) way[t] = (step_dir(loop, n, turns[t]) - step_dir(loop, n, turns[t] - 1) + 4) % 4
  for (let t = 0; t < count; t++) {
    const before = (turns[t] - turns[(t + count - 1) % count] + n) % n || n
    const after = (turns[(t + 1) % count] - turns[t] + n) % n || n
    const leg = Math.min(before, after)
    const same = way[t] === way[(t + count - 1) % count] || way[t] === way[(t + 1) % count]
    if (block === 1 ? same || leg >= 2 : same && leg >= 2 || leg > block * 2) keep[turns[t]] = 1
  }
  return keep
}

// i から j まで (両はしをふくむ) の点の [数, x の和, y の和, x² の和, xy の和, y² の和] を out に入れる。
// j が n なら 0 番の点 (原点) で終わる。
function range_sums(f: fit_sums_t, i: number, j: number, out: Float64Array): void {
  const e = j % f.n
  out[0] = j - i + 1
  out[1] = f.sx[j] - f.sx[i] + f.px[e]
  out[2] = f.sy[j] - f.sy[i] + f.py[e]
  out[3] = f.sxx[j] - f.sxx[i] + f.px[e] * f.px[e]
  out[4] = f.sxy[j] - f.sxy[i] + f.px[e] * f.py[e]
  out[5] = f.syy[j] - f.syy[i] + f.py[e] * f.py[e]
}

// i から j への辺の、間の点の離れ具合の二乗平均の平方根 (tmp は range_sums の入れ物)。
function penalty(f: fit_sums_t, i: number, j: number, tmp: Float64Array): number {
  range_sums(f, i, j, tmp)
  const k = tmp[0]
  const x = tmp[1]
  const y = tmp[2]
  const xx = tmp[3]
  const xy = tmp[4]
  const yy = tmp[5]
  const e = j % f.n
  const ex = f.py[i] - f.py[e]
  const ey = f.px[e] - f.px[i]
  const ae = ex * f.px[i] + ey * f.py[i]
  const s = ex * ex * xx + 2 * ex * ey * xy + ey * ey * yy - 2 * ae * (ex * x + ey * y) + k * ae * ae
  return Math.sqrt(Math.max(0, s) / k)
}

// 2本の直線からの距離の二乗の和 q0 x² + 2 q1 xy + q2 y² + 2 q3 x + 2 q4 y + q5。
function quad_cost(q: Float64Array, x: number, y: number): number {
  return q[0] * x * x + 2 * q[1] * x * y + q[2] * y * y + 2 * q[3] * x + 2 * q[4] * y + q[5]
}

// v を、c から half 以内におさめる。
function clamp_near(v: number, c: number, half: number): number {
  return Math.max(c - half, Math.min(c + half, v))
}

// 輪郭の折れ線を、多角形に合わせてから曲線にして path に足す (Selinger「Potrace」の考え方)。
// 1. 輪郭の点ごとに、そこからまっすぐとみなせる (間の点のどれからも1点以内を通る) 所までを求める。
// 2. まっすぐな辺だけでできた多角形のうち、辺がいちばん少なく、元の輪郭とのずれがいちばん小さいものを選ぶ。
// 3. 多角形の角を、となりの2辺にそった輪郭の点に最もよく合う所へ動かす (元の角から半点以内)。
// 4. 角ごとにとがり具合を見て、とがった所 (corner をこえる所) は角のまま、ほかは辺の中点どうしをなめらかな曲線でつなぐ。
// block が 1 以上ならドット絵の形として、1 の所を block の半分 (1 以上) にゆるめて block の大きさの階段もまっすぐにし、
// 60° 以上曲がる角は、となりの辺が block の 6 割以上あれば角のまま残す。
// 点の階段がまっすぐな辺や同じ曲がり具合の曲線になるので、手書きの線のふちのがたつきや、点の角が残りにくい。
function fit_curve(loop: Int32Array, path: Path2D, at: edges_t, corner: number, block: number): void {
  const n = loop.length / 2
  const t = Math.max(1, block / 2)
  const half = t / 2
  const px = new Float64Array(n)
  const py = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    px[i] = loop[i * 2] - loop[0]
    py[i] = loop[i * 2 + 1] - loop[1]
  }
  // 1. reach[i]: i からまっすぐな辺を引ける、いちばん先の点 (番号は n をこえて数える)。
  // i から見て、間の点のまわり (±1) をすべて通る向きの範囲 (lo から hi) をせばめていき、つぎの点がその外に出たら止める。
  // 4つの向きの歩みがすべて出てくる所 (折り返し) でも止める。
  const reach = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    let lox = 0
    let loy = 0
    let hix = 0
    let hiy = 0
    let dirs = 0
    let k = i + 1
    for (; k < i + n; k++) {
      const a = (k - 1) % n
      const b = k % n
      const sx = px[b] - px[a]
      const sy = py[b] - py[a]
      dirs |= sx > 0 ? 1 : sx < 0 ? 2 : sy > 0 ? 4 : 8
      if (dirs === 15) break
      const cx = px[b] - px[i]
      const cy = py[b] - py[i]
      if (lox * cy - loy * cx < 0 || hix * cy - hiy * cx > 0) break
      if (Math.abs(cx) <= t && Math.abs(cy) <= t) continue
      let ox = cx + (cy >= 0 && (cy > 0 || cx < 0) ? t : -t)
      let oy = cy + (cx <= 0 && (cx < 0 || cy < 0) ? t : -t)
      if (lox * oy - loy * ox >= 0) {
        lox = ox
        loy = oy
      }
      ox = cx + (cy <= 0 && (cy < 0 || cx < 0) ? t : -t)
      oy = cy + (cx >= 0 && (cx > 0 || cy < 0) ? t : -t)
      if (hix * oy - hiy * ox <= 0) {
        hix = ox
        hiy = oy
      }
    }
    reach[i] = k - 1
  }
  // 先の点ほど遠くまで届くようにそろえ (うしろから小さい方をうつす)、辺は1つ前の点から届く所の1つ手前までにする
  // (角をわずかに切りおとす辺を選ばないように)。
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) reach[i] = Math.min(reach[i], i === n - 1 ? reach[0] + n : reach[i + 1])
  }
  const clip = new Int32Array(n)
  for (let i = 0; i < n; i++) clip[i] = Math.min(n, Math.max(i + 1, (i ? reach[i - 1] : reach[n - 1] - n) - 1))
  // ドット絵の形では、本当の角 (線のはしや分かれ目の角) をとびこえる辺は引かない (ゆるめた分だけ角を切りおとさないように)。
  if (block) {
    const keep = real_corners(loop, block)
    for (let i = n - 1, next = n; i >= 0; i--) {
      clip[i] = Math.min(clip[i], next)
      if (keep[i]) next = i
    }
  }
  // 2. 0 番から n 番 (= 0 番) までの、辺の数がいちばん少なく、ずれ (辺の長さ × 点の離れ具合の二乗平均) が小さい多角形。
  const f: fit_sums_t = { n, px, py, sx: new Float64Array(n + 1), sy: new Float64Array(n + 1), sxx: new Float64Array(n + 1), sxy: new Float64Array(n + 1), syy: new Float64Array(n + 1) }
  for (let i = 0; i < n; i++) {
    f.sx[i + 1] = f.sx[i] + px[i]
    f.sy[i + 1] = f.sy[i] + py[i]
    f.sxx[i + 1] = f.sxx[i] + px[i] * px[i]
    f.sxy[i + 1] = f.sxy[i] + px[i] * py[i]
    f.syy[i + 1] = f.syy[i] + py[i] * py[i]
  }
  const tmp = new Float64Array(6)
  const len = new Int32Array(n + 1).fill(1 << 30)
  const pen = new Float64Array(n + 1)
  const prev = new Int32Array(n + 1)
  len[0] = 0
  for (let j = 1, lo = 0; j <= n; j++) {
    while (clip[lo] < j) lo++
    for (let i = j - 1; i >= lo; i--) {
      const l = len[i] + 1
      if (l > len[j]) continue
      const p = pen[i] + penalty(f, i, j, tmp)
      if (l < len[j] || p < pen[j]) {
        len[j] = l
        pen[j] = p
        prev[j] = i
      }
    }
  }
  const corner_at: number[] = []
  for (let j = n; j > 0;) {
    j = prev[j]
    corner_at.push(j)
  }
  corner_at.reverse()
  const m = corner_at.length
  if (m < 3) {
    corners(loop, path, at)
    return
  }
  // 3. 辺ごとに、その辺にそった輪郭の点にいちばん合う直線 (a x + b y + c = 0) を求め、角を2本の直線にいちばん近い所へ動かす。
  const lines = new Float64Array(m * 3)
  for (let s = 0; s < m; s++) {
    range_sums(f, corner_at[s], s + 1 < m ? corner_at[s + 1] : n, tmp)
    const k = tmp[0]
    const cx = tmp[1] / k
    const cy = tmp[2] / k
    const a = tmp[3] / k - cx * cx
    const b = tmp[4] / k - cx * cy
    const c = tmp[5] / k - cy * cy
    const top = (a + c) / 2 + Math.sqrt(((a - c) / 2) ** 2 + b * b)
    let dx = b
    let dy = top - a
    if (Math.hypot(dx, dy) < Math.hypot(top - c, b)) {
      dx = top - c
      dy = b
    }
    let dl = Math.hypot(dx, dy)
    if (dl < 1e-9) {
      const e = s + 1 < m ? corner_at[s + 1] : 0
      dx = px[e] - px[corner_at[s]]
      dy = py[e] - py[corner_at[s]]
      dl = Math.hypot(dx, dy) || 1
    }
    const nx = -dy / dl
    const ny = dx / dl
    lines[s * 3] = nx
    lines[s * 3 + 1] = ny
    lines[s * 3 + 2] = -(nx * cx + ny * cy)
  }
  const wx = new Float64Array(m)
  const wy = new Float64Array(m)
  const q = new Float64Array(6)
  const tx = new Float64Array(2)
  const ty = new Float64Array(2)
  for (let s = 0; s < m; s++) {
    // 2本の直線 (前の辺と、この辺) からの距離の二乗の和を、元の角から半点以内で最小にする。
    q.fill(0)
    for (let e = 0; e < 2; e++) {
      const o = (e === 0 ? (s + m - 1) % m : s) * 3
      const a = lines[o]
      const b = lines[o + 1]
      const c = lines[o + 2]
      q[0] += a * a
      q[1] += a * b
      q[2] += b * b
      q[3] += a * c
      q[4] += b * c
      q[5] += c * c
    }
    const vx = px[corner_at[s]]
    const vy = py[corner_at[s]]
    const det = q[0] * q[2] - q[1] * q[1]
    let bx = vx
    let by = vy
    let best = Infinity
    if (Math.abs(det) > 1e-9) {
      const x = (q[1] * q[4] - q[2] * q[3]) / det
      const y = (q[1] * q[3] - q[0] * q[4]) / det
      if (Math.abs(x - vx) <= half && Math.abs(y - vy) <= half) {
        best = 0
        bx = x
        by = y
      }
    }
    if (best) {
      // 半点の四角のふち (左右と上下の4本) の上で、いちばん近い所をさがす。
      for (let e = 0; e < 2; e++) {
        const off = e === 0 ? -half : half
        tx[0] = vx + off
        ty[0] = clamp_near(q[2] > 1e-12 ? -(q[1] * tx[0] + q[4]) / q[2] : vy, vy, half)
        ty[1] = vy + off
        tx[1] = clamp_near(q[0] > 1e-12 ? -(q[1] * ty[1] + q[3]) / q[0] : vx, vx, half)
        for (let g = 0; g < 2; g++) {
          const v = quad_cost(q, tx[g], ty[g])
          if (v < best) {
            best = v
            bx = tx[g]
            by = ty[g]
          }
        }
      }
    }
    wx[s] = bx + loop[0]
    wy[s] = by + loop[1]
  }
  // 4. 角のとがり具合 (となりの角を結ぶ線からの離れ具合) で、角にするか曲線にするかを決める。
  path.moveTo(along(at.xs, (wx[m - 1] + wx[0]) / 2), along(at.ys, (wy[m - 1] + wy[0]) / 2))
  for (let j = 0; j < m; j++) {
    const i = (j + m - 1) % m
    const k = (j + 1) % m
    const denom = Math.abs(wx[k] - wx[i]) + Math.abs(wy[k] - wy[i])
    let alpha = 4 / 3
    if (denom > 1e-9) {
      const dd = Math.abs((wx[j] - wx[i]) * (wy[k] - wy[i]) - (wy[j] - wy[i]) * (wx[k] - wx[i])) / denom
      alpha = dd > 1 ? (1 - 1 / dd) / 0.75 : 0
    }
    const ex = along(at.xs, (wx[j] + wx[k]) / 2)
    const ey = along(at.ys, (wy[j] + wy[k]) / 2)
    if (block) {
      const ux = wx[j] - wx[i]
      const uy = wy[j] - wy[i]
      const vx = wx[k] - wx[j]
      const vy = wy[k] - wy[j]
      const lu = Math.hypot(ux, uy)
      const lv = Math.hypot(vx, vy)
      alpha = Math.min(lu, lv) >= block * 0.6 && ux * vx + uy * vy < 0.5 * lu * lv ? corner : 0
    }
    if (alpha >= corner) {
      path.lineTo(along(at.xs, wx[j]), along(at.ys, wy[j]))
      path.lineTo(ex, ey)
      continue
    }
    const r = 0.5 + 0.5 * Math.max(0.55, Math.min(1, alpha))
    const ax = along(at.xs, wx[i] + r * (wx[j] - wx[i]))
    const ay = along(at.ys, wy[i] + r * (wy[j] - wy[i]))
    const bx = along(at.xs, wx[k] + r * (wx[j] - wx[k]))
    const by = along(at.ys, wy[k] + r * (wy[j] - wy[k]))
    path.bezierCurveTo(ax, ay, bx, by, ex, ey)
  }
  path.closePath()
}
