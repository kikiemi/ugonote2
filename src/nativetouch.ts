// うごくメモ帳3D のタッチ入力の補正 (code.bin の 0x104b9c と 0x1a7200)。
// 実機はタッチパネルを 4ms ごとに読み、1フレーム (60fps) ぶんずつ2段階で整えてから、ペン・消しゴム・ペイントへ渡す。
// 1段目: 4点先まで読んでから出す。x は先の4点のどれかが前の値なら前の値のまま、y は次の1点が前の値なら前の値のまま (ぶれ止め)。
//        離す直前の点には、何点先で離すか (1〜4) を付けておく。
// 2段目: 前の位置と今の点を混ぜてなめらかにし、前に渡した点から 1.7 以上動いたときだけ渡す。
//        混ぜる割合は描き始めが 0.5 で、止まっていると 0.6 まで上がり、動くと 0.4 まで下がる。離す直前と画面の端では下げて今の点へ寄せる。
// 計算はすべて実機と同じ単精度 (Math.fround) で行う。座標は実機の下画面 (320×240、紙は 5〜314, 5〜234) のもの。

export type nt_sample_t = { x: number, y: number, t: number }
export type nt_point_t = { x: number, y: number, start: number }

type nt_out_t = { x: number, y: number, t: number, k: number }

export type nt_state_t = {
  pend: nt_sample_t[]
  last: nt_sample_t
  time: number
  hold: number
  sx: number
  sy: number
  a: number
  ox: number
  oy: number
}

const f = Math.fround
const f_still = f(0.6)
const f_moving = f(0.4)
const f_rate = f(0.01)
const f_gap = f(1.7)
// 離すまで k 点のときに割合へ掛ける値。
const f_release = [0.2, 0.5, 0.7, 0.8].map(f)

export function nt_make(): nt_state_t {
  return { pend: [], last: { x: 0, y: 0, t: 0 }, time: -Infinity, hold: 0, sx: 0, sy: 0, a: 0, ox: 0, oy: 0 }
}

// 1段目。触れていない点は (0, 0) で渡す (実機のタッチパネルの値と同じ)。
function nt_settle(st: nt_state_t, raw: nt_sample_t[]): nt_out_t[] {
  const got = raw.slice(Math.max(0, raw.length - 7))
  const base = st.pend.length
  for (const s of got) {
    const v = { x: s.x, y: s.y, t: s.t }
    // 離れた点は、前の点の位置を引き継ぐ (前のフレームから残っている点がないときはそのまま)。
    if (!v.t && base) {
      const p = st.pend[st.pend.length - 1]
      v.x = p.x
      v.y = p.y
    }
    st.pend.push(v)
  }
  const out: nt_out_t[] = []
  let px = st.last.x
  let py = st.last.y
  const p = st.pend
  while (p.length >= 5) {
    let x = p[0].x
    if (x !== px && (p[1].x === px || p[2].x === px || p[3].x === px || p[4].x === px)) x = px
    px = x
    let y = p[0].y
    if (y !== py && p[1].y === py) y = py
    py = y
    let k = 0
    if (p[0].t) for (let j = 1; j < 5; j++) {
      if (!p[j].t) {
        k = j
        break
      }
    }
    out.push({ x, y, t: p[0].t, k })
    p.shift()
  }
  if (out.length) {
    const o = out[out.length - 1]
    st.last = { x: o.x, y: o.y, t: o.t }
  }
  return out
}

// 2段目。first は描き始めの印。quirk は ふで (上級ふでばこ) のとき1: 実機は渡す点がないフレームでも、
// 触れている点の数が奇数なら前に渡した点をもう一度渡す (実機のコードが数と0/1をビットで掛けているため)。
function nt_smooth(st: nt_state_t, out: nt_out_t[], first: number, now: number, quirk: number): nt_point_t[] {
  if (now - st.time > 100) first = 1
  const s = out.filter(o => o.t)
  const n = s.length
  if (first && n) {
    st.sx = f(s[0].x)
    st.sy = f(s[0].y)
    st.a = f(0.5)
  } else if (st.hold) st.hold--
  const s0 = st.sx
  const s1 = st.sy
  let moved = 0
  if (n > 1) {
    st.hold = 2
    let x0 = s[0].x
    let x1 = s[0].x
    let y0 = s[0].y
    let y1 = s[0].y
    for (const o of s) {
      x0 = Math.min(x0, o.x)
      x1 = Math.max(x1, o.x)
      y0 = Math.min(y0, o.y)
      y1 = Math.max(y1, o.y)
    }
    moved = x1 - x0 >= 3 || y1 - y0 >= 3 ? 1 : 0
  }
  if (!moved && st.a < f_still) st.a = f(st.a + f_rate)
  else if (moved && st.a > f_moving) st.a = f(st.a - f_rate)
  const pts: nt_point_t[] = []
  for (let i = 0; i < n; i++) {
    let k = s[i].k
    if (Math.abs(f(st.sx - s0)) < 2 && Math.abs(f(st.sy - s1)) < 2 && i !== n - 1) k = 0
    if (k) st.a = f(st.a * f_release[k - 1])
    const a = st.a
    const b = f(1 - a)
    st.sx = f(f(st.sx * a) + f(s[i].x * b))
    st.sy = f(f(st.sy * a) + f(s[i].y * b))
    let force = (first && i === 0) || (k && i === n - 1) ? 1 : 0
    // 画面の端の近く (2 < x < 312, 2 < y < 232 の外) では、なめらかにせず今の点をそのまま渡す。
    if (!(st.sx > 2 && st.sx < 312 && st.sy > 2 && st.sy < 232)) {
      force = 1
      st.a = 0
    }
    const dx = f(st.sx - st.ox)
    const dy = f(st.sy - st.oy)
    if (!force && f(Math.sqrt(f(f(dx * dx) + f(dy * dy)))) < f_gap) continue
    pts.push({ x: Math.trunc(st.sx), y: Math.trunc(st.sy), start: 0 })
    st.ox = st.sx
    st.oy = st.sy
  }
  if (quirk && n & (pts.length ? 0 : 1)) pts.push({ x: Math.trunc(st.ox), y: Math.trunc(st.oy), start: 0 })
  if (pts.length) pts[0].start = first
  st.time = now
  return pts
}

// 1フレーム分。raw はそのフレームに読んだ点 (古い順)、now は時刻 (ms)。ペンへ渡す点を返す。
export function nt_frame(st: nt_state_t, raw: nt_sample_t[], now: number, quirk: number): nt_point_t[] {
  const was = st.last.t
  const out = nt_settle(st, raw)
  const first = !was && st.last.t ? 1 : 0
  if (!first && !was && !st.hold) return []
  return nt_smooth(st, out, first, now, quirk)
}

// ペンを離したあと、触れていた点を出し切るまで (実機で数フレーム) 進める。
export function nt_flush(st: nt_state_t, now: number, quirk: number, step: number): nt_point_t[] {
  const pts: nt_point_t[] = []
  for (let i = 0; i < 8 && (st.pend.some(p => p.t) || st.last.t || st.hold); i++) {
    pts.push(...nt_frame(st, [0, 1, 2, 3].map(() => ({ x: 0, y: 0, t: 0 })), now + i * step, quirk))
  }
  return pts
}
