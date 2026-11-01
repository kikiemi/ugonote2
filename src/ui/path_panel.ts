import { ease_at, ease_even, ease_slow_both, ease_slow_end, ease_slow_start } from '../aid/between'
import { hole_fill, path_at, path_make, type path_t } from '../aid/path'
import { ink_least, thing_at, thing_map_make, thing_mask, type thing_map_t } from '../aid/thing'
import { doc_frame_clone, doc_frame_order, doc_frame_paper, doc_layer_canvas, pack_canvas } from '../doc'
import { pointer_capture, query, toast } from '../dom'
import { mask_make, mask_poly_fill } from '../gfx'
import { l_p, type frame_t } from '../h'
import { tr_line } from '../lang'
import { canvas_make, clamp } from '../lib'
import { layer_name, mode_allows_layer_alpha, mode_frame_limit } from '../mode'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { aid_allowed, aid_seg, pk_locked } from './aid_panel'
import { modal_close, modal_progress, modal_set_cleanup } from './modal'
import { sheet_open } from './sheet'
import { choices, range_row, switch_row } from './templates/parts'

// 動かすものの決め方。
const how_auto = 0
const how_ring = 1
const how_layer = 2

// コマの使い方。
const use_add = 0
const use_over = 1

// 枚数の上限。
const count_max = 30
// 指を動かした距離がこれより短ければ (画面の点)、タップとして数える。
const tap_most = 8
// タップがものからこれだけ (画面の点) はずれても、そのものを選ぶ。
const tap_reach = 14
// 見本で、さいごのコマのあとに止まる秒数。
const rest_seconds = 0.6
// 横にならべるときに、操作の側に残す幅。
const controls_side = 280
// 輪の中の絵のうち、これより多くが「もの」なら、背景のレイヤーを切りとらない。
const ring_thing_least = 0.25

const path_color = '#FF6600'

// 前に選んだもの。
const path_choice = { use: use_add, count: 8, ease: ease_even, turn: 0, size: 100 }

// 動かす絵。mask が null ならレイヤー全体を動かす。src はもとのコマの点、piece は切りぬいた絵。
type cut_t = { layer: number, mask: Uint8Array | null, src: Uint32Array | null, piece: HTMLCanvasElement | null }

// 1枚分の動き。at は絵をとるコマ、u はみちすじの進み具合、ticks はそこまでの時間。
type step_t = { at: number, u: number, ticks: number }

// 画面の状態。
type view_t = {
  source: number
  // 読める絵のあるレイヤーの番号 (下から順) と、その点。
  ids: number[]
  pixels: Uint32Array[]
  map: thing_map_t
  how: number
  // 自動で選んでいるものの番号。
  picks: number[]
  // かこんだ線。only が 0 以上なら、そのレイヤーだけを切りとる。
  ring: number[] | null
  only: number
  layer: number
  path: path_t | null
  cuts: cut_t[]
  // 回すときの中心。
  cx: number
  cy: number
  steps: step_t[]
  // コマとレイヤーごとの絵。canvases はもとの絵、hollows は動かす絵をぬいた絵。
  canvases: Map<number, HTMLCanvasElement | null>
  hollows: Map<number, HTMLCanvasElement | null>
}

function layer_key(i: number, l: number): number {
  return i * 128 + l
}

function pixels_read(canvas: HTMLCanvasElement): Uint32Array {
  const x = canvas.getContext('2d') as CanvasRenderingContext2D
  return new Uint32Array(x.getImageData(0, 0, canvas.width, canvas.height).data.buffer)
}

function canvas_from(px: Uint32Array, w: number, h: number): HTMLCanvasElement {
  const [canvas, x] = canvas_make(w, h)
  const img = x.createImageData(w, h)
  new Uint32Array(img.data.buffer).set(px)
  x.putImageData(img, 0, 0)
  return canvas
}

function layer_canvas(v: view_t, i: number, l: number): HTMLCanvasElement | null {
  const key = layer_key(i, l)
  let canvas = v.canvases.get(key)
  if (canvas === undefined) {
    canvas = doc_layer_canvas(i, l)
    v.canvases.set(key, canvas)
  }
  return canvas
}

// 動かす絵をぬいた絵。ほかのコマでは、もとのコマと同じ点だけをぬく。
function hollow_canvas(v: view_t, cut: cut_t, i: number): HTMLCanvasElement | null {
  const g = st()
  const key = layer_key(i, cut.layer)
  let canvas = v.hollows.get(key)
  if (canvas !== undefined) return canvas
  const base = layer_canvas(v, i, cut.layer)
  canvas = null
  if (base && cut.mask && cut.src) {
    const px = pixels_read(base).slice()
    const hole = i === v.source ? cut.mask : cut.mask.slice()
    if (i !== v.source) for (let k = 0; k < px.length; k++) if (hole[k] && px[k] !== cut.src[k]) hole[k] = 0
    hole_fill(px, hole, g.doc.w)
    canvas = canvas_from(px, g.doc.w, g.doc.h)
  }
  v.hollows.set(key, canvas)
  return canvas
}

// 動かすレイヤーを描く。絵をぬいた上へ、動かした絵を置く。
function cut_draw(x: CanvasRenderingContext2D, v: view_t, cut: cut_t, step: step_t): void {
  const pose = [0, 0, 0]
  if (v.path) path_at(v.path, step.u, pose)
  const scale = 1 + (path_choice.size / 100 - 1) * step.u
  const turn = path_choice.turn ? pose[2] : 0
  const piece = cut.piece || layer_canvas(v, step.at, cut.layer)
  const hollow = cut.mask ? hollow_canvas(v, cut, step.at) : null
  if (hollow) x.drawImage(hollow, 0, 0)
  if (!piece) return
  x.save()
  // 向きも大きさも変えなければ、絵がぼけないよう点の上に置く。
  if (!turn && scale === 1) {
    x.imageSmoothingEnabled = false
    x.drawImage(piece, Math.round(pose[0]), Math.round(pose[1]))
  } else {
    x.imageSmoothingEnabled = true
    x.imageSmoothingQuality = 'high'
    x.translate(v.cx + pose[0], v.cy + pose[1])
    x.rotate(turn)
    x.scale(scale, scale)
    x.translate(-v.cx, -v.cy)
    x.drawImage(piece, 0, 0)
  }
  x.restore()
}

// step の絵を全部のレイヤーで描く。cuts のレイヤーだけ、絵を動かす。
function picture_draw(x: CanvasRenderingContext2D, v: view_t, step: step_t, cuts: readonly cut_t[]): void {
  const g = st()
  x.fillStyle = doc_frame_paper(step.at)
  x.fillRect(0, 0, g.doc.w, g.doc.h)
  const order = doc_frame_order(step.at)
  const list = [...order].reverse()
  list.unshift(l_p)
  for (let k = 0; k < list.length; k++) {
    const l = list[k]
    if (!g.doc.lvis[l]) continue
    x.globalAlpha = mode_allows_layer_alpha(g.doc.mode) ? g.doc.lalpha[l] / 255 : 1
    const cut = cuts.find(item => item.layer === l)
    if (cut) cut_draw(x, v, cut, step)
    else {
      const canvas = layer_canvas(v, step.at, l)
      if (canvas) x.drawImage(canvas, 0, 0)
    }
  }
  x.globalAlpha = 1
}

// 薄いふちの点も、となりが動く絵なら一緒に動かす。
function mask_soften(px: Uint32Array, mask: Uint8Array, w: number): void {
  const soft: number[] = []
  for (let i = w; i < px.length - w; i++) {
    if (mask[i] || !(px[i] >>> 24)) continue
    if (mask[i - 1] || mask[i + 1] || mask[i - w] || mask[i + w]) soft.push(i)
  }
  for (let k = 0; k < soft.length; k++) mask[soft[k]] = 1
}

// mask の絵を切りぬいて、動かす絵にする。
function cut_add(v: view_t, a: number, mask: Uint8Array): void {
  const g = st()
  const px = v.pixels[a]
  mask_soften(px, mask, g.doc.w)
  const words = new Uint32Array(px.length)
  let any = 0
  for (let i = 0; i < px.length; i++) {
    if (!mask[i] || !px[i]) continue
    words[i] = px[i]
    any = 1
  }
  if (any) v.cuts.push({ layer: v.ids[a], mask, src: px, piece: canvas_from(words, g.doc.w, g.doc.h) })
}

// かこんだ線の中の絵を切りとる。背景のレイヤーをまきこまないよう、ものがあればものだけにする。
function cuts_ring(v: view_t): void {
  const g = st()
  const n = g.doc.w * g.doc.h
  const region = mask_make(g.doc.w, g.doc.h)
  mask_poly_fill(region, v.ring as number[])
  let inks = 0
  let things = 0
  for (let a = 0; a < v.ids.length; a++) {
    if (v.only >= 0 && v.ids[a] !== v.only) continue
    const px = v.pixels[a]
    const label = v.map.labels[a]
    for (let i = 0; i < n; i++) {
      if (!region.b[i] || !(px[i] >>> 24)) continue
      inks++
      if (label[i]) things++
    }
  }
  const pure = v.only < 0 && things >= inks * ring_thing_least
  for (let a = 0; a < v.ids.length; a++) {
    if (v.only >= 0 && v.ids[a] !== v.only) continue
    const label = v.map.labels[a]
    const mask = new Uint8Array(n)
    for (let i = 0; i < n; i++) if (region.b[i] && (!pure || label[i])) mask[i] = 1
    cut_add(v, a, mask)
  }
}

// x, y に絵があるか。
function ink_at(v: view_t, x: number, y: number): number {
  const g = st()
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= g.doc.w || py >= g.doc.h) return 0
  for (let a = 0; a < v.pixels.length; a++) if (v.pixels[a][py * g.doc.w + px] >>> 24 >= ink_least) return 1
  return 0
}

// 動かす絵の中心。
function center_find(v: view_t): void {
  const g = st()
  let x0 = g.doc.w
  let y0 = g.doc.h
  let x1 = -1
  let y1 = -1
  const take = (px: Uint32Array, mask: Uint8Array | null): void => {
    for (let i = 0; i < px.length; i++) {
      if (!(px[i] >>> 24) || mask && !mask[i]) continue
      const x = i % g.doc.w
      const y = (i - x) / g.doc.w
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
  }
  for (let k = 0; k < v.cuts.length; k++) {
    const cut = v.cuts[k]
    const a = v.ids.indexOf(cut.layer)
    if (a >= 0) take(v.pixels[a], cut.mask)
  }
  v.cx = x1 < x0 ? g.doc.w / 2 : (x0 + x1 + 1) / 2
  v.cy = x1 < x0 ? g.doc.h / 2 : (y0 + y1 + 1) / 2
}

// 動かすものが変わったときに、動かす絵を作りなおす。
function cuts_make(v: view_t): void {
  const g = st()
  v.cuts = []
  v.hollows.clear()
  if (v.how === how_auto) {
    for (let a = 0; a < v.ids.length; a++) {
      const mask = new Uint8Array(g.doc.w * g.doc.h)
      if (thing_mask(v.map, v.picks, a, mask)) cut_add(v, a, mask)
    }
  } else if (v.how === how_ring) {
    if (v.ring) cuts_ring(v)
  } else if (v.ids.includes(v.layer)) {
    v.cuts.push({ layer: v.layer, mask: null, src: null, piece: null })
  }
  center_find(v)
}

// 動く順の表を作る。1つめは動く前の絵。
function steps_make(v: view_t): void {
  const g = st()
  const count = path_choice.count
  v.steps = [{ at: v.source, u: 0, ticks: 0 }]
  let ticks = 0
  if (path_choice.use === use_over) {
    let total = 0
    for (let k = 0; k < count; k++) total += g.doc.frames[v.source + k].hold
    for (let k = 1; k <= count; k++) {
      ticks += g.doc.frames[v.source + k - 1].hold
      v.steps.push({ at: v.source + k, u: ease_at(path_choice.ease, ticks / total), ticks })
    }
  } else {
    for (let k = 1; k <= count; k++) v.steps.push({ at: v.source, u: ease_at(path_choice.ease, k / count), ticks: k })
  }
}

// いまのコマの使い方で作れる枚数の上限。
function count_limit(v: view_t): number {
  const g = st()
  if (path_choice.use === use_over) return Math.min(count_max, g.doc.frames.length - 1 - v.source)
  return Math.min(count_max, mode_frame_limit(g.doc.mode) - g.doc.frames.length)
}

// コマを作って入れる。
function path_build(v: view_t): void {
  const g = st()
  const steps = v.steps
  const made: frame_t[] = []
  const progress = modal_progress('みちすじにそって動かしています')
  progress.note('絵を動かしています')
  let index = 1
  const finish = (): void => {
    progress.close()
    const had_sel = g.sel.has
    let result: number
    if (path_choice.use === use_over) {
      const list = g.doc.frames.slice() as frame_t[]
      for (let k = 0; k < made.length; k++) list[v.source + k + 1] = made[k]
      result = dispatch('frame.note_apply', { frames: list, fps: g.doc.fps })
    } else result = dispatch('frame.insert_steps', { at: v.source + 1, frames: made })
    if (result < 0) {
      toast('コマを作れませんでした')
      return
    }
    if (had_sel) dispatch('sel.clear', null)
    toast(made.length + 'コマ分、動かしました')
    sfx_play('paper')
  }
  const step = (): void => {
    const started = performance.now()
    while (index < steps.length && performance.now() - started < 20) {
      const item = steps[index]
      const frame = path_choice.use === use_over ? { ...g.doc.frames[item.at], pk: [...g.doc.frames[item.at].pk] } as frame_t : doc_frame_clone(g.doc.frames[v.source])
      if (path_choice.use === use_add) {
        frame.se = 0
        frame.hold = 1
      }
      for (let k = 0; k < v.cuts.length; k++) {
        const cut = v.cuts[k]
        if (pk_locked(g.doc.frames[item.at].pk[cut.layer])) continue
        const [canvas, x] = canvas_make(g.doc.w, g.doc.h, 1)
        cut_draw(x, v, cut, item)
        frame.pk[cut.layer] = pack_canvas(canvas, x)
      }
      made.push(frame)
      index++
    }
    progress.set((index - 1) / (steps.length - 1))
    if (index < steps.length) {
      setTimeout(step, 0)
      return
    }
    finish()
  }
  step()
}

// 動かすものが見えるように、まわりを薄くする。
function target_draw(x: CanvasRenderingContext2D, v: view_t): void {
  const g = st()
  x.fillStyle = 'rgba(255,255,255,0.72)'
  x.fillRect(0, 0, g.doc.w, g.doc.h)
  for (let k = 0; k < v.cuts.length; k++) {
    const cut = v.cuts[k]
    const piece = cut.piece || layer_canvas(v, v.source, cut.layer)
    if (piece) x.drawImage(piece, 0, 0)
  }
}

// みちすじと、コマごとの位置の印を描く。s は絵の1点の大きさ、unit は画面の1点の大きさ。
function path_draw(x: CanvasRenderingContext2D, v: view_t, s: number, unit: number): void {
  const p = v.path
  if (!p) return
  x.setTransform(s, 0, 0, s, 0, 0)
  x.lineCap = 'round'
  x.lineJoin = 'round'
  const stroke = (color: string, width: number): void => {
    x.strokeStyle = color
    x.lineWidth = width * unit
    x.beginPath()
    x.moveTo(p.xs[0], p.ys[0])
    for (let i = 1; i <= p.len; i++) x.lineTo(p.xs[i], p.ys[i])
    x.stroke()
  }
  stroke('#FFFFFF', 5)
  stroke(path_color, 2.5)
  const pose = [0, 0, 0]
  x.fillStyle = path_color
  x.strokeStyle = '#FFFFFF'
  x.lineWidth = 1.5 * unit
  for (let k = 0; k < v.steps.length; k++) {
    path_at(p, v.steps[k].u, pose)
    x.beginPath()
    x.arc(p.xs[0] + pose[0], p.ys[0] + pose[1], (k && k < v.steps.length - 1 ? 3 : 5) * unit, 0, Math.PI * 2)
    x.fill()
    x.stroke()
  }
}

// 指でなぞっている線を描く。
function stroke_draw(x: CanvasRenderingContext2D, pts: readonly number[], s: number, unit: number, close: number): void {
  if (pts.length < 4) return
  x.setTransform(s, 0, 0, s, 0, 0)
  x.lineCap = 'round'
  x.lineJoin = 'round'
  x.strokeStyle = path_color
  x.lineWidth = 2.5 * unit
  if (close) x.setLineDash([6 * unit, 4 * unit])
  x.beginPath()
  x.moveTo(pts[0], pts[1])
  for (let i = 2; i + 1 < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1])
  if (close) x.closePath()
  x.stroke()
  x.setLineDash([])
}

// 絵の下に出す案内。
function caption_text(v: view_t, ringing: number, stuck: number): string {
  if (stuck) return '背景とつながっています。指でかこんでください'
  if (ringing) return '動かすものを指でかこんでください'
  if (!v.cuts.length) {
    if (v.how === how_auto) return '見つかりません。「かこむ」で指定してください'
    return v.how === how_layer ? 'このレイヤーには絵がありません' : 'かこんだ所に絵がありません'
  }
  if (!v.path) return v.how === how_auto ? '動かすものから、みちすじをなぞってください' : 'みちすじをなぞってください'
  return v.how === how_auto ? 'タップで選び直せます。なぞると道を引き直せます' : 'なぞると、みちすじを引き直せます'
}

// ノーマルモードの便利機能。ものを選んで、なぞった道にそって動かす。
export function modal_aid_path(): void {
  if (!aid_allowed()) return
  if (st().flo.kind) dispatch('flo.confirm', null)
  dispatch('frame.sync_live', null)
  const g = st()
  const source = g.doc.cur
  const ids: number[] = []
  const pixels: Uint32Array[] = []
  const order = doc_frame_order(source)
  for (let k = order.length - 1; k >= 0; k--) {
    const l = order[k]
    const pk = g.doc.frames[source].pk[l]
    if (l === l_p || !g.doc.lvis[l] || !pk || pk_locked(pk)) continue
    const canvas = doc_layer_canvas(source, l)
    if (!canvas) continue
    ids.push(l)
    pixels.push(pixels_read(canvas))
  }
  if (!ids.length) {
    toast('動かす絵がありません')
    return
  }
  const map = thing_map_make(pixels, g.doc.w, g.doc.h)
  const v: view_t = {
    source, ids, pixels, map, how: how_auto, picks: map.best ? [map.best] : [], ring: null, only: -1,
    layer: ids.includes(g.pen.layer) ? g.pen.layer : ids[ids.length - 1], path: null, cuts: [], cx: 0, cy: 0, steps: [],
    canvases: new Map(), hollows: new Map(),
  }
  // 選択範囲があれば、それを動かす。
  if (g.sel.has) {
    v.how = how_ring
    v.only = ids.includes(g.pen.layer) ? g.pen.layer : -1
    v.ring = g.sel.poly ? [...g.sel.poly] : [g.sel.x, g.sel.y, g.sel.x + g.sel.w, g.sel.y, g.sel.x + g.sel.w, g.sel.y + g.sel.h, g.sel.x, g.sel.y + g.sel.h]
  }
  if (path_choice.use === use_over && !count_limit(v)) path_choice.use = use_add
  if (path_choice.use === use_add && !count_limit(v)) path_choice.use = use_over
  if (!count_limit(v)) {
    toast('コマ上限をこえるため作れません')
    return
  }
  path_choice.count = clamp(path_choice.count, 1, count_limit(v))
  const layer_list: [string, string][] = ids.slice().reverse().map(l => [String(l), layer_name(l)])
  const over_ok = g.doc.frames.length - 1 - source > 0
  const add_ok = g.doc.frames.length < mode_frame_limit(g.doc.mode)
  const box = sheet_open({
    icon: 'route',
    title: 'みちすじで動かす',
    cls: 'path_sheet',
    head: '<button class="pbtn primary" id="mp_go" disabled>つくる</button>',
    preview: '<canvas id="mp_view"></canvas><div class="sheet_caption" id="mp_note"></div>',
    pages: [
      {
        id: 'thing',
        icon: 'select',
        label: '動かすもの',
        body: `<section class="opt">
          ${choices('mp_how', 'how', [[String(how_auto), '自動'], [String(how_ring), 'かこむ'], [String(how_layer), 'レイヤー']])}
          <p class="mbody dim" id="mp_hint"></p>
          <div id="mp_layers" hidden>${choices('mp_layer', 'layer', layer_list)}</div>
        </section>`,
      },
      {
        id: 'frames',
        icon: 'film',
        label: 'コマ',
        body: `<section class="opt">
          ${choices('mp_use', 'use', [[String(use_add), '新しいコマをふやす'], [String(use_over), '次のコマから重ねる']])}
          ${range_row('mp_count', '枚数', 1, count_max, 1)}
        </section>`,
      },
      {
        id: 'motion',
        icon: 'wave',
        label: '動き方',
        body: `<section class="opt">
          <div class="opt_row"><span class="plab">ゆっくり</span>${choices('mp_ease', 'ease', [[String(ease_even), 'なし'], [String(ease_slow_start), 'はじめ'], [String(ease_slow_end), 'さいご'], [String(ease_slow_both), '両方']])}</div>
          ${switch_row('mp_turn', 'turn', '進む向きに回す')}
          ${range_row('mp_size', 'さいごの大きさ', 25, 200, 5)}
        </section>`,
      },
    ],
  })
  const view = query<HTMLCanvasElement>(box, '#mp_view')
  const note = query(box, '#mp_note')
  const hint = query(box, '#mp_hint')
  const layers = query(box, '#mp_layers')
  const go = query<HTMLButtonElement>(box, '#mp_go')
  const count_range = query<HTMLInputElement>(box, '#mp_count')
  const size_range = query<HTMLInputElement>(box, '#mp_size')
  const turn_switch = query(box, '#mp_turn')
  const x = view.getContext('2d') as CanvasRenderingContext2D
  // 絵の1点の大きさ (キャンバスの点)。
  let scale = 1
  // 画面の1点の大きさ (絵の点)。
  let unit = 1
  let raf = 0
  let drag = 0
  let drag_id = 0
  let ringing = 0
  // 自動では分けられなかった絵から、みちすじを引いたとき。
  let stuck = 0
  let moved = 0
  let stroke: number[] = []
  let began = performance.now()

  const fit = (): void => {
    const wrap = view.parentElement as HTMLElement
    view.style.width = '0px'
    view.style.height = '0px'
    const style = getComputedStyle(wrap)
    const side = getComputedStyle(box).display === 'grid'
    const pad_w = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
    const pad_h = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.rowGap) + note.offsetHeight
    const room_w = side ? box.clientWidth - controls_side - pad_w : wrap.clientWidth - pad_w
    const room_h = innerHeight - 24 - (side ? pad_h : box.offsetHeight)
    const fit_scale = Math.max(0.1, Math.min(room_w / g.doc.w, room_h / g.doc.h))
    const css_w = Math.floor(g.doc.w * fit_scale)
    const css_h = Math.floor(g.doc.h * fit_scale)
    const ratio = Math.min(2, devicePixelRatio || 1)
    view.style.width = css_w + 'px'
    view.style.height = css_h + 'px'
    view.width = Math.round(css_w * ratio)
    view.height = Math.round(css_h * ratio)
    scale = view.width / g.doc.w
    unit = ratio / scale
  }

  const draw = (now: number): void => {
    x.setTransform(1, 0, 0, 1, 0, 0)
    x.clearRect(0, 0, view.width, view.height)
    x.setTransform(scale, 0, 0, scale, 0, 0)
    x.imageSmoothingEnabled = scale < 1
    const ready = v.path && v.cuts.length && !drag
    let shown = v.steps[0]
    if (ready) {
      const last = v.steps[v.steps.length - 1]
      const total = last.ticks + Math.round(g.doc.fps * rest_seconds)
      const tick = Math.floor((now - began) * g.doc.fps / 1000) % total
      for (let k = 0; k < v.steps.length; k++) if (v.steps[k].ticks <= tick) shown = v.steps[k]
    }
    picture_draw(x, v, shown, ready ? v.cuts : [])
    if (!ready) target_draw(x, v)
    if (drag) stroke_draw(x, stroke, scale, unit, drag === 2 ? 1 : 0)
    else path_draw(x, v, scale, unit)
  }

  const loop = (now: number): void => {
    if (!box.isConnected) {
      raf = 0
      return
    }
    draw(now)
    raf = requestAnimationFrame(loop)
  }

  const sync = (): void => {
    note.textContent = tr_line(caption_text(v, ringing, stuck))
    go.disabled = !v.path || !v.cuts.length
    hint.hidden = v.how === how_layer
    layers.hidden = v.how !== how_layer
    hint.textContent = tr_line(v.how === how_auto ? '絵を見て分けます。タップで足したり外したりできます' : '線でかこんだ所を動かします。もう一度押すと、かこみ直せます')
    const limit = count_limit(v)
    count_range.max = String(limit)
    count_range.value = String(path_choice.count)
    query(box, '#mp_count_v').textContent = path_choice.count + '枚'
    size_range.value = String(path_choice.size)
    query(box, '#mp_size_v').textContent = path_choice.size + '%'
    turn_switch.setAttribute('aria-pressed', String(!!path_choice.turn))
    began = performance.now()
  }

  const target_changed = (): void => {
    cuts_make(v)
    sync()
  }

  const motion_changed = (): void => {
    steps_make(v)
    sync()
  }

  const how_pick = (how: number): void => {
    v.how = how
    ringing = how === how_ring ? 1 : 0
    if (how === how_ring) v.ring = null
    target_changed()
  }

  const point_of = (e: PointerEvent): [number, number] => {
    const rect = view.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width * g.doc.w
    const py = (e.clientY - rect.top) / rect.height * g.doc.h
    return [clamp(px, -g.doc.w, g.doc.w * 2), clamp(py, -g.doc.h, g.doc.h * 2)]
  }

  view.addEventListener('pointerdown', e => {
    if (drag) return
    e.preventDefault()
    drag_id = e.pointerId
    pointer_capture(view, e.pointerId)
    const [px, py] = point_of(e)
    drag = ringing ? 2 : 1
    moved = 0
    stroke = [px, py]
  })

  view.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag_id) return
    const [px, py] = point_of(e)
    moved = Math.max(moved, Math.hypot(px - stroke[0], py - stroke[1]) * scale)
    stroke.push(px, py)
  })

  const lift = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag_id) return
    const kind = drag
    drag = 0
    const tapped = moved < tap_most * (scale * unit)
    if (kind === 2) {
      if (tapped) return
      v.ring = stroke
      v.only = -1
      ringing = 0
      stuck = 0
      target_changed()
      sfx_play('tap')
      return
    }
    const hit = thing_at(v.map, stroke[0], stroke[1], Math.round(tap_reach * unit))
    const parted = v.how === how_auto && !hit && ink_at(v, stroke[0], stroke[1])
    if (!tapped) v.path = path_make(stroke)
    if (parted) {
      stuck = 1
      how_pick(how_ring)
      steps_make(v)
      sync()
      how_show()
      return
    }
    if (tapped) {
      if (v.how !== how_auto || !hit) return
      v.picks = v.picks.includes(hit) ? v.picks.filter(id => id !== hit) : [...v.picks, hit]
      target_changed()
      sfx_play('tap')
      return
    }
    if (v.how === how_auto && hit && !v.picks.includes(hit)) {
      v.picks = [hit]
      cuts_make(v)
    }
    motion_changed()
    sfx_play('tap')
  }
  view.addEventListener('pointerup', lift)
  view.addEventListener('pointercancel', e => {
    if (e.pointerId === drag_id) drag = 0
  })

  const how_show = (): void => {
    for (const button of box.querySelectorAll<HTMLElement>('[data-how]')) button.setAttribute('aria-pressed', String(Number(button.dataset.how) === v.how))
  }
  aid_seg(box, 'how', v.how, how => {
    stuck = 0
    how_pick(how)
  })
  aid_seg(box, 'layer', v.layer, value => {
    v.layer = value
    target_changed()
  })
  aid_seg(box, 'use', path_choice.use, value => {
    path_choice.use = value
    path_choice.count = clamp(path_choice.count, 1, count_limit(v))
    motion_changed()
  })
  aid_seg(box, 'ease', path_choice.ease, value => {
    path_choice.ease = value
    motion_changed()
  })
  for (const button of box.querySelectorAll<HTMLButtonElement>('[data-use]')) {
    const use = Number(button.dataset.use)
    if (use === use_over && !over_ok || use === use_add && !add_ok) button.disabled = true
  }
  count_range.addEventListener('input', () => {
    path_choice.count = clamp(Math.round(Number(count_range.value)), 1, count_limit(v))
    motion_changed()
  })
  size_range.addEventListener('input', () => {
    path_choice.size = clamp(Math.round(Number(size_range.value)), 25, 200)
    sync()
  })
  turn_switch.addEventListener('click', () => {
    path_choice.turn = path_choice.turn ? 0 : 1
    sync()
    sfx_play('tap')
  })
  go.addEventListener('click', () => {
    modal_close()
    path_build(v)
  })

  steps_make(v)
  cuts_make(v)
  sync()
  fit()
  const watcher = new ResizeObserver(fit)
  watcher.observe(box.parentElement as HTMLElement)
  raf = requestAnimationFrame(loop)
  modal_set_cleanup(() => {
    watcher.disconnect()
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  })
}
