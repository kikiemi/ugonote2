// うごくメモ帳3D (Ver.1.3.2) の描画処理を移植したもの。
// ペン先・消しゴム・ペイントの表、線の補間、各ペンの処理は実機の code.bin と同じ値と手順にしている。
import { paint_bit, type paint_pattern_t } from './paint'

export const nd_pen = 0
export const nd_eraser = 1
export const nd_paint = 2

type tip_t = { n: number, b: Uint8Array }

function tip(rows: string[]): tip_t {
  const n = rows.length
  const b = new Uint8Array(n * n)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) b[y * n + x] = rows[y][x] === '#' ? 1 : 0
  return { n, b }
}

function fill_tip(n: number): tip_t {
  return { n, b: new Uint8Array(n * n).fill(1) }
}

function line_tip(n: number, vertical: number): tip_t {
  const b = new Uint8Array(n * n)
  const c = n >> 1
  for (let i = 0; i < n; i++) b[vertical ? i * n + c : c * n + i] = 1
  return { n, b }
}

const round5 = tip(['.###.', '#####', '#####', '#####', '.###.'])
const round7 = tip(['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'])
const round8 = tip(['..####..', '.######.', '########', '########', '########', '########', '.######.', '..####..'])
const round9 = tip(['...###...', '.#######.', '.#######.', '#########', '#########', '#########', '.#######.', '.#######.', '...###...'])
const round15 = tip([
  '....#######....', '..###########..', '.#############.', '.#############.', '###############', '###############', '###############', '###############',
  '###############', '###############', '###############', '.#############.', '.#############.', '..###########..', '....#######....',
])
const round16 = tip([
  '.....######.....', '...##########...', '..############..', '.##############.', '.##############.', '################', '################', '################',
  '################', '################', '################', '.##############.', '.##############.', '..############..', '...##########...', '.....######.....',
])
const diamond5 = tip(['..#..', '.###.', '#####', '.###.', '..#..'])
const octagon15 = tip([
  '......###......', '.....#####.....', '...#########...', '..###########..', '.#############.', '###############', '###############', '###############',
  '###############', '###############', '.#############.', '..###########..', '...#########...', '.....#####.....', '......###......',
])

// 実機のペン番号 0..16 (8, 17 は文字)。0,1,2,9,10,11 はペン先をそのまま並べる。
const pen_tips: (tip_t | null)[] = [fill_tip(1), fill_tip(2), fill_tip(3), null, null, null, null, null, null, round5, round9, round15]
const eraser_tips: tip_t[] = [fill_tip(1), fill_tip(3), round8, round16, fill_tip(9), fill_tip(13), line_tip(15, 1), line_tip(15, 0)]
const paint_tips: tip_t[] = [round5, round9, round15]

export function nd_eraser_tip(id: number): { n: number, b: Uint8Array } {
  return eraser_tips[id & 7]
}

export function nd_paint_tip(id: number): { n: number, b: Uint8Array } | null {
  return paint_tips[id] || null
}

export function nd_ink(hex: string): number {
  const v = Number.parseInt(hex.slice(1, 7), 16)
  return ((255 << 24) | ((v & 255) << 16) | (v & 0xff00) | ((v >>> 16) & 255)) >>> 0
}

// others は普通ふでばこで同時に消すほかのレイヤー。実機は描いた点・消した点をほかのレイヤーからも消す。
// mask はペンでもようを描くとき (ugonote2 の追加機能) のもよう。点のないところは描かず、うわがきなら消す。
export type nd_surface_t = {
  w: number
  h: number
  px: Uint32Array
  others: Uint32Array[]
  ink: number
  tile: paint_pattern_t
  mask: paint_pattern_t | null
  over: number
  x0: number
  y0: number
  x1: number
  y1: number
}

export type nd_state_t = {
  kind: number
  tip: number
  s: nd_surface_t
  ax: number
  ay: number
  b0x: number
  b0y: number
  b1x: number
  b1y: number
  b2x: number
  b2y: number
  bw: number
  bf: number
  ox: number
  oy: number
}

export function nd_surface(w: number, h: number, px: Uint32Array, ink: number, tile: paint_pattern_t, over: number, others: Uint32Array[] = []): nd_surface_t {
  return { w, h, px, others, ink, tile, mask: null, over, x0: w, y0: h, x1: -1, y1: -1 }
}

export function nd_state(kind: number, tip: number, s: nd_surface_t): nd_state_t {
  return { kind, tip, s, ax: 0, ay: 0, b0x: 0, b0y: 0, b1x: 0, b1y: 0, b2x: 0, b2y: 0, bw: 2, bf: 0, ox: 0, oy: 0 }
}

export function nd_pen_index(native_tip: number): number {
  const k = native_tip & 7
  return native_tip >= 8 ? k + 9 : k
}

// 実機の乱数。55個の値の表を、31個先の値と足し合わせながら進める (code.bin の rand / srand と同じ)。
// 実機は起動時に本体の時計 (GetSystemTick) の値で初期化し、あとは描くたびに進めるだけで初期化し直さない。
const rand_tab = new Int32Array(55)
let rand_f = 31
let rand_r = 0

export function nd_seed(v: number): void {
  let x = v >>> 0
  for (let i = 54; i >= 0; i--) {
    rand_tab[i] = x + (x >>> 16)
    x = (Math.imul(x, 0x10dcd) + 0x66d619e1) >>> 0
  }
  rand_f = 31
  rand_r = 0
}

nd_seed((Date.now() * 1000 + Math.floor(performance.now() * 1000)) >>> 0)

export type nd_rand_t = { tab: Int32Array, f: number, r: number }

// 見本や図形の描き直しで乱数を進めないように、状態を取っておいて戻す。
export function nd_rand_save(): nd_rand_t {
  return { tab: rand_tab.slice(), f: rand_f, r: rand_r }
}

export function nd_rand_load(v: nd_rand_t): void {
  rand_tab.set(v.tab)
  rand_f = v.f
  rand_r = v.r
}

function rand(): number {
  const v = (rand_tab[rand_r] + rand_tab[rand_f]) | 0
  rand_tab[rand_r] = v
  if (++rand_f === 55) rand_f = 0
  if (++rand_r === 55) rand_r = 0
  return v & 0x7fffffff
}

function mark(s: nd_surface_t, x: number, y: number): void {
  if (x < s.x0) s.x0 = x
  if (y < s.y0) s.y0 = y
  if (x > s.x1) s.x1 = x
  if (y > s.y1) s.y1 = y
}

export function nd_plot(s: nd_surface_t, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return
  if (s.mask && !paint_bit(s.mask, x, y)) {
    if (s.over) erase(s, x, y)
    return
  }
  const i = y * s.w + x
  s.px[i] = s.ink
  for (const o of s.others) o[i] = 0
  mark(s, x, y)
}

export function nd_erase(s: nd_surface_t, x: number, y: number): void {
  erase(s, x, y)
}

function erase(s: nd_surface_t, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return
  const i = y * s.w + x
  s.px[i] = 0
  for (const o of s.others) o[i] = 0
  mark(s, x, y)
}

export function nd_paint_px(s: nd_surface_t, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return
  if (paint_bit(s.tile, x, y)) nd_plot(s, x, y)
  else if (s.over) erase(s, x, y)
}

// 実機の直線補間。始点は打たず (始点と終点が同じときだけ終点を打つ)、誤差項は -短辺 から始まる。
function bres(ax: number, ay: number, bx: number, by: number, fn: (x: number, y: number) => void): void {
  if (ax === bx && ay === by) {
    fn(bx, by)
    return
  }
  const dx = bx - ax
  const dy = by - ay
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  const sx = dx >= 0 ? 1 : -1
  const sy = dy >= 0 ? 1 : -1
  let x = ax
  let y = ay
  if (adx >= ady) {
    let err = -ady
    while (x !== bx) {
      x += sx
      err += ady * 2
      if (err > 0) {
        y += sy
        err -= adx * 2
      }
      fn(x, y)
    }
  } else {
    let err = -adx
    while (y !== by) {
      y += sy
      err += adx * 2
      if (err > 0) {
        x += sx
        err -= ady * 2
      }
      fn(x, y)
    }
  }
}

function stamp(t: tip_t, x: number, y: number, fn: (x: number, y: number) => void): void {
  const h = t.n >> 1
  for (let r = 0; r < t.n; r++) for (let c = 0; c < t.n; c++) if (t.b[r * t.n + c]) fn(x + c - h, y + r - h)
}

function line_sq(s: nd_surface_t, ax: number, ay: number, bx: number, by: number, w: number): void {
  const lo = w & 1 ? -((w - 1) / 2 | 0) : 1 - (w / 2 | 0)
  const hi = w & 1 ? (w - 1) / 2 | 0 : w / 2 | 0
  bres(ax, ay, bx, by, (x, y) => {
    for (let oy = lo; oy <= hi; oy++) for (let ox = lo; ox <= hi; ox++) nd_plot(s, x + ox, y + oy)
  })
}

function plot2(s: nd_surface_t, x: number, y: number): void {
  nd_plot(s, x, y)
  nd_plot(s, x + 1, y)
  nd_plot(s, x, y + 1)
  nd_plot(s, x + 1, y + 1)
}

const half = (v: number) => v / 2 | 0

// ふで (小): 2px 四方を偶数座標で動かし、1つ前と2つ前の点との中点も埋める。
function brush_small(st: nd_state_t, bx: number, by: number): void {
  const s = st.s
  let x = st.b0x & ~1
  let y = st.b0y & ~1
  let dx = bx - x
  let dy = by - y
  if (dx & 1) dx += dx < 0 ? 1 : -1
  if (dy & 1) dy += dy < 0 ? 1 : -1
  const tx = x + dx
  const ty = y + dy
  if (x === tx && y === ty) {
    plot2(s, tx, ty)
    return
  }
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  let err = 0
  for (;;) {
    if (x === tx && y === ty) {
      st.b0x = tx
      st.b0y = ty
      return
    }
    if (adx > ady) {
      err += ady
      if (adx <= err) {
        y += dy < 0 ? -2 : 2
        err -= adx
      }
      if (x !== tx) x += dx < 0 ? -2 : 2
    } else {
      err += adx
      if (ady <= err) {
        x += dx < 0 ? -2 : 2
        err -= ady
      }
      if (y !== ty) y += dy < 0 ? -2 : 2
    }
    plot2(s, x, y)
    plot2(s, half(st.b2x + x), half(st.b2y + y))
    st.b2x = st.b1x
    st.b2y = st.b1y
    plot2(s, half(x + st.b1x), half(y + st.b1y))
    st.b1x = x
    st.b1y = y
  }
}

// ふで (大): 止めると1フレームごとに太くなり、動かすと距離の2乗に比例して細くなる (0.4〜7px)。
function brush_large(st: nd_state_t, ax: number, ay: number, bx: number, by: number): void {
  const d2 = Math.trunc(Math.fround((bx - ax) * (bx - ax) + (by - ay) * (by - ay)))
  let w = d2 < 1 ? Math.fround(st.bw + 1) : Math.fround(st.bw - Math.fround(d2 * Math.fround(0.02)))
  if (w > 7) w = 7
  if (w <= Math.fround(0.4)) w = Math.fround(0.4)
  st.bw = w
  const acc = Math.fround(w + st.bf)
  const iw = Math.trunc(acc)
  st.bf = Math.fround(acc - iw)
  line_sq(st.s, ax, ay, bx, by, iw)
}

// ふちペン (小): 進む方向の両わきに点を打ち、中心は透明にする。
function outline_small(s: nd_surface_t, ax: number, ay: number, bx: number, by: number): void {
  let x = ax
  let y = ay
  const dx = bx - ax
  const dy = by - ay
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  let err = 0
  let dir = 0
  const draw = () => {
    if ((dir & 2) === 0) {
      nd_plot(s, x + 1, y)
      nd_plot(s, x - 1, y)
    } else {
      nd_plot(s, x, y - 1)
      nd_plot(s, x, y + 1)
    }
    erase(s, x, y)
    switch (dir & 3) {
      case 0: nd_plot(s, x, y - 1); break
      case 1: nd_plot(s, x, y + 1); break
      case 2: nd_plot(s, x - 1, y); break
      default: nd_plot(s, x + 1, y)
    }
  }
  while (x !== bx || y !== by) {
    if (adx > ady) {
      err += ady
      if (err >= adx) {
        err -= adx
        if (dy < 0) {
          y--
          dir = 0
        } else {
          y++
          dir = 1
        }
      }
      if (x !== bx) {
        if (dx < 0) {
          x--
          dir = 2
        } else {
          x++
          dir = 3
        }
      }
    } else {
      err += adx
      if (err >= ady) {
        err -= ady
        if (dx < 0) {
          x--
          dir = 6
        } else {
          x++
          dir = 7
        }
      }
      if (y !== by) {
        if (dy < 0) {
          y--
          dir = 4
        } else {
          y++
          dir = 5
        }
      }
    }
    draw()
  }
  draw()
}

// ふちペン (大): 今の点に7pxの丸を打ち、1つ前の点のひし形5pxを透明にする。
function outline_large(st: nd_state_t, ax: number, ay: number, bx: number, by: number): void {
  const s = st.s
  bres(ax, ay, bx, by, (x, y) => {
    stamp(round7, x, y, (px, py) => nd_plot(s, px, py))
    stamp(diamond5, st.ox, st.oy, (px, py) => erase(s, px, py))
    st.ox = x
    st.oy = y
  })
}

// てんてん: ペン先の範囲に、線の長さに応じた確率 (約1/64) で点を置く。止めていても増える。
function dots(s: nd_surface_t, ax: number, ay: number, bx: number, by: number, large: number): void {
  const t = large ? octagon15 : diamond5
  const off = t.n >> 1
  const k = Math.trunc(Math.abs(bx - ax) + Math.abs(by - ay) + 1)
  const m = k << 6
  bres(ax, ay, bx, by, (x, y) => {
    let i = 0
    for (let r = 0; r < t.n; r++) {
      for (let c = 0; c < t.n; c++, i++) if (rand() % m <= k && t.b[i]) nd_plot(s, x - off + c, y - off + r)
    }
  })
}

// 小: ±2px、大: -4〜+5px だけ両端をずらした1pxの線を引く。
function noise(s: nd_surface_t, ax: number, ay: number, bx: number, by: number, n: number): void {
  const h = (n - 1) / 2 | 0
  const jx = rand() % n - h
  const jy = rand() % n - h
  const kx = rand() % n - h
  const ky = rand() % n - h
  line_sq(s, ax + jx, ay + jy, bx + kx, by + ky, 1)
}

function perp(vx: number, vy: number, dx: number, dy: number): [number, number] {
  const n = Math.trunc(Math.fround(dx * dx + dy * dy))
  if (!n) return [vx, vy]
  const dot = Math.trunc(Math.fround(vx * dx + vy * dy))
  return [Math.fround(vx - Math.fround(Math.fround(dx * dot) / n)), Math.fround(vy - Math.fround(Math.fround(dy * dot) / n))]
}

// スプレー: 速さで半径と本数が変わる短い線を、進む向きと垂直に散らす。止めると丸く広がる。
function spray(s: nd_surface_t, ax: number, ay: number, bx: number, by: number, large: number): void {
  const dx = bx - ax
  const dy = by - ay
  const d2 = Math.trunc(Math.fround(dx * dx + dy * dy))
  const k = d2 < 4 ? 6 : d2 < 8 ? 5 : d2 < 12 ? 4 : d2 < 24 ? 3 : d2 < 48 ? 2 : 1
  let r2 = k * k
  let count = 16 - k
  if (large) {
    count *= 4
    r2 *= 2
  }
  for (let i = 0; i < count; i++) {
    let ox = Math.trunc(Math.sqrt(rand() % (r2 + 1)))
    let oy = Math.trunc(Math.sqrt(rand() % (r2 + 1)))
    if (ox > 0) ox--
    if (oy > 0) oy--
    if (rand() & 1) ox = -ox
    if (rand() & 1) oy = -oy
    const jx = rand() % 3 - 1
    const jy = rand() % 3 - 1
    const v = perp(ox, oy, dx, dy)
    const j = perp(jx, jy, dx, dy)
    const f = Math.fround
    line_sq(s, Math.trunc(f(ax + v[0])), Math.trunc(f(ay + v[1])), Math.trunc(f(bx + f(v[0] + j[0]))), Math.trunc(f(by + f(v[1] + j[1]))), 1)
  }
}

function pen_segment(st: nd_state_t, ax: number, ay: number, bx: number, by: number): void {
  const s = st.s
  const t = pen_tips[st.tip]
  if (t) {
    bres(ax, ay, bx, by, (x, y) => stamp(t, x, y, (px, py) => nd_plot(s, px, py)))
    return
  }
  switch (st.tip) {
    case 3: brush_small(st, bx, by); break
    case 4: outline_small(s, ax, ay, bx, by); break
    case 5: dots(s, ax, ay, bx, by, 0); break
    case 6: noise(s, ax, ay, bx, by, 5); break
    case 7: spray(s, ax, ay, bx, by, 0); break
    case 12: brush_large(st, ax, ay, bx, by); break
    case 13: outline_large(st, ax, ay, bx, by); break
    case 14: dots(s, ax, ay, bx, by, 1); break
    case 15: noise(s, ax, ay, bx, by, 10); break
    case 16: spray(s, ax, ay, bx, by, 1); break
  }
}

function eraser_segment(st: nd_state_t, ax: number, ay: number, bx: number, by: number): void {
  const s = st.s
  const t = eraser_tips[st.tip & 7]
  const pattern = st.tip >= 8
  bres(ax, ay, bx, by, (x, y) => stamp(t, x, y, (px, py) => {
    if (!pattern || (px >= 0 && py >= 0 && px < s.w && py < s.h && paint_bit(s.tile, px, py))) erase(s, px, py)
  }))
}

function paint_segment(st: nd_state_t, ax: number, ay: number, bx: number, by: number): void {
  const s = st.s
  const t = paint_tips[st.tip] || paint_tips[0]
  bres(ax, ay, bx, by, (x, y) => stamp(t, x, y, (px, py) => nd_paint_px(s, px, py)))
}

function segment(st: nd_state_t, ax: number, ay: number, bx: number, by: number): void {
  if (st.kind === nd_pen) pen_segment(st, ax, ay, bx, by)
  else if (st.kind === nd_eraser) eraser_segment(st, ax, ay, bx, by)
  else paint_segment(st, ax, ay, bx, by)
}

// ペンを置いた瞬間の呼び出し。実機はここで ふで の位置と太さ、ふちペン(大) の輪を初期化する。
export function nd_begin(st: nd_state_t, x: number, y: number): void {
  st.ax = x
  st.ay = y
  if (st.kind === nd_paint) {
    paint_segment(st, x, y, x, y)
    return
  }
  if (st.kind !== nd_pen) return
  if (st.tip === 3) {
    st.b0x = x
    st.b0y = y
    st.b1x = st.b2x = x & ~1
    st.b1y = st.b2y = y & ~1
  } else if (st.tip === 12) {
    st.bw = 2
    st.bf = 0
  } else if (st.tip === 13) {
    st.ox = x
    st.oy = y
    outline_large(st, x, y, x, y)
  }
}

// 1フレーム分の入力。前のフレームの点から今の点までを処理する。
export function nd_step(st: nd_state_t, x: number, y: number): void {
  segment(st, st.ax, st.ay, x, y)
  st.ax = x
  st.ay = y
}

// 図形で1点だけを打つときの呼び出し (前の点を動かさずにその点で処理する)。
export function nd_point(st: nd_state_t, x: number, y: number): void {
  st.ax = x
  st.ay = y
  segment(st, x, y, x, y)
}

export const nd_line = 0
export const nd_rect = 1
export const nd_oval = 2

// Lボタン (ここではShift) を押したときの形。直線は水平・垂直・45度、四角は短い辺にそろえた正方形。
export function nd_constrain(kind: number, ax: number, ay: number, bx: number, by: number, held: number): [number, number] {
  const dx = bx - ax
  const dy = by - ay
  if (!held || kind === nd_oval) return dx * dx + dy * dy < 0.5 ? [ax, ay] : [bx, by]
  const dx2 = dx * dx
  const dy2 = dy * dy
  const sx = dx > 0 ? 1 : -1
  const sy = dy > 0 ? 1 : -1
  const limit = Math.fround(0.33)
  if (kind === nd_line) {
    if (dx2 > dy2) {
      if (Math.fround(dy2 / dx2) < limit) return [bx, ay]
      const d = Math.abs(dy)
      return [ax + sx * d, ay + sy * d]
    }
    if (limit > Math.fround(dx2 / dy2)) return [ax, by]
    const d = Math.abs(dx)
    return [ax + sx * d, ay + sy * d]
  }
  const d = dx2 > dy2 ? Math.abs(dy) : Math.abs(dx)
  return [ax + sx * d, ay + sy * d]
}

// 四角は左下→左上→右上→右下→左下の順に4辺をたどる。
function rect_points(ax: number, ay: number, bx: number, by: number): [number, number][] {
  const out: [number, number][] = []
  if (ax === bx && ay === by) return [[bx, by]]
  const push = (x: number, y: number) => { out.push([x, y]) }
  bres(ax, by, ax, ay, push)
  bres(ax, ay, bx, ay, push)
  bres(bx, ay, bx, by, push)
  bres(bx, by, ax, by, push)
  return out
}

// だ円はタッチした点を中心に、半径をずらした量にする。上下側の1/4と左右側の1/4を別々に求め、4点ずつ返す。
// restart は左右側に切りかわった最初の4点の位置。
function oval_points(cx: number, cy: number, bx: number, by: number): { pts: [number, number][], restart: number } {
  const a = Math.abs(bx - cx)
  const b = Math.abs(by - cy)
  const pts: [number, number][] = []
  let restart = -1
  if (!a || !b) return { pts, restart }
  const a2 = 2 * a * a
  const b2 = 2 * b * b
  let err = a * a * b
  let x = 0
  let y = b
  let ty = a2 * b
  let tx = 0
  let state = 1
  while (state < 4) {
    if (state === 2) restart = pts.length
    pts.push([cx + x, cy + y], [cx - x, cy + y], [cx - x, cy - y], [cx + x, cy - y])
    if (state === 1) {
      err -= b2 * x
      x++
      tx += b2
      if (err <= 0) {
        y--
        err += a2 * y
        ty -= a2
      }
      if (tx > ty) {
        err = b * b * a
        x = a
        y = 0
        tx = b2 * a
        ty = 0
        state = 2
      }
    } else {
      state = 3
      err -= a2 * y
      y++
      ty += a2
      if (err < 0) {
        x--
        err += b2 * x
        tx -= b2
      }
      if (tx < ty) state = 4
    }
  }
  return { pts, restart }
}

// 正円 (Lボタン)。半径は縦横のずれの大きいほう。
function circle_points(cx: number, cy: number, bx: number, by: number): [number, number][] {
  const r = Math.max(Math.abs(cx - bx), Math.abs(cy - by))
  const out: [number, number][] = []
  if (r < 1) return out
  let x = 0
  let y = r
  let d = 2 - 2 * r
  out.push([cx, cy + r], [cx, cy + r], [cx, cy - r], [cx, cy - r])
  for (;;) {
    if (d > -y) {
      y--
      d += 1 - 2 * y
    }
    if (d <= x) {
      x++
      d += 1 + 2 * x
    }
    if (y === 0) {
      out.push([cx + r, cy], [cx - r, cy], [cx - r, cy], [cx + r, cy])
      return out
    }
    out.push([cx + x, cy + y], [cx - x, cy + y], [cx - x, cy - y], [cx + x, cy - y])
  }
}

// ふで (大) の直線と四角: 1pxずつ進みながら、太さを7pxから1pxへ細くしていく。
function taper(st: nd_state_t, ax: number, ay: number, bx: number, by: number): void {
  const f = Math.fround
  const dx = f(bx - ax)
  const dy = f(by - ay)
  const dist = f(Math.sqrt(f(f(dx * dx) + f(dy * dy))))
  st.bf = 0
  if (!(dist > 0)) return
  const inv = f(1 / dist)
  const ux = f(dx * inv)
  const uy = f(dy * inv)
  let px = f(ax)
  let py = f(ay)
  let cx = f(px + ux)
  let cy = f(py + uy)
  for (let i = 0; i < dist; i++) {
    st.bw = f(7 - f(f(i / dist) * 6))
    brush_large(st, Math.trunc(px), Math.trunc(py), Math.trunc(cx), Math.trunc(cy))
    px = cx
    py = cy
    cx = f(px + ux)
    cy = f(py + uy)
  }
}

// 円で ふで(小) と ふちペン(大) を使うと、4方向それぞれ前の点から線でつなぐ。
function oval_chain(st: nd_state_t, pts: [number, number][], restart: number): void {
  const prev = pts.slice(0, 4)
  const back = pts.slice(0, 4)
  let k = 0
  for (let i = 4; i < pts.length; i++) {
    if (i === restart) {
      for (let j = 0; j < 4; j++) prev[j] = back[j] = pts[i + j]
      i += 3
      continue
    }
    const p = pts[i]
    if (st.tip === 13) {
      st.ox = prev[k][0]
      st.oy = prev[k][1]
      outline_large(st, prev[k][0], prev[k][1], p[0], p[1])
    } else {
      st.b0x = back[k][0]
      st.b0y = back[k][1]
      st.b1x = st.b2x = back[k][0] & ~1
      st.b1y = st.b2y = back[k][1] & ~1
      brush_small(st, prev[k][0], prev[k][1])
      brush_small(st, p[0], p[1])
      back[k] = prev[k]
    }
    prev[k] = p
    k = (k + 1) & 3
  }
}

// 中を塗る図形の輪郭 (ugonote2 の「中を塗りつぶす」用)。
export function nd_outline(kind: number, ax: number, ay: number, bx: number, by: number, held: number): [number, number][] {
  const [ex, ey] = nd_constrain(kind, ax, ay, bx, by, held)
  if (kind === nd_rect) return rect_points(ax, ay, ex, ey)
  if (kind === nd_oval) return held ? circle_points(ax, ay, ex, ey) : oval_points(ax, ay, ex, ey).pts
  return []
}

// 図形ツール。直線は始点を置いてから終点まで、四角は辺をつないで、円は1点ずつ置く。
export function nd_shape(st: nd_state_t, kind: number, ax: number, ay: number, bx: number, by: number, held: number): void {
  const [ex, ey] = nd_constrain(kind, ax, ay, bx, by, held)
  const pen = st.kind === nd_pen
  if (pen && st.tip === 12 && kind !== nd_oval) {
    if (kind === nd_line) taper(st, ax, ay, ex, ey)
    else {
      taper(st, ax, ay, ex, ay)
      taper(st, ex, ay, ex, ey)
      taper(st, ex, ey, ax, ey)
      taper(st, ax, ey, ax, ay)
    }
    return
  }
  if (kind === nd_line) {
    nd_begin(st, ax, ay)
    if (pen && (st.tip === 6 || st.tip === 7 || st.tip === 15 || st.tip === 16)) {
      // 図形の直線では、えんぴつ・スプレーを1pxずつ区切って処理する。
      const pts: [number, number][] = []
      bres(ax, ay, ex, ey, (x, y) => { pts.push([x, y]) })
      for (let i = 1; i < pts.length; i++) {
        const [px0, py0] = pts[i - 1]
        const [px1, py1] = pts[i]
        if (st.tip === 6 || st.tip === 15) noise(st.s, px0, py0, px1, py1, st.tip === 6 ? 5 : 10)
        else spray(st.s, px0, py0, px1, py1, st.tip === 16 ? 1 : 0)
      }
      return
    }
    nd_step(st, ex, ey)
    return
  }
  if (kind === nd_rect) {
    nd_begin(st, ax, ay)
    const pts = rect_points(ax, ay, ex, ey)
    for (let i = 0; i < pts.length; i++) {
      if (i) nd_step(st, pts[i][0], pts[i][1])
      else nd_point(st, pts[i][0], pts[i][1])
    }
    return
  }
  const oval = held ? { pts: circle_points(ax, ay, ex, ey), restart: -1 } : oval_points(ax, ay, ex, ey)
  if (pen && (st.tip === 3 || st.tip === 13)) {
    oval_chain(st, oval.pts, oval.restart)
    return
  }
  if (pen && st.tip === 4) {
    if (!oval.pts.length) return
    const r = Math.max(Math.abs(ax - ex), Math.abs(ay - ey))
    const outer = held ? circle_points(ax, ay, ax + r + 2, ay) : oval_points(ax, ay, ax + Math.abs(ex - ax) + 2, ay + Math.abs(ey - ay) + 2).pts
    for (const [x, y] of oval.pts.concat(outer)) nd_plot(st.s, x, y)
    return
  }
  for (const [x, y] of oval.pts) {
    nd_begin(st, x, y)
    nd_point(st, x, y)
  }
}

// ペイントのバケツ。タッチした点と同じ色が4方向につながる範囲を塗る。
// 上級ふでばこは今のレイヤーだけを見る。普通ふでばこは layers (上から順) で一番上に見える色を比べる。
// 実機 (code.bin 0x1de0e8) と同じく、先に塗れる点の地図を作り、横一列を塗っては左端から順に上・下へ潜っていく。
// 潜る前の場所を覚えておく箱は 4096 個 (0x1000) までで、あふれたらその枝は塗らずに進むので、入り組んだ絵では実機どおり塗り残しが出る。
// rect は紙の範囲 (x0 <= x < x1, y0 <= y < y1)。その外は塗らない。
const bucket_cap = 0x1000

export function nd_bucket(s: nd_surface_t, sx: number, sy: number, layers: Uint32Array[] = [s.px], rect: number[] = [0, 0, s.w, s.h]): void {
  const { w, h } = s
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return
  const keys = nd_keys(layers)
  const target = keys[sy * w + sx]
  const [rx0, ry0, rx1, ry1] = rect
  const block = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      block[i] = x >= rx0 && x < rx1 && y >= ry0 && y < ry1 && keys[i] === target ? 0 : 1
    }
  }
  const stack = new Int16Array(bucket_cap * 4)
  let n = 0
  let x0 = sx
  let x1 = sx
  let y = sy
  let step = 0
  const push = (next: number) => {
    stack.set([x0, x1, y, next], n * 4)
    n++
  }
  for (;;) {
    if (step === 0) {
      let l = x0
      let r = x0
      while (l > 0 && !block[y * w + l - 1]) l--
      while (r + 1 < w && !block[y * w + r + 1]) r++
      x0 = l
      x1 = r
      for (let x = l; x <= r; x++) {
        nd_paint_px(s, x, y)
        block[y * w + x] = 1
      }
      step = 1
    }
    if (step === 1) {
      step = 2
      if (y > 0 && !block[(y - 1) * w + x0] && n + 1 < bucket_cap) {
        push(2)
        y--
        step = 0
      }
    } else if (step === 2) {
      step = 3
      if (y < h - 1 && !block[(y + 1) * w + x0] && n + 1 < bucket_cap) {
        push(3)
        y++
        step = 0
      }
    } else {
      x0++
      step = 1
      if (x0 > x1) {
        if (!n) return
        n--
        x0 = stack[n * 4]
        x1 = stack[n * 4 + 1]
        y = stack[n * 4 + 2]
        step = stack[n * 4 + 3]
      }
    }
  }
}

// 各点で一番上にあるレイヤーとその色。何もなければ0。
export function nd_keys(layers: Uint32Array[]): Float64Array {
  const keys = new Float64Array(layers[0].length)
  for (let i = 0; i < keys.length; i++) {
    for (let l = 0; l < layers.length; l++) {
      const v = layers[l][i]
      if (v >>> 24) {
        keys[i] = l * 4294967296 + v
        break
      }
    }
  }
  return keys
}
