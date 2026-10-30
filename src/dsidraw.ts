// うごくメモ帳 (DSi, Ver.2) の描画処理を移植したもの。
// ペン・ペイント・消しゴムの各ブラシ、線の補間、乱数、タッチのぶれ補正は実機の ARM9 プログラムと同じ値と手順にしている。
// 実機はタッチを1フレームに4回 (240Hz) 読み、1回ごとにブラシの処理を呼ぶ。
import { nd_erase, nd_plot, type nd_surface_t } from './nativedraw'

export const ds_samples = 4

// 実機のブラシ番号。ペン・ペイント・消しゴムの箱は、この番号を並べたもの。
export const ds_pen_brushes = [1, 5, 3, 8, 4, 0, 6, 7]
export const ds_pen_pro_brushes = [0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1e, 0x1d]
export const ds_paint_brushes = [0x13, 0x12, 0x0b, 0x0c, 0x09, 0x0a, 0x14, 0x16]
export const ds_eraser_brushes = [0x11, 0x02, 0x0f, 0x10, 0x1f, 0x20, 0x22, 0x21]
// ベタのペイントは実機にない ugonote2 の追加機能。ペン先の範囲を全部塗る。
export const ds_brush_solid_paint = 0x100

// ugonote2 のもよう番号 → 実機のペイントの箱 (0〜7)。ベタは -1。
const box_of_pat = [-1, 0, 1, 7, 3, 2, 4, 5, 6]

export function ds_box_of_pat(pat: number): number {
  return box_of_pat[pat] ?? 7
}

export type ds_state_t = {
  s: nd_surface_t
  brush: number
  // ペイントの大きさ (0: 3x3, 1: 15x15, 2: 7x7)。上級のペイントは 15x15。
  size: number
  // 上級の消しゴムは、いま選んでいるペイントのもようの点だけを消す。
  pat_erase: number
  pat: number
  // このフレームで新しく描き始めたか。実機は描き始めのフレームのあいだ立てたままにする。
  start: number
  px: number
  py: number
  ax: number
  ay: number
  bx: number
  by: number
  qx: number
  qy: number
  hold: number
  hc: number
  hx: number
  hy: number
  ldx: number
  ldy: number
  lx: number
  ly: number
  ldist: number
}

export function ds_state(s: nd_surface_t, brush: number): ds_state_t {
  return {
    s, brush, size: 0, pat_erase: 0, pat: 0, start: 0, px: 0, py: 0, ax: 0, ay: 0, bx: 0, by: 0, qx: 0, qy: 0,
    hold: 0, hc: 0, hx: 0, hy: 0, ldx: 0, ldy: 0, lx: 0, ly: 0, ldist: 0,
  }
}

// 実機の乱数 (16bit LFSR)。起動時の値は 0x1f01 で、描くたびに進む。
let lfsr = 0x1f01

export function ds_seed(v: number): void {
  lfsr = v & 0xffff
}

export function ds_seed_value(): number {
  return lfsr
}

function rnd(): number {
  const b0 = lfsr & 1
  const b3 = lfsr & 8
  lfsr >>= 1
  if (!b0 === !b3) lfsr |= 0x8000
  return lfsr
}

function mask(rows: string[]): Uint8Array {
  const n = rows.length
  const b = new Uint8Array(n * n)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) b[y * n + x] = rows[y][x] === '#' ? 1 : 0
  return b
}

const diamond5 = mask(['..#..', '.###.', '#####', '.###.', '..#..'])
const round7 = mask(['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'])
const round15 = mask([
  '......###......', '.....#####.....', '...#########...', '..###########..', '.#############.', '###############', '###############', '###############',
  '###############', '###############', '.#############.', '..###########..', '...#########...', '.....#####.....', '......###......',
])

export const ds_round7 = round7
export const ds_round15 = round15

type it_t = { x: number, y: number, x1: number, y1: number, err: number, adx: number, ady: number, dx: number, dy: number }

// 実機の直線の歩き方。始点は返さず、次の点へ1歩ずつ進む。
function it_make(x0: number, y0: number, x1: number, y1: number): it_t {
  return { x: x0, y: y0, x1, y1, err: 0, adx: Math.abs(x1 - x0), ady: Math.abs(y1 - y0), dx: x1 - x0, dy: y1 - y0 }
}

function it_next(it: it_t): number {
  if (it.x === it.x1 && it.y === it.y1) return 0
  if (it.adx > it.ady) {
    it.err += it.ady
    if (it.err >= it.adx) {
      it.err -= it.adx
      it.y += it.dy < 0 ? -1 : 1
    }
    if (it.x !== it.x1) it.x += it.dx < 0 ? -1 : 1
  } else {
    it.err += it.adx
    if (it.err >= it.ady) {
      it.err -= it.ady
      it.x += it.dx < 0 ? -1 : 1
    }
    if (it.y !== it.y1) it.y += it.dy < 0 ? -1 : 1
  }
  return 1
}

const plot = (st: ds_state_t, x: number, y: number): void => nd_plot(st.s, x, y)

// 消しゴムのもよう判定 (ペイントの箱の順)。7 は 4x4 の網目。
function erase_bit(pat: number, x: number, y: number): number {
  switch (pat) {
    case 0: return x % 3 === 1 && y % 3 === 1 ? 1 : 0
    case 1: return !(x & 1) && !(y & 1) ? 1 : 0
    case 2: return x & 1
    case 3: return y & 1
    case 4: return (x + y) & 1
    case 5: return (x & 1) || (y & 1) ? 1 : 0
    case 6: return x % 3 === 1 && y % 3 === 1 ? 0 : 1
    default: return tone_bit(x, y)
  }
}

function tone_bit(x: number, y: number): number {
  return 0xa1a4 & (0x8000 >> ((x & 3) + ((y & 3) << 2))) ? 1 : 0
}

function erase(st: ds_state_t, x: number, y: number, pattern: number): void {
  if (x < 0 || y < 0 || x > 255 || y > 191) return
  if (pattern && st.pat_erase && !erase_bit(st.pat & 7, x, y)) return
  nd_erase(st.s, x, y)
}

// ペイントの点。0〜6 は点だけを打ち、7 (網目) は抜きの点を消す。
function paint_px(st: ds_state_t, p: number, x: number, y: number): void {
  switch (p) {
    case 0: if ((x + y) & 1) plot(st, x, y); return
    case 1: if ((x & 1) || (y & 1)) plot(st, x, y); return
    case 2: if (x & 1) plot(st, x, y); return
    case 3: if (y & 1) plot(st, x, y); return
    case 4: if (!(x & 1) && !(y & 1)) plot(st, x, y); return
    case 5: if (x % 3 === 1 && y % 3 === 1) plot(st, x, y); return
    case 6: if (!(x % 3 === 1 && y % 3 === 1)) plot(st, x, y); return
    case 8: plot(st, x, y); return
    default:
      if (tone_bit(x, y)) plot(st, x, y)
      else erase(st, x, y, 0)
  }
}

const clamp = (v: number, lo: number, hi: number): number => v < lo ? lo : v > hi ? hi : v

// 動いた向きの成分だけを残す (v に直交する成分を引く)。
function proj(p: number[], vx: number, vy: number): void {
  const n = vx * vx + vy * vy
  if (!n) return
  const d = p[0] * vx + p[1] * vy
  p[0] -= Math.trunc(vx * d / n)
  p[1] -= Math.trunc(vy * d / n)
}

function line1(st: ds_state_t, x: number, y: number, draw: number): void {
  const it = it_make(st.px, st.py, x, y)
  while (it_next(it)) {
    if (draw) plot(st, it.x, it.y)
    else erase(st, it.x, it.y, 1)
  }
  st.px = x
  st.py = y
}

const sq3_pts = [0, 0, 0, -1, 0, 1, 1, 0, 1, 1, 1, -1, -1, 0, -1, 1, -1, -1]

function sq3(st: ds_state_t, x: number, y: number, erasing: number): void {
  const it = it_make(st.px, st.py, x, y)
  while (it_next(it)) {
    st.px = it.x
    st.py = it.y
    for (let i = 0; i < sq3_pts.length; i += 2) {
      if (erasing) erase(st, it.x + sq3_pts[i], it.y + sq3_pts[i + 1], 1)
      else plot(st, it.x + sq3_pts[i], it.y + sq3_pts[i + 1])
    }
  }
  st.px = x
  st.py = y
}

// 2px のペン。進んだ向きに応じて、となりの点を1つずつ足す。
function pen2(st: ds_state_t, x: number, y: number): void {
  const dx = x - st.px
  const dy = y - st.py
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  let err = 0
  for (;;) {
    const ox = st.px
    let sb = 0
    let sl = 0
    if (st.px === x && st.py === y) break
    if (adx > ady) {
      err += ady
      if (err >= adx) {
        err -= adx
        if (dy >= 0) {
          sl = 1
          st.py++
        } else {
          st.py--
          sl = -1
        }
      }
      if (ox !== x) {
        if (dx < 0) {
          st.px--
          sb = -1
        } else {
          st.px++
          sb = 1
        }
      }
    } else {
      err += adx
      if (err >= ady) {
        err -= ady
        if (dx >= 0) {
          sb = 1
          st.px++
        } else {
          st.px--
          sb = -1
        }
      }
      if (st.py !== y) {
        if (dy >= 0) {
          st.py++
          sl = 1
        } else {
          st.py--
          sl = -1
        }
      }
    }
    plot(st, st.px, st.py)
    plot(st, st.px + sl, st.py)
    plot(st, st.px, st.py + sb)
  }
  st.px = x
  st.py = y
}

// 2マス単位で進む 2x2 のペン。1つ前・2つ前の点との中点にも打って、すき間を埋める。
function pen2e(st: ds_state_t, x: number, y: number): void {
  st.px &= ~1
  st.py &= ~1
  if (st.start) {
    st.ax = st.px
    st.ay = st.py
    st.bx = st.px
    st.by = st.py
  }
  let dx = x - st.px
  if (dx & 1) dx += dx < 0 ? 1 : -1
  let dy = y - st.py
  if (dy & 1) dy += dy < 0 ? 1 : -1
  const tx = st.px + dx
  const ty = st.py + dy
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  const sq2 = (ax: number, ay: number): void => {
    plot(st, ax, ay)
    plot(st, ax + 1, ay)
    plot(st, ax, ay + 1)
    plot(st, ax + 1, ay + 1)
  }
  let err = 0
  for (;;) {
    const ox = st.px
    if (st.px === tx && st.py === ty) break
    if (adx > ady) {
      err += ady
      if (err >= adx) {
        st.py += dy < 0 ? -2 : 2
        err -= adx
      }
      if (ox !== tx) st.px += dx < 0 ? -2 : 2
    } else {
      err += adx
      if (err >= ady) {
        st.px += dx < 0 ? -2 : 2
        err -= ady
      }
      if (st.py !== ty) st.py += dy < 0 ? -2 : 2
    }
    sq2(st.px, st.py)
    sq2(Math.trunc((st.px + st.bx) / 2), Math.trunc((st.py + st.by) / 2))
    st.bx = st.ax
    st.by = st.ay
    sq2(Math.trunc((st.px + st.ax) / 2), Math.trunc((st.py + st.ay) / 2))
    st.ax = st.px
    st.ay = st.py
  }
  st.px = tx
  st.py = ty
}

// 2本線のペン。進む向きの左右 (または上下) に点を打ち、まん中を消す。
function dbl(st: ds_state_t, x: number, y: number, r: number): void {
  const dx = x - st.px
  const dy = y - st.py
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  let err = 0
  let dir = 0
  for (;;) {
    const ox = st.px
    if (st.px === x && st.py === y) return
    if (adx > ady) {
      err += ady
      if (err >= adx) {
        err -= adx
        if (dy >= 0) {
          dir = 1
          st.py++
        } else {
          st.py--
          dir = 0
        }
      }
      if (ox !== x) {
        if (dx < 0) {
          st.px--
          dir = 2
        } else {
          st.px++
          dir = 3
        }
      }
    } else {
      err += adx
      if (err >= ady) {
        err -= ady
        if (dx >= 0) {
          dir = 7
          st.px++
        } else {
          st.px--
          dir = 6
        }
      }
      if (st.py !== y) {
        if (dy >= 0) {
          st.py++
          dir = 5
        } else {
          st.py--
          dir = 4
        }
      }
    }
    const px = st.px
    const py = st.py
    if (!(dir & 2)) {
      plot(st, px + r, py)
      plot(st, px - r, py)
    } else {
      plot(st, px, py - r)
      plot(st, px, py + r)
    }
    erase(st, px, py, 0)
    switch (dir & 3) {
      case 0: plot(st, px, py - r); break
      case 1: plot(st, px, py + r); break
      case 2: plot(st, px - r, py); break
      default: plot(st, px + r, py)
    }
  }
}

// ふるえる線。始点と終点を乱数でずらした1本の線を引く。
function jitter(st: ds_state_t, x: number, y: number, wide: number): void {
  const m = wide ? 10 : 5
  const o = wide ? 5 : 2
  const sx = st.px
  const sy = st.py
  const a = rnd() % m - o
  const b = rnd() % m - o
  const c = rnd() % m - o
  const d = rnd() % m - o
  st.px = clamp(sx + a, 0, 255)
  st.py = clamp(sy + b, 0, 191)
  line1(st, clamp(x + c, 0, 255), clamp(y + d, 0, 191), 1)
  st.px = x
  st.py = y
}

// かすれた太い線。進む向きにそろえた短い線を、ゆっくり動くほど多く引く。
function scatter(st: ds_state_t, x: number, y: number, wide: number): void {
  const dx = x - st.px
  const dy = y - st.py
  const d2 = dx * dx + dy * dy
  const sx = st.px
  const sy = st.py
  let k = d2 < 4 ? 6 : d2 < 8 ? 5 : d2 < 12 ? 4 : d2 < 24 ? 3 : d2 < 48 ? 2 : 1
  let r = k * k
  k = 16 - k
  if (wide) {
    k <<= 2
    r <<= 1
  }
  for (let i = 0; i < k; i++) {
    const p = [Math.floor(Math.sqrt(rnd() % (r + 1))), 0]
    p[1] = Math.floor(Math.sqrt(rnd() % (r + 1)))
    if (p[0] > 0) p[0]--
    if (p[1] > 0) p[1]--
    if (rnd() & 1) p[0] = -p[0]
    if (rnd() & 1) p[1] = -p[1]
    const q = [rnd() % 3 - 1, 0]
    q[1] = rnd() % 3 - 1
    proj(p, dx, dy)
    proj(q, dx, dy)
    st.px = clamp(sx + p[0], 0, 255)
    st.py = clamp(sy + p[1], 0, 191)
    line1(st, clamp(x + p[0] + q[0], 0, 255), clamp(y + p[1] + q[1], 0, 191), 1)
  }
  st.px = x
  st.py = y
}

// 速さで太さが変わるペン。ゆっくりなら 3x3、ふつうは 2px、速いと 1px。
function speed(st: ds_state_t, x: number, y: number): void {
  const dx = x - st.px
  const dy = y - st.py
  const d2 = dx * dx + dy * dy
  if (d2 < 4) sq3(st, x, y, 0)
  else if (d2 < 32) pen2(st, x, y)
  else line1(st, x, y, 1)
}

// スプレー。マスクの各点を、動いた距離に応じた確率で打つ (位置は実機どおり左上へずれている)。
function spray(st: ds_state_t, x: number, y: number, m: Uint8Array, n: number, off: number): void {
  const it = it_make(st.px, st.py, x, y)
  if (it.adx < 1 && it.ady < 1) return
  while (it_next(it)) {
    st.px = it.x
    st.py = it.y
    const r = it.adx + it.ady
    const sb = r << 6
    let k = 0
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (r && r < ((rnd() % sb) & 0xffff)) {
          k++
          continue
        }
        if (m[k]) plot(st, st.px - off + col, st.py - off + row)
        k++
      }
    }
  }
  st.px = x
  st.py = y
}

function round_erase(st: ds_state_t, x: number, y: number, big: number): void {
  const it = it_make(st.px, st.py, x, y)
  const m = big ? round15 : round7
  const n = big ? 15 : 7
  const o = n >> 1
  while (it_next(it)) {
    st.px = it.x
    st.py = it.y
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) if (m[row * n + col]) erase(st, it.x - o + col, it.y - o + row, 1)
  }
  st.px = x
  st.py = y
}

function square(st: ds_state_t, x: number, y: number, r: number): void {
  const it = it_make(st.px, st.py, x, y)
  while (it_next(it)) {
    st.px = it.x
    st.py = it.y
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) plot(st, it.x + dx, it.y + dy)
  }
  st.px = x
  st.py = y
}

// ふちどりペン。丸く塗ってから、1つ前の点のまわりをひし形に消す。
function outline(st: ds_state_t, x: number, y: number): void {
  const it = it_make(st.px, st.py, x, y)
  if (st.start) {
    st.qx = st.px
    st.qy = st.py
  }
  while (it_next(it)) {
    st.qx = st.px
    st.qy = st.py
    st.px = it.x
    st.py = it.y
    for (let row = 0; row < 7; row++) for (let col = 0; col < 7; col++) if (round7[row * 7 + col]) plot(st, it.x - 3 + col, it.y - 3 + row)
    for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) if (diamond5[row * 5 + col]) erase(st, st.qx - 2 + col, st.qy - 2 + row, 0)
  }
  st.px = x
  st.py = y
}

// 四角・線の消しゴムは始点も消す。
function square_erase(st: ds_state_t, x: number, y: number, r: number): void {
  const it = it_make(st.px, st.py, x, y)
  do {
    st.px = it.x
    st.py = it.y
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) erase(st, it.x + dx, it.y + dy, 1)
  } while (it_next(it))
  st.px = x
  st.py = y
}

function bar_erase(st: ds_state_t, x: number, y: number, vertical: number): void {
  const it = it_make(st.px, st.py, x, y)
  do {
    st.px = it.x
    st.py = it.y
    for (let i = -7; i <= 7; i++) erase(st, vertical ? it.x : it.x + i, vertical ? it.y + i : it.y, 1)
  } while (it_next(it))
  st.px = x
  st.py = y
}

function paint(st: ds_state_t, p: number, x: number, y: number): void {
  const it = it_make(st.px, st.py, x, y)
  const r = st.size === 0 ? 1 : st.size === 1 ? 7 : st.size === 2 ? 3 : -1
  while (it_next(it)) {
    st.px = it.x
    st.py = it.y
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) paint_px(st, p, it.x + dx, it.y + dy)
  }
  st.px = x
  st.py = y
}

// 網目のペイント (箱の8番目)。11x11 の範囲を網目で塗り、抜きの点を消す。
function tone(st: ds_state_t, x: number, y: number): void {
  const it = it_make(st.px, st.py, x, y)
  while (it_next(it)) {
    st.px = it.x
    st.py = it.y
    for (let row = 0; row < 11; row++) for (let col = 0; col < 11; col++) paint_px(st, 7, it.x + col - 5, it.y + row - 5)
  }
  st.px = x
  st.py = y
}

function stamp(st: ds_state_t, x: number, y: number): void {
  const b = st.brush
  switch (b) {
    case 0: return spray(st, x, y, diamond5, 5, 3)
    case 1: return line1(st, x, y, 1)
    case 2: return sq3(st, x, y, 1)
    case 3: return sq3(st, x, y, 0)
    case 4: return dbl(st, x, y, 1)
    case 5: return pen2(st, x, y)
    case 6: return jitter(st, x, y, 0)
    case 7: return scatter(st, x, y, 0)
    case 8: return pen2e(st, x, y)
    case 0x0f: return round_erase(st, x, y, 0)
    case 0x10: return round_erase(st, x, y, 1)
    case 0x11: return line1(st, x, y, 0)
    case 0x16: return tone(st, x, y)
    case 0x17: case 0x18: case 0x19: return square(st, x, y, b - 0x15)
    case 0x1a: return speed(st, x, y)
    case 0x1b: return outline(st, x, y)
    case 0x1c: return spray(st, x, y, round15, 15, 8)
    case 0x1d: return scatter(st, x, y, 1)
    case 0x1e: return jitter(st, x, y, 1)
    case 0x1f: return square_erase(st, x, y, 3)
    case 0x20: return square_erase(st, x, y, 7)
    case 0x21: return bar_erase(st, x, y, 0)
    case 0x22: return bar_erase(st, x, y, 1)
    case ds_brush_solid_paint: return paint(st, 8, x, y)
  }
  if (b >= 0x09 && b <= 0x0c) paint(st, b - 0x09, x, y)
  else if (b >= 0x12 && b <= 0x14) paint(st, b - 0x12 + 4, x, y)
}

// ぶれ補正を通さずに、いまの点から (x, y) までブラシで描く (図形用)。
export function ds_line_to(st: ds_state_t, x: number, y: number): void {
  stamp(st, x, y)
}

// ペンを置いたとき。実機は置いた点を前の点にするだけで、そこからの線は次の読み取りで引く。
export function ds_down(st: ds_state_t, x: number, y: number): void {
  st.px = x
  st.py = y
}

// タッチを1回読んだときの処理。急に飛んだ点は、それまでの動きの向きにそろえて使う (実機のぶれ補正)。
export function ds_sample(st: ds_state_t, x: number, y: number): void {
  let dx = x - st.px
  let dy = y - st.py
  // 保留が解けたサンプルでは、飛びの判定をしない。
  let jump = 1
  if (st.hold) {
    const hx = x - st.hx
    const hy = y - st.hy
    let held = 0
    if (Math.abs(dx) > Math.abs(hx)) {
      dx = hx
      held = 1
    }
    if (Math.abs(dy) > Math.abs(hy)) {
      held = 1
      dy = hy
    }
    if (!held) {
      st.hold = 0
      st.hc = 0
      jump = 0
    } else if (++st.hc > 80) {
      st.hold = 0
      st.hc = 0
      return
    }
  }
  let keep = Math.floor(Math.sqrt(dx * dx + dy * dy))
  if (keep - st.ldist < 30) jump = 0
  else st.hold = 0
  if (jump || st.hold) {
    const ldx = st.ldx
    const ldy = st.ldy
    if (ldx === ldy && ldx === 0) {
      dx = 0
      dy = 0
    } else {
      const t = [dx, dy]
      proj(t, ldx, ldy)
      dx -= t[0]
      dy -= t[1]
      let back = 0
      if (Math.abs(ldx) > Math.abs(ldy)) {
        if ((ldx > 0 && dx < 0) || (ldx < 0 && dx > 0)) back = 1
      } else if ((ldy > 0 && dy < 0) || (ldy < 0 && dy > 0)) back = 1
      if (Math.floor(Math.sqrt(dx * dx + dy * dy)) > st.ldist) back = 1
      if (Math.abs(x - st.lx) < Math.abs(ldx)) st.ldx = x - st.lx
      if (Math.abs(y - st.ly) < Math.abs(ldy)) st.ldy = y - st.ly
      if (back) {
        dx = st.ldx
        dy = st.ldy
      }
    }
    st.hold = 1
    keep = 0
  }
  st.ldist = keep
  st.ldx = dx
  st.ldy = dy
  st.lx = x
  st.ly = y
  if (st.hold) {
    st.hx = x
    st.hy = y
  }
  stamp(st, st.px + dx, st.py + dy)
}
