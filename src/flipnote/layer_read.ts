// うごメモの1レイヤーの絵の作りを読みとる。
// 線は「かべ」、模様や細かい点は「塗りのあと」とみて、線で囲まれた所ごとに、どこがどの濃さで塗られていたかを決める。

import { and, and_not, blob_list, block_art, box, grow4, integral, side, stable_order } from './bitmap'
import { sparse_tone, tone_level, tone_pattern } from './tone'

export type rgb_t = readonly [number, number, number]

// ひとつの色の点の集まり (mask は 1 がその色の点)。
export type smooth_ink_t = { rgb: rgb_t, mask: Uint8Array }

// 塗り。patch は点ごとの塗りの番号 (0 は塗らない)、colors は番号ごとの r, g, b, 平均の濃さ (0〜1) の4つずつ (0番は空)、
// alpha は点ごとの濃さ (パッチの中では平らにそろえたもの)。
// 塗りは線の下へ1点もぐりこませてある (なめらかにした線とのあいだに、すきまができないように)。
export type shade_t = { patch: Int32Array, colors: Float64Array, alpha: Float32Array }

// lines: 色ごとの線の点。shade: 塗り (なければ null)。patterns: 「模様を残す」ときに、元の点のまま描く模様の点 (色ごと)。
export type layer_plan_t = { lines: Uint8Array[], shade: shade_t | null, patterns: Uint8Array[] }

// レイヤーの、見えている点。covered は、上のレイヤーの点におおわれている所。
export type shown_t = { inks: smooth_ink_t[], covered: Uint8Array }

// かべで区切られた所。comp は点ごとの所の番号 (かべは -1)、size は所ごとの広さ。
type regions_t = { comp: Int32Array, size: Int32Array }

// しまのきわの線の、ならびをさがす向きのはなれ (前後とも 2〜4 点)。
const stripe_gaps = Int8Array.of(-4, -3, -2, 2, 3, 4)
// たてよこの向き (右、左、下、上)。
const step_x = Int8Array.of(1, -1, 0, 0)
const step_y = Int8Array.of(0, 0, 1, -1)

// 上のレイヤーの点にすっかりかくれている点を、下のレイヤーから除く (layers は上から順)。
// 色ごとに、まわり2点の中に見えている同じ色の点がひとつもない所だけを除くので、線の下にもぐった塗りのふちは残る。
// 同じ模様を写したレイヤーの、見えていなかった模様が、色の塗りとしてうき出てこないようにする。
export function hide_covered(layers: smooth_ink_t[][], w: number, h: number): shown_t[] {
  const n = w * h
  const above = new Uint8Array(n)
  const out: shown_t[] = []
  for (let l = 0; l < layers.length; l++) {
    const inks = layers[l]
    const covered = above.slice()
    const shown: smooth_ink_t[] = []
    for (let k = 0; k < inks.length; k++) {
      const ink = inks[k]
      const sum = integral(and_not(ink.mask, above), w, h)
      let mask = ink.mask
      for (let i = 0; i < n; i++) {
        if (!mask[i] || !above[i]) continue
        const x = i % w
        if (box(sum, w, h, x, (i - x) / w, 2)) continue
        if (mask === ink.mask) mask = ink.mask.slice()
        mask[i] = 0
      }
      shown.push(mask === ink.mask ? ink : { rgb: ink.rgb, mask })
    }
    for (let k = 0; k < inks.length; k++) for (let i = 0; i < n; i++) above[i] |= inks[k].mask[i]
    out.push({ inks: shown, covered })
  }
  return out
}

// (x, y) を左上とする 4×4 の四角が、すべて点か (sum は integral)。(x, y) をふくむ 4×4 の四角のどれかで調べる。
function in_square(sum: Int32Array, w: number, h: number, x: number, y: number): boolean {
  const s = w + 1
  for (let yy = Math.max(0, y - 3); yy <= Math.min(h - 4, y); yy++) {
    for (let xx = Math.max(0, x - 3); xx <= Math.min(w - 4, x); xx++) {
      if (sum[(yy + 4) * s + xx + 4] - sum[yy * s + xx + 4] - sum[(yy + 4) * s + xx] + sum[yy * s + xx] === 16) return true
    }
  }
  return false
}

// 線ではない細かい点 (3点までの小さな点と、市松のように斜めにだけつながった点)。
// 線にくっついた市松の点 (たてよこのとなりは線の1点だけで、線と反対がわの斜め2点が市松の点) も入れる
// (線ぞいの細い市松の帯が、線のふちの点々として残らないように)。
// 市松の点のまとまりのうち、1点のすきまを埋めた形 (all は、この色のすべての点。見つかった模様の点もふくめて見る) に
// 4×4 の四角が入らないもの (3点幅までの市松の帯。点々のペンで書いた字の線など) は、模様ではなく線とみて入れない。
function loose_dots(m: Uint8Array, all: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h
  const out = new Uint8Array(n)
  const checker = new Uint8Array(n)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (!m[i]) continue
      const left = m[i - 1]
      const right = m[i + 1]
      const up = m[i - w]
      const down = m[i + w]
      const ul = m[i - w - 1]
      const ur = m[i - w + 1]
      const dl = m[i + w - 1]
      const dr = m[i + w + 1]
      const sides = left + right + up + down
      if (sides === 0 && ul + ur + dl + dr >= 3) checker[i] = 1
      else if (sides === 1 && (left ? ur && dr : right ? ul && dl : up ? dl && dr : ul && ur)) checker[i] = 1
    }
  }
  // 1点のすきま (左右か上下が点) を埋めた形。
  const solid = all.slice()
  for (let i = w; i < n - w; i++) {
    const x = i % w
    if (!all[i] && x > 0 && x < w - 1 && (all[i - 1] && all[i + 1] || all[i - w] && all[i + w])) solid[i] = 1
  }
  const sum = integral(solid, w, h)
  const ink = integral(all, w, h)
  // 点ごとの、斜めにもつながった点のまとまりの大きさ。
  const size = new Int32Array(n)
  const groups = blob_list(m, w, h, 1)
  for (let k = 0; k < groups.count; k++) {
    for (let c = groups.start[k]; c < groups.start[k + 1]; c++) size[groups.cells[c]] = groups.start[k + 1] - groups.start[k]
  }
  const list = blob_list(checker, w, h, 1)
  for (let k = 0; k < list.count; k++) {
    const begin = list.start[k]
    const end = list.start[k + 1]
    // 3点に満たない小さなまとまりは、まわり 5×5 の点が 10 までの、8点以上つながった細い線の中のものだけを線とみる
    // (点のこみあった所の市松の点や、× の形の点をならべた模様が、小さな × の形の線として残らないように)。
    let thin = end - begin >= 3
    if (!thin) {
      thin = true
      for (let c = begin; c < end && thin; c++) {
        const j = list.cells[c]
        thin = size[j] >= 8 && box(ink, w, h, j % w, Math.floor(j / w), 2) <= 10
      }
    }
    if (thin) {
      let square = false
      for (let c = begin; c < end && !square; c++) {
        const j = list.cells[c]
        square = in_square(sum, w, h, j % w, Math.floor(j / w))
      }
      if (!square) continue
    }
    for (let c = begin; c < end; c++) out[list.cells[c]] = 1
  }
  for (let k = 0; k < groups.count; k++) {
    if (groups.start[k + 1] - groups.start[k] > 3) continue
    for (let c = groups.start[k]; c < groups.start[k + 1]; c++) out[groups.cells[c]] = 1
  }
  return out
}

// (x, y) を左上とする 2×2 の四角が、すべて点か。
function full_block(m: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w - 1 && y < h - 1 && m[y * w + x] === 1 && m[y * w + x + 1] === 1 && m[(y + 1) * w + x] === 1 && m[(y + 1) * w + x + 1] === 1
}

// 細い帯の模様として見つかった点のまとまり (斜めにもつながったもの) のうち、半分より多くの点が、点のつまった 2×2 の四角に
// 入るもの (2点以上の太さの線がならんだもの。太い字の「二」や「三」など) を、模様から除く。細い帯の模様は、1点の点や線でできている。
function drop_thick(pattern: Uint8Array, m: Uint8Array, w: number, h: number): void {
  const list = blob_list(pattern, w, h, 1)
  for (let k = 0; k < list.count; k++) {
    const begin = list.start[k]
    const end = list.start[k + 1]
    let thick = 0
    for (let c = begin; c < end; c++) {
      const j = list.cells[c]
      const x = j % w
      const y = (j - x) / w
      if (full_block(m, w, h, x - 1, y - 1) || full_block(m, w, h, x, y - 1) || full_block(m, w, h, x - 1, y) || full_block(m, w, h, x, y)) thick++
    }
    if (thick * 2 <= end - begin) continue
    for (let c = begin; c < end; c++) pattern[list.cells[c]] = 0
  }
}

// まわり 3×3 (絵の外は数えない) に、点が1つでもある所 (all が 0)、すべて点の所 (all が 1)。
function around3(src: Uint8Array, w: number, h: number, all: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let count = 0
      let cells = 0
      for (let yy = y - 1; yy <= y + 1; yy++) {
        for (let xx = x - 1; xx <= x + 1; xx++) {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          cells++
          count += src[yy * w + xx]
        }
      }
      out[y * w + x] = all ? count === cells ? 1 : 0 : count ? 1 : 0
    }
  }
  return out
}

// 線として残った点のうち、点がまばらにつまった所 (細い帯や、ベタのふちにくっついた模様ブラシの跡)。
// 線の点の 1 点のすきまを 3×3 で埋めた形のうち、まわり 5×5 で、点がその形の 6 割に満たない所の点。
// まっすぐな線や斜めの線は、すきまを埋めても形がかわらない (割合が 1 のまま) ので入らない。
// ベタや太い線にくっついた所は、ベタの点で割合が上がるので、ベタのふちはけずられない。
function patchy_dots(m: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h
  const closed = around3(around3(m, w, h, 0), w, h, 1)
  const ink = integral(m, w, h)
  const area = integral(closed, w, h)
  const out = new Uint8Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!m[i]) continue
      const a = box(area, w, h, x, y, 2)
      if (a >= 15 && box(ink, w, h, x, y, 2) < a * 0.6) out[i] = 1
    }
  }
  return out
}

// 点 (位置の番号) が1列にならんでいるか (点の広がりの、いちばんせまい向きの分散が 2 未満)。
function thin_row(dots: readonly number[], w: number): boolean {
  const count = dots.length
  let mx = 0
  let my = 0
  for (let k = 0; k < count; k++) {
    mx += dots[k] % w
    my += Math.floor(dots[k] / w)
  }
  mx /= count
  my /= count
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let k = 0; k < count; k++) {
    const ex = dots[k] % w - mx
    const ey = Math.floor(dots[k] / w) - my
    sxx += ex * ex
    syy += ey * ey
    sxy += ex * ey
  }
  sxx /= count
  syy /= count
  sxy /= count
  return (sxx + syy) / 2 - Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy) < 2
}

// かべで区切られた所 (たてよこにつながったすきま) の番号 (かべは -1) と、それぞれの広さ。
function regions(walls: Uint8Array, w: number, h: number): regions_t {
  const n = w * h
  const comp = new Int32Array(n).fill(-1)
  const sizes: number[] = []
  const queue: number[] = []
  for (let i = 0; i < n; i++) {
    if (walls[i] || comp[i] >= 0) continue
    const id = sizes.length
    comp[i] = id
    queue.length = 0
    queue.push(i)
    for (let q = 0; q < queue.length; q++) {
      for (let k = 0; k < 4; k++) {
        const t = side(queue[q], w, n, k)
        if (t < 0 || walls[t] || comp[t] >= 0) continue
        comp[t] = id
        queue.push(t)
      }
    }
    sizes.push(queue.length)
  }
  return { comp, size: Int32Array.from(sizes) }
}

// i に、この絵のどれかの色の点があるか。
function any_ink(inks: readonly smooth_ink_t[], i: number): boolean {
  for (let k = 0; k < inks.length; k++) if (inks[k].mask[i]) return true
  return false
}

// j のまわり 3×3 に、模様ブラシの跡 (loose が 2) があるか。
function touches_trace(loose: Uint8Array, j: number, w: number, n: number): boolean {
  const x = j % w
  for (let yy = -1; yy <= 1; yy++) {
    for (let xx = -1; xx <= 1; xx++) {
      const t = j + yy * w + xx
      if (x + xx >= 0 && x + xx < w && t >= 0 && t < n && loose[t] === 2) return true
    }
  }
  return false
}

// j から上下左右の 3 点以内に、見つかった模様 (found) がある向きが 3 つ以上あるか。
function boxed_in(found: Uint8Array, j: number, w: number, h: number): boolean {
  const x = j % w
  const y = (j - x) / w
  let around = 0
  for (let k = 0; k < 4; k++) {
    for (let d = 1; d <= 3; d++) {
      const xx = x + step_x[k] * d
      const yy = y + step_y[k] * d
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) break
      if (found[yy * w + xx]) {
        around++
        break
      }
    }
  }
  return around >= 3
}

// covered は、上のレイヤーにおおわれて見えない所 (塗りの濃さを数えるときに入れない)。paper は紙の色。
export function read_layer(inks: readonly smooth_ink_t[], covered: Uint8Array, paper: rgb_t, w: number, h: number): layer_plan_t {
  const n = w * h
  const lines: Uint8Array[] = []
  const textures: Uint8Array[] = []
  // 模様ブラシの跡 (色ごと)。塗りに入らなくても、線にはもどさない。
  const traces: Uint8Array[] = []
  // 2倍にしたドット絵の字など (色ごと)。しまのきわの線として塗りに入れない。
  const arts: Uint8Array[] = []
  const walls = new Uint8Array(n)
  const texture = new Uint8Array(n)
  // 規則正しい模様から来た塗りのあと (ばらばらの細かい点だけの所と見分ける)。
  const regular_at = new Uint8Array(n)
  // まばらな点の模様が広がっている所 (点と点のあいだも塗りのあととみる)。
  const spread = new Uint8Array(n)
  // 1. 色ごとに、規則正しい模様の点と細かい点を「塗りのあと」、残りを「線」に分ける。
  for (let k = 0; k < inks.length; k++) {
    const ink = inks[k]
    // 2倍にしたドット絵の字などは、平行な線が模様に見えても線とする (W や「三」が、灰色の塗りにならないように)。
    const art = block_art(ink.mask, w, h)
    arts.push(art)
    const drawn = art.includes(1) ? and_not(ink.mask, art) : ink.mask
    const regular = tone_pattern(drawn, w, h)
    let rest = regular ? and_not(ink.mask, regular) : ink.mask
    // 7×7 の窓に入りきらない細い帯の模様 (線のあいだのあみ目など) は、5×5 の窓で、くり返しがぴったり合う所だけを
    // もう一度さがす (ぴったり合うことを求めるので、2本ならんだ線などを模様とまちがえない)。
    const narrow = tone_pattern(rest === ink.mask ? drawn : and_not(rest, art), w, h, 2, 1)
    if (narrow) {
      drop_thick(narrow, ink.mask, w, h)
      rest = and_not(rest, narrow)
    }
    // 7×7 の窓には点が数個しか入らない、まばらな点の模様は、点どうしの位置でさがす。広がりは、上で見つかった
    // 模様の点もふくめて求める (間引いた所のある模様で、残った点のあいだがすきまにならないように)。
    const sparse = sparse_tone(drawn, w, h)
    if (sparse) {
      rest = and_not(rest, sparse.dots)
      for (let i = 0; i < n; i++) spread[i] |= sparse.cover[i]
    }
    const loose = loose_dots(rest, ink.mask, w, h)
    // 模様ブラシの跡は、見つかった模様のそば (6 点以内) だけでさがす (まつげのような、こみいった線をまちがえないように)。
    const found = and_not(ink.mask, rest)
    // ベタにとじこめられて、ベタでふさぐ模様の穴。
    const plug = new Uint8Array(n)
    if (found.includes(1)) {
      const near = grow4(found, w, h, 6)
      const patchy = patchy_dots(rest, w, h)
      for (let i = 0; i < n; i++) if (patchy[i] && near[i]) loose[i] = 2
      // 跡をのぞいたあとに残った、跡にふれている 4 点までの線のかけらも跡とみる (点々として残らないように)。
      const bits = blob_list(and_not(rest, loose), w, h, 1)
      for (let b = 0; b < bits.count; b++) {
        const begin = bits.start[b]
        const end = bits.start[b + 1]
        if (end - begin > 4) continue
        let touch = false
        for (let c = begin; c < end && !touch; c++) touch = touches_trace(loose, bits.cells[c], w, n)
        if (touch) for (let c = begin; c < end; c++) loose[bits.cells[c]] = 2
      }
      // 模様の中にとり残された 5 点までの線のかけら (上下左右の 3 点以内に、見つかった模様がある所) も跡とみる
      // (くり返しの長い模様で、見分けからこぼれた数点が、点々として残らないように)。
      const left = blob_list(and_not(rest, loose), w, h, 1)
      for (let b = 0; b < left.count; b++) {
        const begin = left.start[b]
        const end = left.start[b + 1]
        if (end - begin > 5) continue
        let inside = true
        for (let c = begin; c < end && inside; c++) inside = boxed_in(found, left.cells[c], w, h)
        if (inside) for (let c = begin; c < end; c++) loose[left.cells[c]] = 2
      }
      // ベタと模様のさかいめで、まわり 5×5 の半分をこえてベタの点にかこまれた模様の点はベタに入れる
      // (さかいめが模様のくり返しにそってぎざぎざに分かれ、ベタのふちがでこぼこにならないように)。
      const solid = and_not(rest, loose)
      const sum = integral(solid, w, h)
      const taken = new Uint8Array(n)
      for (let i = 0; i < n; i++) {
        if (!ink.mask[i] || solid[i]) continue
        const x = i % w
        if (box(sum, w, h, x, (i - x) / w, 2) >= 13) taken[i] = 1
      }
      for (let i = 0; i < n; i++) {
        if (!taken[i]) continue
        rest[i] = 1
        loose[i] = 0
      }
      // それでベタにとじこめられた模様の穴 (上下左右がベタで、そのどれかが今ベタに入れた点) は、ベタでふさぐ
      // (小さな点として残らないように)。この絵のほかの色の点がある所はふさがない。
      for (let i = 0; i < n; i++) {
        if (any_ink(inks, i)) continue
        let walled = true
        let fresh = false
        for (let s = 0; s < 4; s++) {
          const t = side(i, w, n, s)
          if (!(t >= 0 && rest[t] && !loose[t])) walled = false
          if (t >= 0 && taken[t]) fresh = true
        }
        if (walled && fresh) plug[i] = 1
      }
    }
    const line = new Uint8Array(n)
    const tex = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      if (!ink.mask[i] && !plug[i]) continue
      if (plug[i] || rest[i] && !loose[i]) {
        line[i] = 1
        walls[i] = 1
      } else {
        tex[i] = 1
        texture[i] = 1
        if (!rest[i]) regular_at[i] = 1
      }
    }
    lines.push(line)
    textures.push(tex)
    // まばらな点の模様の点も、塗りに入らなくても線にはもどさない (ぼかしのうすいはしの点が、点々として残らないように)。
    const trace = new Uint8Array(n)
    for (let i = 0; i < n; i++) trace[i] = loose[i] === 2 || sparse !== null && sparse.dots[i] ? 1 : 0
    traces.push(trace)
  }
  // 2. 線で区切られた所に番号をつける。
  const parts = regions(walls, w, h)
  const comp = parts.comp
  const size = parts.size
  // 3. 塗りのあとの広がり。点どうしのすきま (4点まで、まばらな点の模様ではその広がりの中すべて) を埋め、
  // ふちを1点もどす。線はこえない。
  const seed = new Uint8Array(n)
  for (let i = 0; i < n; i++) seed[i] = texture[i] || spread[i] && !walls[i] ? 1 : 0
  const grown = grow4(seed, w, h, 2, walls)
  const shape = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!grown[i]) continue
    // ふち (となりに、かべでも広がりでもない所がある点) は、塗りのあとの点だけを残す。
    let edge = false
    for (let s = 0; s < 4 && !edge; s++) {
      const t = side(i, w, n, s)
      edge = t >= 0 && !walls[t] && !grown[t]
    }
    shape[i] = texture[i] || !edge ? 1 : 0
  }
  const tex_n = new Int32Array(size.length)
  const shape_n = new Int32Array(size.length)
  const regular_n = new Int32Array(size.length)
  for (let i = 0; i < n; i++) {
    if (comp[i] < 0) continue
    tex_n[comp[i]] += texture[i]
    shape_n[comp[i]] += shape[i]
    regular_n[comp[i]] += regular_at[i]
  }
  // 4. 囲まれた所の大部分 (85% 以上) に塗りのあとがあれば、その所全体を塗る (ふちは線にぴったり)。
  // 規則正しい模様がある所や、細かい点がこみあっている (1/3 以上) 所では、塗りのあとのある所を塗る。
  const fill_at = new Uint8Array(n)
  // 囲まれた所全体を塗った所。
  const whole_at = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const c = comp[i]
    if (c < 0 || tex_n[c] < 4 || shape_n[c] < 8) continue
    const whole = shape_n[c] >= size[c] * 0.85
    if (whole || shape[i] && (regular_n[c] >= 8 || tex_n[c] >= 12 && tex_n[c] * 3 >= shape_n[c])) fill_at[i] = 1
    if (whole) whole_at[i] = 1
  }
  // それ以外の所でも、細かい点が 1/8 以上のこみぐあいで集まったまとまり (点で描いた陰・かすれ・点線) は塗りにする。
  // まばらな点 (星や目の光など) は点のまま残す。
  const shapes = blob_list(shape, w, h, 0)
  for (let k = 0; k < shapes.count; k++) {
    const begin = shapes.start[k]
    const end = shapes.start[k + 1]
    if (end - begin < 8 || fill_at[shapes.cells[begin]]) continue
    let dots = 0
    for (let c = begin; c < end; c++) dots += texture[shapes.cells[c]]
    if (dots < 6 || dots * 8 < end - begin) continue
    for (let c = begin; c < end; c++) fill_at[shapes.cells[c]] = 1
  }
  thin_strips(fill_at, comp, size, whole_at, regular_at, texture, walls, w, h)
  // 6点に満たない塗りのかけらは捨てる (ざらつきのもと)。
  const bits = blob_list(fill_at, w, h, 0)
  for (let k = 0; k < bits.count; k++) {
    if (bits.start[k + 1] - bits.start[k] > 5) continue
    for (let c = bits.start[k]; c < bits.start[k + 1]; c++) fill_at[bits.cells[c]] = 0
  }
  // 塗りに入らなかった塗りのあとは、塗りから3点以内なら塗りのなごりとして描かず (模様を残すときは模様として描く)、
  // はなれた所の点 (星や目の光など) は線にもどす。模様ブラシの跡は、はなれていても線にもどさない。
  const near_fill = grow4(fill_at, w, h, 3)
  const patterns: Uint8Array[] = []
  for (let k = 0; k < inks.length; k++) {
    const tex = textures[k]
    const pattern = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      if (!tex[i] || fill_at[i]) continue
      if (near_fill[i] || traces[k][i]) pattern[i] = 1
      else lines[k][i] = 1
      tex[i] = 0
    }
    patterns.push(pattern)
  }
  if (!fill_at.includes(1)) return { lines, shade: null, patterns }
  absorb_stripes(inks, lines, textures, walls, fill_at, arts, w, h)
  // しまのあいだに残った1点のすきま (上下か左右が塗り) も塗りに入れる。
  const gap: number[] = []
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (fill_at[i] || walls[i]) continue
      if (fill_at[i - w] && fill_at[i + w] || fill_at[i - 1] && fill_at[i + 1]) gap.push(i)
    }
  }
  for (let g = 0; g < gap.length; g++) fill_at[gap[g]] = 1
  for (let k = 0; k < inks.length; k++) {
    for (let i = 0; i < n; i++) if (textures[k][i]) patterns[k][i] = 1
  }
  return { lines, shade: shade_patches(inks, textures, fill_at, covered, paper, comp, walls, w, h), patterns }
}

// 細かい点だけの塗りのうち、ほとんど塗りのない所 (塗りが囲まれた所の 1/4 未満) にぽつんとある、点が1列にならんだもの
// (しぶきの細いすじなど) は、まわりに広げた所ではなく、となりあう点 (3点以内) を結んだ細いすじだけを塗る
// (広げた所をうすく塗ると、ぼやけたしみに見えるため)。
function thin_strips(fill_at: Uint8Array, comp: Int32Array, size: Int32Array, whole_at: Uint8Array, regular_at: Uint8Array, texture: Uint8Array, walls: Uint8Array, w: number, h: number): void {
  const n = w * h
  const fill_n = new Int32Array(size.length)
  for (let i = 0; i < n; i++) if (fill_at[i] && comp[i] >= 0) fill_n[comp[i]]++
  const strip = new Uint8Array(n)
  const list = blob_list(fill_at, w, h, 0)
  const dots: number[] = []
  for (let k = 0; k < list.count; k++) {
    const begin = list.start[k]
    const end = list.start[k + 1]
    const c = comp[list.cells[begin]]
    if (c < 0 || fill_n[c] * 4 >= size[c]) continue
    dots.length = 0
    let solid = false
    for (let e = begin; e < end && !solid; e++) {
      const j = list.cells[e]
      if (whole_at[j] || regular_at[j]) solid = true
      else if (texture[j]) dots.push(j)
    }
    if (solid || dots.length < 2 || !thin_row(dots, w)) continue
    for (let e = begin; e < end; e++) fill_at[list.cells[e]] = 0
    for (let a = 0; a < dots.length; a++) {
      const ax = dots[a] % w
      const ay = (dots[a] - ax) / w
      strip[dots[a]] = 1
      for (let b = a + 1; b < dots.length; b++) {
        const bx = dots[b] % w
        const by = (dots[b] - bx) / w
        const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay))
        if (steps > 3) continue
        for (let t = 1; t < steps; t++) {
          const j = Math.round(ay + (by - ay) * t / steps) * w + Math.round(ax + (bx - ax) * t / steps)
          if (!walls[j]) strip[j] = 1
        }
      }
    }
  }
  for (let i = 0; i < n; i++) fill_at[i] |= strip[i]
}

// しま模様のきわに残った短い線 (2点までの太さで、2〜4点はなれた所 (前後 3点まで) に同じ色の線や模様が
// ならぶ所が 1/3 以上あるもの) は、塗りから 2点以内なら模様とみて塗りに入れる。ならびのない1本だけの線 (口など) と、
// 2倍にしたドット絵の字 (arts) は線のまま。
function absorb_stripes(inks: readonly smooth_ink_t[], lines: Uint8Array[], textures: Uint8Array[], walls: Uint8Array, fill_at: Uint8Array, arts: Uint8Array[], w: number, h: number): void {
  const mine = new Uint8Array(w * h)
  for (let k = 0; k < inks.length; k++) {
    const mask = inks[k].mask
    const line = lines[k]
    const list = blob_list(line, w, h, 1)
    for (let b = 0; b < list.count; b++) {
      const begin = list.start[b]
      const end = list.start[b + 1]
      if (end - begin > 64 || arts[k][list.cells[begin]]) continue
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
      const flat = y1 - y0 <= 1 && x1 - x0 <= 30
      const tall = x1 - x0 <= 1 && y1 - y0 <= 30
      if (!flat && !tall) continue
      let touch = 0
      for (let y = Math.max(0, y0 - 2); y <= Math.min(h - 1, y1 + 2) && !touch; y++) {
        for (let x = Math.max(0, x0 - 2); x <= Math.min(w - 1, x1 + 2); x++) {
          if (fill_at[y * w + x]) {
            touch = 1
            break
          }
        }
      }
      if (!touch) continue
      for (let c = begin; c < end; c++) mine[list.cells[c]] = 1
      let beside = 0
      for (let c = begin; c < end; c++) {
        const j = list.cells[c]
        const x = j % w
        const y = (j - x) / w
        let found = 0
        for (let g = 0; g < stripe_gaps.length; g++) {
          const d = stripe_gaps[g]
          for (let s = -3; s <= 3 && !found; s++) {
            const xx = flat ? x + s : x + d
            const yy = flat ? y + d : y + s
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
            const t = yy * w + xx
            if (mask[t] && !mine[t]) found = 1
          }
        }
        beside += found
      }
      for (let c = begin; c < end; c++) mine[list.cells[c]] = 0
      if (beside * 3 < end - begin) continue
      for (let c = begin; c < end; c++) {
        const j = list.cells[c]
        line[j] = 0
        walls[j] = 0
        textures[k][j] = 1
        fill_at[j] = 1
      }
    }
  }
}

// from の所の値を、to の所 (from をふくむ) へ、いちばん近い from の値で広げる。
function spread_into(value: Float32Array, from: Uint8Array, to: Uint8Array, w: number, h: number): Float32Array {
  const n = w * h
  const done = from.slice()
  let queue: number[] = []
  for (let i = 0; i < n; i++) if (from[i]) queue.push(i)
  while (queue.length) {
    const next: number[] = []
    for (let q = 0; q < queue.length; q++) {
      const j = queue[q]
      for (let k = 0; k < 4; k++) {
        const t = side(j, w, n, k)
        if (t < 0 || done[t] || !to[t]) continue
        done[t] = 1
        value[t] = value[j]
        next.push(t)
      }
    }
    queue = next
  }
  return value
}

// 画面の明るさ (sRGB の 0〜255) を、光の強さ (0〜1) にする。
function to_light(v: number): number {
  v /= 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

// 光の強さ (0〜1) を、画面の明るさ (sRGB の 0〜255) にする。
function to_screen(v: number): number {
  return (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255
}

// 模様の点の割合 d を、塗りの濃さにする。点と紙がまじった模様は、目には光を平均した明るさに見える
// (50% の黒い点は、こい灰色ではなく、明るめの灰色に見える)。紙の上にこの色 (colors の id 番) をぬったとき、
// その明るさになる濃さを求める。
function seen_alpha(d: number, colors: Float64Array, id: number, paper: rgb_t): number {
  let top = 0
  let bottom = 0
  for (let c = 0; c < 3; c++) {
    const ink = colors[id * 4 + c]
    const target = to_screen(d * to_light(ink) + (1 - d) * to_light(paper[c]))
    top += (target - paper[c]) * (ink - paper[c])
    bottom += (ink - paper[c]) ** 2
  }
  return bottom > 300 ? Math.max(0, Math.min(1, top / bottom)) : d
}

// i と j が同じ線の囲みの中か (線にふれていた模様の点は、どの囲みにも入っていない)。
function same_region(comp: Int32Array, i: number, j: number): boolean {
  return comp[i] < 0 || comp[j] < 0 || comp[i] === comp[j]
}

// 5. 塗りの色と濃さ。模様ごとに、ひとつの平らな濃さの塗り (パッチ) にする (スクリーントーンを灰色にしたような見た目)。
// 濃さが平らにそろった所を芯にし、となりと濃さの近い芯どうしを1つのパッチにまとめる。芯でない所 (模様のさかいめ
// など) は、いちばん近いパッチに入れる。線をこえてはまとめない。
function shade_patches(inks: readonly smooth_ink_t[], textures: Uint8Array[], fill_at: Uint8Array, covered: Uint8Array, paper: rgb_t, comp: Int32Array, walls: Uint8Array, w: number, h: number): shade_t {
  const n = w * h
  // 濃さは、見えている塗りの所だけで数える。上のレイヤーにかくれた所は点を除いてあるので、そこを数えると、
  // 上の絵のまわりだけ塗りがうすくなって、白いふちどりのように見えてしまう。かくれた所の濃さは、となりから広げる。
  const seen = and_not(fill_at, covered)
  const levels: Float32Array[] = []
  for (let k = 0; k < textures.length; k++) levels.push(spread_into(tone_level(and(textures[k], seen), seen, w, h), seen, fill_at, w, h))
  const total = new Float32Array(n)
  for (let i = 0; i < n; i++) if (fill_at[i]) for (let k = 0; k < levels.length; k++) total[i] += levels[k][i]
  // 芯: まわり 5×5 の塗りの中で、濃さの差が 0.08 未満の所。しまなどの模様は、数える窓とくり返しの幅が合わず、
  // 1段ごとに 0.04 ほど濃さがゆれるので、それより大きく、ちがう模様どうしの差 (0.12 ほど) より小さくする。
  const flat = new Uint8Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!fill_at[i]) continue
      let lo = total[i]
      let hi = total[i]
      for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) {
        for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) {
          const j = yy * w + xx
          if (!fill_at[j] || !same_region(comp, i, j)) continue
          lo = Math.min(lo, total[j])
          hi = Math.max(hi, total[j])
        }
      }
      flat[i] = hi - lo < 0.08 ? 1 : 0
    }
  }
  // 芯を、濃さの近いものどうし (たてよこのとなりで 0.07 未満、まとめている芯の平均とも 0.06 未満の差) でまとめる
  // (少しずつ濃さの変わる所が、1つにつながってしまわないように)。12点に満たないまとまりは芯にしない。
  const patch = new Int32Array(n)
  let count = 0
  const cells: number[] = []
  for (let i = 0; i < n; i++) {
    if (!flat[i] || patch[i]) continue
    const id = ++count
    cells.length = 0
    cells.push(i)
    patch[i] = id
    let sum = total[i]
    for (let c = 0; c < cells.length; c++) {
      const j = cells[c]
      for (let k = 0; k < 4; k++) {
        const t = side(j, w, n, k)
        if (t < 0 || !flat[t] || patch[t] || !same_region(comp, j, t) || Math.abs(total[t] - total[j]) >= 0.07 || Math.abs(total[t] - sum / cells.length) >= 0.06) continue
        patch[t] = id
        cells.push(t)
        sum += total[t]
      }
    }
    if (cells.length >= 12) continue
    for (let c = 0; c < cells.length; c++) {
      patch[cells[c]] = 0
      flat[cells[c]] = 0
    }
    count--
  }
  // 芯でない塗りは、塗りの中を通って、いちばん近いパッチに入れる。
  let queue: number[] = []
  for (let i = 0; i < n; i++) if (patch[i]) queue.push(i)
  while (queue.length) {
    const next: number[] = []
    for (let q = 0; q < queue.length; q++) {
      const j = queue[q]
      for (let k = 0; k < 4; k++) {
        const t = side(j, w, n, k)
        if (t < 0 || !fill_at[t] || patch[t] || !same_region(comp, j, t)) continue
        patch[t] = patch[j]
        next.push(t)
      }
    }
    queue = next
  }
  // 芯がひとつもない所 (ばらばらの点だけの塗りなど) は、つながった所ごとに1つのパッチにする。
  for (let i = 0; i < n; i++) {
    if (!fill_at[i] || patch[i]) continue
    const id = ++count
    cells.length = 0
    cells.push(i)
    patch[i] = id
    for (let c = 0; c < cells.length; c++) {
      const j = cells[c]
      for (let k = 0; k < 4; k++) {
        const t = side(j, w, n, k)
        if (t < 0 || !fill_at[t] || patch[t] || !same_region(comp, j, t)) continue
        patch[t] = id
        cells.push(t)
      }
    }
  }
  count = merge_patches(patch, count, flat, levels, comp, w, h)
  // パッチの色と濃さは、芯の点の平均 (芯のないパッチは、すべての点の平均)。色は、色ごとの濃さで重みをつけて、
  // 光の強さでまぜる (赤と黄の点がまじった模様は、目に見えるとおりのだいだい色になる)。
  const seeded = new Uint8Array(count + 1)
  for (let i = 0; i < n; i++) if (flat[i]) seeded[patch[i]] = 1
  // パッチごとの [r, g, b, 色の重み, 濃さ, 点の数] の合計
  const acc = new Float64Array((count + 1) * 6)
  for (let i = 0; i < n; i++) {
    const id = patch[i]
    if (!id || seeded[id] && !flat[i]) continue
    const a = id * 6
    for (let k = 0; k < levels.length; k++) {
      const v = levels[k][i]
      acc[a] += to_light(inks[k].rgb[0]) * v
      acc[a + 1] += to_light(inks[k].rgb[1]) * v
      acc[a + 2] += to_light(inks[k].rgb[2]) * v
      acc[a + 3] += v
    }
    acc[a + 4] += total[i]
    acc[a + 5]++
  }
  const colors = new Float64Array((count + 1) * 4)
  for (let id = 1; id <= count; id++) {
    const a = id * 6
    for (let c = 0; c < 3; c++) colors[id * 4 + c] = acc[a + 3] > 0 ? to_screen(acc[a + c] / acc[a + 3]) : inks[0].rgb[c]
    colors[id * 4 + 3] = Math.max(1 / 32, Math.min(1, acc[a + 4] / Math.max(1, acc[a + 5])))
  }
  // 塗りごとの、点の割合から見た目の濃さへのかえ表 (0〜1 を 32 等分) で、平均の濃さを見た目の濃さにする。
  const looks = new Float32Array(33)
  for (let id = 1; id <= count; id++) {
    for (let k = 0; k <= 32; k++) looks[k] = seen_alpha(k / 32, colors, id, paper)
    const t = Math.max(0, Math.min(1, colors[id * 4 + 3])) * 32
    const k = Math.min(31, Math.floor(t))
    colors[id * 4 + 3] = Math.max(1 / 64, looks[k] + (looks[k + 1] - looks[k]) * (t - k))
  }
  // 濃さは、パッチの中で平らにそろえる (模様のむらが、もやもやしたまだらに見えないように)。
  const alpha = new Float32Array(n)
  for (let i = 0; i < n; i++) if (patch[i]) alpha[i] = colors[patch[i] * 4 + 3]
  // 塗りは線の下へ1点もぐりこませる。
  const cover = patch.slice()
  for (let i = 0; i < n; i++) {
    if (!walls[i]) continue
    for (let k = 0; k < 4; k++) {
      const t = side(i, w, n, k)
      if (t < 0 || !fill_at[t]) continue
      cover[i] = patch[t]
      alpha[i] = alpha[t]
      break
    }
  }
  return { patch: cover, colors, alpha }
}

// パッチ a と b の、色ごとの平均の濃さのいちばん大きな差 (sums はパッチごとの [色ごとの濃さの合計..., 点の数])。
function patch_gap(sums: Float64Array, kinds: number, a: number, b: number): number {
  const step = kinds + 1
  let d = 0
  for (let k = 0; k < kinds; k++) d = Math.max(d, Math.abs(sums[a * step + k] / sums[a * step + kinds] - sums[b * step + k] / sums[b * step + kinds]))
  return d
}

// まとめたパッチの根 (たどった道は半分にちぢめる)。
function find_root(root: Int32Array, a: number): number {
  while (root[a] !== a) a = root[a] = root[root[a]]
  return a
}

// となりあうパッチのうち、色ごとの濃さの差が 0.08 未満のものを1つにまとめる (同じ模様が、むらでいくつにも分かれて、
// まだらに見えないように)。60点に満たないパッチは、差が 0.15 未満なら、いちばん近い濃さのとなりへ入れる。
// となりの組は、はじめの差の小さい順 (同じ差は、絵の左上から見つけた順) に見る。
// パッチの濃さは、芯の点の平均 (芯のないパッチは、すべての点の平均)。まとめたあとのパッチの数を返す。
function merge_patches(patch: Int32Array, count: number, flat: Uint8Array, levels: Float32Array[], comp: Int32Array, w: number, h: number): number {
  const n = w * h
  const kinds = levels.length
  const step = kinds + 1
  const seeded = new Uint8Array(count + 1)
  for (let i = 0; i < n; i++) if (flat[i]) seeded[patch[i]] = 1
  // パッチごとの [色ごとの濃さの合計..., 数えた点の数]
  const sums = new Float64Array((count + 1) * step)
  const area = new Int32Array(count + 1)
  for (let i = 0; i < n; i++) {
    const id = patch[i]
    if (!id) continue
    area[id]++
    if (seeded[id] && !flat[i]) continue
    for (let k = 0; k < kinds; k++) sums[id * step + k] += levels[k][i]
    sums[id * step + kinds]++
  }
  // となりの組 (小さい番号 × (count + 1) + 大きい番号) を、見つけた順に集め、2回目からのものを除く。
  const found: number[] = []
  for (let i = 0; i < n; i++) {
    const a = patch[i]
    if (!a) continue
    const x = i % w
    for (let s = 0; s < 2; s++) {
      const t = s === 0 ? x < w - 1 ? i + 1 : -1 : i + w < n ? i + w : -1
      const b = t < 0 ? 0 : patch[t]
      if (!b || b === a || !same_region(comp, i, t)) continue
      found.push(Math.min(a, b) * (count + 1) + Math.max(a, b))
    }
  }
  const keys = Float64Array.from(found)
  const by_key = stable_order(keys, keys.length)
  const first = new Uint8Array(keys.length)
  for (let r = 0; r < by_key.length; r++) if (r === 0 || keys[by_key[r]] !== keys[by_key[r - 1]]) first[by_key[r]] = 1
  let edge_n = 0
  for (let e = 0; e < keys.length; e++) edge_n += first[e]
  const edge_a = new Int32Array(edge_n)
  const edge_b = new Int32Array(edge_n)
  const edge_d = new Float64Array(edge_n)
  for (let e = 0, o = 0; e < keys.length; e++) {
    if (!first[e]) continue
    edge_a[o] = Math.floor(keys[e] / (count + 1))
    edge_b[o] = keys[e] % (count + 1)
    edge_d[o] = patch_gap(sums, kinds, edge_a[o], edge_b[o])
    o++
  }
  const by_gap = stable_order(edge_d, edge_n)
  const root = new Int32Array(count + 1)
  for (let id = 0; id <= count; id++) root[id] = id
  for (let r = 0; r < edge_n; r++) {
    const ra = find_root(root, edge_a[by_gap[r]])
    const rb = find_root(root, edge_b[by_gap[r]])
    if (ra === rb) continue
    const d = patch_gap(sums, kinds, ra, rb)
    if (d >= 0.08 && (d >= 0.15 || Math.min(area[ra], area[rb]) >= 60)) continue
    root[rb] = ra
    for (let k = 0; k < step; k++) sums[ra * step + k] += sums[rb * step + k]
    area[ra] += area[rb]
  }
  const renum = new Int32Array(count + 1)
  let next = 0
  for (let id = 1; id <= count; id++) if (find_root(root, id) === id) renum[id] = ++next
  for (let i = 0; i < n; i++) if (patch[i]) patch[i] = renum[find_root(root, patch[i])]
  return next
}
