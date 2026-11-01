// 絵の中の「もの」を見つける。線でつながった絵のかたまりを、1つのものとして数える。
// 背景の色、網かけ、画面の端から出ている線 (地面など) を取りのぞいてからかたまりに分ける。

// 1枚のレイヤーの分け方。label は点ごとのものの番号 (0 はどのものでもない)。
export type thing_map_t = {
  w: number
  h: number
  count: number
  // いちばん動かしたそうなものの番号。見つからなければ 0。
  best: number
  // レイヤーごとの番号。layers にわたしたならび。
  labels: Int32Array[]
  // いちばん上に見えているものの番号。
  top: Int32Array
}

// soft は網かけのかたまり。ほかのものの内側にあるときだけ、そのものの一部になる。
type part_t = { area: number, x0: number, y0: number, x1: number, y1: number, back: number, soft: number, up: number }

// これより薄い点は、絵として数えない。薄い影も一緒に動くよう、低くしておく。
export const ink_least = 4
// 1色がこの割合より広ければ、その色は背景とみなす。
const flat_least = 0.35
// 背景の色とみなす色のちがい。
const flat_near = 24
// 画面の端からこの割合より長くのびた線は、地面や帯とみなす。
const ground_least = 0.25
// 画面のこの割合より広がったかたまりは、背景とみなす。
const back_span = 0.9
// この割合より広い面をしめるかたまりは、背景とみなす。
const back_area = 0.6
// この割合より広い、かたまりにかこまれた所は、中身とみなさない。
const hole_most = 0.4
// ちがうレイヤーのものが、小さいほうのこの割合より重なれば、同じものとみなす。
const merge_least = 0.2
// ほかのものの線の内側にあるかを調べる点の数。
const inside_samples = 48
// 調べた点のこの割合が内側なら、同じものとみなす (線がとぎれていても、影や塗りを取りこぼさない)。
const inside_least = 0.8

function find(parts: part_t[], id: number): number {
  while (parts[id].up !== id) {
    parts[id].up = parts[parts[id].up].up
    id = parts[id].up
  }
  return id
}

function join(parts: part_t[], a: number, b: number): void {
  const ra = find(parts, a)
  const rb = find(parts, b)
  if (ra === rb) return
  const p = parts[ra]
  const q = parts[rb]
  q.up = ra
  p.area += q.area
  p.x0 = Math.min(p.x0, q.x0)
  p.y0 = Math.min(p.y0, q.y0)
  p.x1 = Math.max(p.x1, q.x1)
  p.y1 = Math.max(p.y1, q.y1)
  p.back |= q.back
  p.soft &= q.soft
}

// いちばん広い色。背景と言えるほど広くなければ -1。
function flat_color(px: Uint32Array): number {
  const hist = new Uint32Array(1 << 15)
  for (let i = 0; i < px.length; i++) {
    const word = px[i]
    if (word >>> 24 < 200) continue
    hist[(word >>> 3 & 31) | (word >>> 11 & 31) << 5 | (word >>> 19 & 31) << 10]++
  }
  let top = 0
  for (let key = 1; key < hist.length; key++) if (hist[key] > hist[top]) top = key
  if (hist[top] < px.length * flat_least) return -1
  return (top & 31) << 3 | 4 | (top >> 5 & 31) << 11 | 4 << 8 | (top >> 10 & 31) << 19 | 4 << 16
}

function color_near(word: number, flat: number): number {
  const dr = (word & 255) - (flat & 255)
  const dg = (word >>> 8 & 255) - (flat >>> 8 & 255)
  const db = (word >>> 16 & 255) - (flat >>> 16 & 255)
  return Math.abs(dr) <= flat_near && Math.abs(dg) <= flat_near && Math.abs(db) <= flat_near ? 1 : 0
}

// 背景の色ではない、描かれた点。
function solid_make(px: Uint32Array): Uint8Array {
  const flat = flat_color(px)
  const solid = new Uint8Array(px.length)
  for (let i = 0; i < px.length; i++) {
    const word = px[i]
    if (word >>> 24 < ink_least) continue
    if (flat >= 0 && color_near(word, flat)) continue
    solid[i] = 1
  }
  return solid
}

// 網かけの点を取りのぞく。上下左右につながらず、ななめの点が 0 か 3 以上の点 (斜めの線は 2 以下)。
function dots_clear(core: Uint8Array, w: number, h: number): void {
  const dots: number[] = []
  for (let y = 1; y < h - 1; y++) {
    const row = y * w
    for (let x = 1; x < w - 1; x++) {
      const i = row + x
      if (!core[i] || core[i - 1] || core[i + 1] || core[i - w] || core[i + w]) continue
      const side = core[i - w - 1] + core[i - w + 1] + core[i + w - 1] + core[i + w + 1]
      if (side === 0 || side >= 3) dots.push(i)
    }
  }
  for (let k = 0; k < dots.length; k++) core[dots[k]] = 0
}

// 画面の端から first, step の向きにのびた長い線を list へ入れる。
function run_mark(core: Uint8Array, first: number, step: number, count: number, least: number, list: number[]): void {
  let len = 0
  while (len < count && core[first + len * step]) len++
  if (len < least) return
  for (let k = 0; k < len; k++) list.push(first + k * step)
}

// 地面や帯を取りのぞく。立っている人の足がつながっていても、切りはなされる。
function ground_clear(core: Uint8Array, w: number, h: number): void {
  const list: number[] = []
  for (let y = 0; y < h; y++) {
    run_mark(core, y * w, 1, w, w * ground_least, list)
    run_mark(core, y * w + w - 1, -1, w, w * ground_least, list)
  }
  for (let x = 0; x < w; x++) {
    run_mark(core, x, w, h, h * ground_least, list)
    run_mark(core, (h - 1) * w + x, -w, h, h * ground_least, list)
  }
  for (let k = 0; k < list.length; k++) core[list[k]] = 0
}

// r だけ太らせる。
function spread(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const wide = new Uint8Array(src.length)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let last = -1 - r
    for (let x = 0; x < w; x++) {
      if (src[row + x]) last = x
      if (x - last <= r) wide[row + x] = 1
    }
    last = w + r
    for (let x = w - 1; x >= 0; x--) {
      if (src[row + x]) last = x
      if (last - x <= r) wide[row + x] = 1
    }
  }
  const out = new Uint8Array(src.length)
  for (let x = 0; x < w; x++) {
    let last = -1 - r
    for (let y = 0; y < h; y++) {
      if (wide[y * w + x]) last = y
      if (y - last <= r) out[y * w + x] = 1
    }
    last = h + r
    for (let y = h - 1; y >= 0; y--) {
      if (wide[y * w + x]) last = y
      if (last - y <= r) out[y * w + x] = 1
    }
  }
  return out
}

// つながった点に番号をつける。parts[0] は使わない。
function parts_label(mask: Uint8Array, w: number, h: number, label: Int32Array): part_t[] {
  const parts: part_t[] = [{ area: 0, x0: 0, y0: 0, x1: 0, y1: 0, back: 1, soft: 0, up: 0 }]
  const queue = new Int32Array(mask.length)
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue
    const id = parts.length
    const part: part_t = { area: 0, x0: w, y0: h, x1: 0, y1: 0, back: 0, soft: 0, up: id }
    parts.push(part)
    let head = 0
    let tail = 0
    queue[tail++] = start
    label[start] = id
    while (head < tail) {
      const i = queue[head++]
      const x = i % w
      const y = (i - x) / w
      part.x0 = Math.min(part.x0, x)
      part.y0 = Math.min(part.y0, y)
      part.x1 = Math.max(part.x1, x)
      part.y1 = Math.max(part.y1, y)
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const n = ny * w + nx
          if (!mask[n] || label[n]) continue
          label[n] = id
          queue[tail++] = n
        }
      }
    }
  }
  return parts
}

// 画面の大半に広がったかたまりや、3つ以上の辺にふれるかたまりは、背景とみなす。
function back_marks(parts: part_t[], core: Uint8Array, label: Int32Array, w: number, h: number): void {
  for (let i = 0; i < core.length; i++) if (core[i]) parts[label[i]].area++
  for (let id = 1; id < parts.length; id++) {
    const p = parts[id]
    const sides = (p.x0 === 0 ? 1 : 0) + (p.y0 === 0 ? 1 : 0) + (p.x1 === w - 1 ? 1 : 0) + (p.y1 === h - 1 ? 1 : 0)
    const wide = p.x1 - p.x0 + 1 >= w * back_span && p.y1 - p.y0 + 1 >= h * back_span
    if (sides >= 3 || wide || p.area >= core.length * back_area) p.back = 1
  }
}

// かたまりにかこまれた所を、そのものの中身にする。中にある別のかたまり (目など) も、同じものになる。
function holes_fill(parts: part_t[], label: Int32Array, w: number, h: number): void {
  const n = label.length
  const open = new Uint8Array(n)
  for (let i = 0; i < n; i++) open[i] = label[i] && !parts[label[i]].back ? 0 : 1
  const seen = new Uint8Array(n)
  const queue = new Int32Array(n)
  const flood = (start: number, keep: (i: number) => void): void => {
    let head = 0
    let tail = 0
    queue[tail++] = start
    seen[start] = 1
    while (head < tail) {
      const i = queue[head++]
      keep(i)
      const x = i % w
      if (x > 0 && open[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; queue[tail++] = i - 1 }
      if (x < w - 1 && open[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; queue[tail++] = i + 1 }
      if (i >= w && open[i - w] && !seen[i - w]) { seen[i - w] = 1; queue[tail++] = i - w }
      if (i + w < n && open[i + w] && !seen[i + w]) { seen[i + w] = 1; queue[tail++] = i + w }
    }
  }
  const nothing = (): void => {}
  for (let x = 0; x < w; x++) {
    if (open[x] && !seen[x]) flood(x, nothing)
    const low = (h - 1) * w + x
    if (open[low] && !seen[low]) flood(low, nothing)
  }
  for (let y = 0; y < h; y++) {
    if (open[y * w] && !seen[y * w]) flood(y * w, nothing)
    const end = y * w + w - 1
    if (open[end] && !seen[end]) flood(end, nothing)
  }
  for (let start = 0; start < n; start++) {
    if (!open[start] || seen[start]) continue
    let owner = 0
    const area: number[] = []
    const meet = (i: number): void => {
      const id = label[i]
      if (!id || parts[id].back) return
      if (owner) join(parts, owner, id)
      else owner = id
    }
    flood(start, i => {
      area.push(i)
      const x = i % w
      if (x > 0) meet(i - 1)
      if (x < w - 1) meet(i + 1)
      if (i >= w) meet(i - w)
      if (i + w < n) meet(i + w)
    })
    if (!owner || area.length > n * hole_most) continue
    for (let k = 0; k < area.length; k++) label[area[k]] = owner
  }
}

// 網かけの点を、かたまりにして表へ足す。線に使った点と、地面や帯の点はのぞく。
function soft_add(parts: part_t[], dots: Uint8Array, w: number, h: number, r: number, out: Int32Array): void {
  const label = new Int32Array(dots.length)
  const soft = parts_label(spread(dots, w, h, r), w, h, label)
  const shift = parts.length - 1
  for (let id = 1; id < soft.length; id++) parts.push({ ...soft[id], soft: 1, up: id + shift })
  for (let i = 0; i < dots.length; i++) if (dots[i] && !out[i]) out[i] = label[i] + shift
}

// レイヤーのものを見つける。out の点に番号を入れ、かたまりの表を返す。
function layer_parts(px: Uint32Array, w: number, h: number, out: Int32Array): part_t[] {
  const core = solid_make(px)
  const dots = core.slice()
  dots_clear(core, w, h)
  for (let i = 0; i < core.length; i++) if (core[i]) dots[i] = 0
  ground_clear(core, w, h)
  const r = Math.max(1, Math.round(Math.min(w, h) / 160))
  const wide = spread(core, w, h, r)
  const label = new Int32Array(px.length)
  const parts = parts_label(wide, w, h, label)
  back_marks(parts, core, label, w, h)
  holes_fill(parts, label, w, h)
  // 太らせた分はものに入れない。線そのものと、かこまれた所 (線の内側まで) だけを残す。
  const hole = new Uint8Array(px.length)
  for (let i = 0; i < px.length; i++) hole[i] = label[i] && !wide[i] ? 1 : 0
  const inner = spread(hole, w, h, r)
  for (let i = 0; i < px.length; i++) {
    const id = label[i] ? find(parts, label[i]) : 0
    out[i] = id && !parts[id].back && (core[i] || inner[i]) ? id : 0
  }
  soft_add(parts, dots, w, h, r, out)
  return parts
}

// i から dx, dy の向きへ進んで、owner の点に当たるか。
function ray_hit(owners: Int32Array, w: number, h: number, i: number, dx: number, dy: number, owner: number): number {
  let x = i % w
  let y = (i - x) / w
  for (;;) {
    x += dx
    y += dy
    if (x < 0 || y < 0 || x >= w || y >= h) return 0
    if (owners[y * w + x] === owner) return 1
  }
}

// i が owner の線の内側にあるか。上下左右の 3 つ以上の向きに線があれば、内側とみなす。
function ray_inside(owners: Int32Array, w: number, h: number, i: number, owner: number): number {
  const count = ray_hit(owners, w, h, i, 1, 0, owner) + ray_hit(owners, w, h, i, -1, 0, owner) + ray_hit(owners, w, h, i, 0, 1, owner) + ray_hit(owners, w, h, i, 0, -1, owner)
  return count >= 3 ? 1 : 0
}

// ほかのものの線の内側にあるものを、同じものにする。別のレイヤーの影や塗り、線がとぎれた絵の目など。
function inside_join(all: part_t[], labels: Int32Array[], w: number, h: number): void {
  const n = w * h
  const owners = new Int32Array(n)
  const size = new Int32Array(all.length)
  for (let a = 0; a < labels.length; a++) {
    for (let i = 0; i < n; i++) {
      if (!labels[a][i]) continue
      const id = find(all, labels[a][i])
      if (!all[id].soft) owners[i] = id
      size[id]++
    }
  }
  const points = new Map<number, number[]>()
  const seen = new Int32Array(all.length)
  for (let a = 0; a < labels.length; a++) {
    for (let i = 0; i < n; i++) {
      if (!labels[a][i]) continue
      const id = find(all, labels[a][i])
      const stride = Math.ceil(size[id] / inside_samples)
      if (seen[id]++ % stride) continue
      const list = points.get(id)
      if (list) list.push(i)
      else points.set(id, [i])
    }
  }
  const ids = [...points.keys()].sort((a, b) => size[a] - size[b])
  for (let k = 0; k < ids.length; k++) {
    const inner = all[ids[k]]
    const list = points.get(ids[k]) as number[]
    for (let m = ids.length - 1; m > k; m--) {
      const outer = all[ids[m]]
      if (outer.soft) continue
      if ((outer.x1 - outer.x0 + 1) * (outer.y1 - outer.y0 + 1) > n * hole_most) continue
      if (inner.x0 < outer.x0 || inner.y0 < outer.y0 || inner.x1 > outer.x1 || inner.y1 > outer.y1) continue
      let hits = 0
      for (let p = 0; p < list.length; p++) hits += ray_inside(owners, w, h, list[p], ids[m])
      if (hits < list.length * inside_least) continue
      join(all, ids[m], ids[k])
      break
    }
  }
}

// layers は下から順、1枚ずつ w × h の点 (RGBA)。
export function thing_map_make(layers: Uint32Array[], w: number, h: number): thing_map_t {
  const n = w * h
  const labels: Int32Array[] = []
  const all: part_t[] = [{ area: 0, x0: 0, y0: 0, x1: 0, y1: 0, back: 1, soft: 0, up: 0 }]
  for (let l = 0; l < layers.length; l++) {
    const label = new Int32Array(n)
    const parts = layer_parts(layers[l], w, h, label)
    const shift = all.length - 1
    for (let id = 1; id < parts.length; id++) {
      const p = parts[id]
      all.push({ ...p, up: find(parts, id) + shift })
    }
    for (let i = 0; i < n; i++) if (label[i]) label[i] += shift
    labels.push(label)
  }
  // 線と塗りが別のレイヤーでも、重なっていれば同じものにする。
  const overlap = new Map<number, number>()
  const size = new Int32Array(all.length)
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < labels.length; a++) {
      const p = labels[a][i]
      if (!p || all[p].soft) continue
      size[p]++
      for (let b = a + 1; b < labels.length; b++) {
        const q = labels[b][i]
        if (!q || all[q].soft) continue
        const key = p * all.length + q
        overlap.set(key, (overlap.get(key) || 0) + 1)
      }
    }
  }
  overlap.forEach((count, key) => {
    const q = key % all.length
    const p = (key - q) / all.length
    if (count >= Math.min(size[p], size[q]) * merge_least) join(all, p, q)
  })
  inside_join(all, labels, w, h)
  // 番号をつめる。
  const number = new Int32Array(all.length)
  let count = 0
  const area: number[] = [0]
  const edge: number[] = [0]
  const top = new Int32Array(n)
  for (let a = 0; a < labels.length; a++) {
    const label = labels[a]
    for (let i = 0; i < n; i++) {
      if (!label[i]) continue
      const root = find(all, label[i])
      if (all[root].soft) {
        label[i] = 0
        continue
      }
      if (!number[root]) {
        number[root] = ++count
        area.push(0)
        const p = all[root]
        edge.push((p.x0 === 0 ? 1 : 0) + (p.y0 === 0 ? 1 : 0) + (p.x1 === w - 1 ? 1 : 0) + (p.y1 === h - 1 ? 1 : 0))
      }
      const id = number[root]
      label[i] = id
      area[id]++
      top[i] = id
    }
  }
  let best = 0
  let best_score = 0
  for (let id = 1; id <= count; id++) {
    const score = area[id] / (1 + edge[id])
    if (score > best_score) {
      best_score = score
      best = id
    }
  }
  return { w, h, count, best, labels, top }
}

// x, y の近くのものの番号。reach の点までさがす。なければ 0。
export function thing_at(map: thing_map_t, x: number, y: number, reach: number): number {
  const px = Math.round(x)
  const py = Math.round(y)
  let best = 0
  let best_dist = reach * reach + 1
  for (let dy = -reach; dy <= reach; dy++) {
    const ny = py + dy
    if (ny < 0 || ny >= map.h) continue
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = px + dx
      if (nx < 0 || nx >= map.w) continue
      const id = map.top[ny * map.w + nx]
      const dist = dx * dx + dy * dy
      if (id && dist < best_dist) {
        best_dist = dist
        best = id
      }
    }
  }
  return best
}

// picks のものの点に 1 を立てる。layer は labels のならびの番号。点があれば 1 を返す。
export function thing_mask(map: thing_map_t, picks: readonly number[], layer: number, mask: Uint8Array): number {
  const label = map.labels[layer]
  let any = 0
  for (let i = 0; i < mask.length; i++) {
    if (!label[i] || !picks.includes(label[i])) continue
    mask[i] = 1
    any = 1
  }
  return any
}
