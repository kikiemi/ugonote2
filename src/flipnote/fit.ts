// うごメモの絵を、通常モードのキャンバスのどこへ、どの大きさで描くか。
// のばさないときは、そのままの形でまん中へ置く。のばすときは、キャンバスのほうが横長なら横に (縦長なら縦に) 広げる。
// のばした感じが出ないように、次の順で形をくずさないようにする。
// 1. 上下 (縦長なら左右) のはしに、絵のない所があれば、少し (1/10 まで) 切って、そのぶん大きく描く。
// 2. 線や形が少しでもある列 (行) はほとんどのばさず、絵のない列と、まん中よりはしの列を多くのばす。
// 3. のばし方はゆっくりかえる (急にかわると、そこで形がゆがんで見える)。
// のばし方は全コマで同じにする (コマごとにかわると、絵がゆれて見えるため)。

// xs (w+1 個) と ys (h+1 個) は、元の点のさかいめが、かき出す先のどこになるか。scale は線の太さに使う倍率。
export type fit_t = { xs: Float32Array, ys: Float32Array, scale: number }

// 両はしから切ってよい数。first は始まり側、last は終わり側。
type trim_t = { first: number, last: number }

// ink_x / ink_y は、列ごと・行ごとの、線や形のある割合 (0〜1)。
export function flip_fit(w: number, h: number, out_w: number, out_h: number, ink_x: Float64Array, ink_y: Float64Array, stretch: number): fit_t {
  if (stretch && out_w * h > out_h * w + out_h) {
    const cut = trim(ink_y, h - w * out_h / out_w)
    const scale = out_h / (h - cut.first - cut.last)
    return { xs: spread(ink_x, scale, out_w), ys: shift_edges(h, cut.first, scale), scale: scale }
  }
  if (stretch && out_h * w > out_w * h + out_w) {
    const cut = trim(ink_x, w - h * out_w / out_h)
    const scale = out_w / (w - cut.first - cut.last)
    return { xs: shift_edges(w, cut.first, scale), ys: spread(ink_y, scale, out_h), scale: scale }
  }
  const scale = Math.min(out_w / w, out_h / h)
  return { xs: even_edges(w, scale, out_w), ys: even_edges(h, scale, out_h), scale: scale }
}

// のばさない向きの、点のさかいめ。始まり側を cut 点切って、scale 倍にする。
function shift_edges(n: number, cut: number, scale: number): Float32Array {
  const edges = new Float32Array(n + 1)
  for (let i = 0; i <= n; i++) edges[i] = (i - cut) * scale
  return edges
}

// のばさないときの、点のさかいめ。n 点を scale 倍にして、out の長さのまん中へ置く。
function even_edges(n: number, scale: number, out: number): Float32Array {
  const off = (out - n * scale) / 2
  const edges = new Float32Array(n + 1)
  for (let i = 0; i <= n; i++) edges[i] = off + i * scale
  return edges
}

// from から step の向きへ、線や形がほとんどない所がいくつつづくか。
function empty_run(ink: Float64Array, from: number, step: number): number {
  const n = ink.length
  let count = 0
  for (let i = from; i >= 0 && i < n && ink[i] < 0.002; i += step) count++
  return count
}

// 両はしから切ってよい数。はしからつづく、線や形がほとんどない所だけを、
// 合わせて長さの 1/10 まで、かつ need (切ればのばさなくてすむ数) までにする。
function trim(ink: Float64Array, need: number): trim_t {
  const n = ink.length
  const a = empty_run(ink, 0, 1)
  const b = empty_run(ink, n - 1, -1)
  const total = Math.min(a + b, n * 0.1, Math.max(0, need))
  if (total <= 0) return { first: 0, last: 0 }
  const first = Math.floor(total * a / (a + b))
  return { first: first, last: Math.floor(total) - first }
}

// 1つの向きののばし方。全体は 1.5 倍まで (それより細長いキャンバスでは、のこりを紙のままにする)、1点は 2 倍まで。
function spread(ink: Float64Array, scale: number, out: number): Float32Array {
  const n = ink.length
  const total = Math.min(out / scale, n * 1.5)
  // 守る強さ。線や形が 1% (高さ 230 点なら 2 点ほど) あれば守り、そのまわり 4 点も守る (形のふちがのびないように)。
  const guard = new Float64Array(n)
  for (let i = 0; i < n; i++) guard[i] = Math.min(1, ink[i] / 0.01)
  const near = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let most = 0
    for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) most = Math.max(most, guard[j])
    near[i] = most
  }
  // のばしやすさ。守る所ほど小さく、まん中よりはしほど大きい (主役はまん中にいることが多いので)。
  let weight: Float64Array = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const g = near[i]
    const edge = Math.abs(i + 0.5 - n / 2) / (n / 2)
    weight[i] = (0.25 + 1.75 * edge * edge) * (0.02 + (1 - g) * (1 - g))
  }
  const r = Math.max(2, Math.round(n / 16))
  for (let pass = 0; pass < 3; pass++) weight = box_blur(weight, r)
  // 1点ごとの倍率。2 倍をこえた分は、ほかの点へまわす。
  const k = new Float64Array(n).fill(1)
  const open = new Uint8Array(n).fill(1)
  let extra = total - n
  for (let round = 0; round < 12 && extra > 1e-6; round++) {
    let sum = 0
    for (let i = 0; i < n; i++) if (open[i]) sum += weight[i]
    if (sum <= 0) break
    let left = 0
    for (let i = 0; i < n; i++) {
      if (!open[i]) continue
      k[i] += extra * weight[i] / sum
      if (k[i] < 2) continue
      left += k[i] - 2
      k[i] = 2
      open[i] = 0
    }
    extra = left
  }
  let k_sum = 0
  for (let i = 0; i < n; i++) k_sum += k[i]
  const edges = new Float32Array(n + 1)
  let at = (out - k_sum * scale) / 2
  for (let i = 0; i < n; i++) {
    edges[i] = at
    at += k[i] * scale
  }
  edges[n] = at
  return edges
}

// まわり r 点の平均 (はしでは、ある点だけで平均する)。のばし方がゆっくりかわるようにする。
function box_blur(src: Float64Array, r: number): Float64Array {
  const n = src.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) {
      sum += src[j]
      count++
    }
    out[i] = sum / count
  }
  return out
}
