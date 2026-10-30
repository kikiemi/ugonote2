import { brush_spacing, tip_get } from '../brush'
import { pressed, q } from '../dom'
import { brush_defs, mode_dsi, mode_normal, sizes, t_pen, type pen_t } from '../h'
import { ds_down, ds_pen_brushes, ds_pen_pro_brushes, ds_round15, ds_round7, ds_sample, ds_samples, ds_seed, ds_seed_value, ds_state } from '../dsidraw'
import { tr_line } from '../lang'
import { nd_begin, nd_eraser_tip, nd_ink, nd_paint_tip, nd_pen, nd_pen_index, nd_rand_load, nd_rand_save, nd_seed, nd_state, nd_step, nd_surface } from '../nativedraw'
import { paint_active, paint_bit, paint_pattern } from '../paint'
import { native_eraser_tips, native_eraser_tips_for, native_paint_bucket, native_paint_labels, native_paint_labels_for, native_pen_tips, native_pen_tips_for, n_brush, n_dots, n_outline, n_pencil, n_spray, pen_quick_sizes } from '../penprofile'
import { pref_theme } from '../prefs'
import type { deep_ro_t } from '../state/store'
import { switch_row } from './templates/parts'

export function pen_quick_html(mode: number, tool: number): string {
  const sizes = pen_quick_sizes(mode, tool)
  let html = ''
  for (let i = 0; i < sizes.length; i++) {
    const n = sizes[i]
    html += '<button data-quick-size="' + n + '" aria-label="' + tr_line('ふとさ ' + n) + '" aria-pressed="false"><span style="width:' + Math.min(n, 18) + 'px;height:' + Math.min(n, 18) + 'px"></span><b>' + n + '</b></button>'
  }
  return html
}

// ふとさの丸い見本ボタン。
export function size_buttons(list: number[]): string {
  let html = ''
  for (const v of list) {
    const dot = Math.min(26, Math.max(4, v))
    html += `<button class="szb" id="sz_${v}" data-sz="${v}" title="太さ ${v}"><span class="size_ink"><span class="dot" style="width:${dot}px;height:${dot}px"></span></span><small>${v}</small></button>`
  }
  return html
}

export function native_pen_html(): string {
  let html = '<div id="native_pen_options" hidden>' + switch_row('native_pen_expand', 'plus', '拡張ペン先') + '<div class="brushgrid native_pen_grid" id="native_pen_grid">'
  for (const tip of native_pen_tips) html += '<button class="brushb" id="native_pen_' + tip.id + '" data-native-tip="' + tip.id + '" title="' + tip.label + '"><canvas width="28" height="28" data-native-preview="' + tip.id + '"></canvas><span>' + tip.label + '</span></button>'
  return html + '<button class="brushb" id="native_pen_font" title="文字"><b class="native_font">A</b><span>文字</span></button></div></div>'
}

export function native_eraser_html(): string {
  let html = '<div class="opt_head"><b>ケシゴムの形</b></div>' + switch_row('native_eraser_expand', 'plus', '拡張ケシゴム') + '<div class="brushgrid native_pen_grid" id="native_eraser_grid">'
  for (const tip of native_eraser_tips) html += '<button class="brushb" id="native_eraser_' + tip.id + '" data-native-eraser="' + tip.id + '" title="' + tip.label + '"><canvas width="28" height="28" data-eraser-preview="' + tip.id + '"></canvas><span>' + tip.label + '</span></button>'
  return html + '</div>'
}

export function native_paint_html(): string {
  let html = '<div class="opt_head"><b>ペイントのペン先</b></div><div class="brushgrid native_pen_grid" id="native_paint_grid">'
  for (let id = 0; id <= native_paint_bucket; id++) html += '<button class="brushb" id="native_paint_' + id + '" data-native-paint="' + id + '" title="' + native_paint_labels[id] + '"><canvas width="28" height="28" data-paint-preview="' + id + '"></canvas><span>' + native_paint_labels[id] + '</span></button>'
  return html + '</div>'
}

function canvas_words(cv: HTMLCanvasElement): { x: CanvasRenderingContext2D, img: ImageData, px: Uint32Array } {
  const x = cv.getContext('2d')!
  const img = x.createImageData(cv.width, cv.height)
  return { x, img, px: new Uint32Array(img.data.buffer) }
}

// ペン先の見本は実機と同じ処理で描く。点を打つだけのペンはしばらく押しとどめた形にする。
function native_preview(cv: HTMLCanvasElement, id: number, ink: string): void {
  if (cv.dataset.ink === ink) return
  const tip = native_pen_tips[id]
  const { x, img, px } = canvas_words(cv)
  const s = nd_surface(cv.width, cv.height, px, nd_ink(ink), paint_pattern(1, 0, null), 0)
  const st = nd_state(nd_pen, nd_pen_index(id), s)
  const saved = nd_rand_save()
  nd_seed(id * 7919 + 17)
  if (tip.shape === n_brush || tip.shape === n_outline) {
    const points: [number, number][] = []
    for (let i = 0; i <= 8; i++) points.push([5 + i * 2.25 | 0, 19 - i * 1.1 + Math.sin(i * 0.9) * 2 | 0])
    nd_begin(st, points[0][0], points[0][1])
    for (const [px0, py0] of points) nd_step(st, px0, py0)
  } else {
    const hold = tip.shape === n_dots ? (tip.id >= 8 ? 20 : 40) : tip.shape === n_pencil ? 10 : tip.shape === n_spray ? 3 : 1
    nd_begin(st, 14, 14)
    for (let i = 0; i < hold; i++) nd_step(st, 14, 14)
  }
  nd_rand_load(saved)
  x.putImageData(img, 0, 0)
  cv.dataset.ink = ink
}

// DSi のペン先の見本。実機と同じく1フレームに4回読んだとして、短い線を描く。描画用の乱数は元に戻す。
function ds_preview(cv: HTMLCanvasElement, id: number, ink: string): void {
  const key = 'dsi:' + ink
  if (cv.dataset.ink === key) return
  const { x, img, px } = canvas_words(cv)
  const s = nd_surface(cv.width, cv.height, px, nd_ink(ink), paint_pattern(1, 0, null), 0)
  const st = ds_state(s, id >= 8 ? ds_pen_pro_brushes[id & 7] : ds_pen_brushes[id & 7])
  const saved = ds_seed_value()
  ds_seed(0x1f01 + id * 97)
  const pts: [number, number][] = []
  for (let i = 0; i <= 10; i++) pts.push([4 + i * 2, Math.round(17 - i * 0.9 + Math.sin(i * 0.8) * 2)])
  ds_down(st, pts[0][0], pts[0][1])
  for (let i = 0; i < pts.length; i++) {
    st.start = i < ds_samples ? 1 : 0
    ds_sample(st, pts[i][0], pts[i][1])
  }
  ds_seed(saved)
  x.putImageData(img, 0, 0)
  cv.dataset.ink = key
}

// DSi のケシゴムの形 (点・四角3・丸7・丸15・四角7・四角15・たて線・よこ線)。
function ds_eraser_shape(id: number): { n: number, b: Uint8Array } {
  const k = id & 7
  if (k === 2) return { n: 7, b: ds_round7 }
  if (k === 3) return { n: 15, b: ds_round15 }
  const n = [1, 3, 7, 15, 7, 15, 15, 15][k]
  const b = new Uint8Array(n * n)
  const c = n >> 1
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) b[y * n + x] = k === 6 ? (x === c ? 1 : 0) : k === 7 ? (y === c ? 1 : 0) : 1
  return { n, b }
}

function mask_preview(cv: HTMLCanvasElement, key: string, n: number, b: Uint8Array, ink: string, on: (x: number, y: number) => number): void {
  if (cv.dataset.ink === key) return
  const { x, img, px } = canvas_words(cv)
  const word = nd_ink(ink)
  const o = (cv.width - n) >> 1
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (b[r * n + c] && on(o + c, o + r)) px[(o + r) * cv.width + o + c] = word
  x.putImageData(img, 0, 0)
  cv.dataset.ink = key
}

export function pen_palette_render(p: deep_ro_t<pen_t>, mode: number): void {
  const quick = q('quick_sizes')
  const quick_key = pen_quick_sizes(mode, p.tool).join(',')
  if (quick.dataset.sizes !== quick_key) {
    quick.innerHTML = pen_quick_html(mode, p.tool)
    quick.dataset.sizes = quick_key
  }
  for (const b of quick.querySelectorAll<HTMLElement>('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.quickSize) === p.size))
  q('quick_size_value').textContent = p.size + ' px'
  const native = mode !== mode_normal
  // うごメモ系の模様ブラシは、実機の丸いペン先の太さから選ぶ。
  const row = q('size_row')
  const list = native ? pen_quick_sizes(mode, t_pen) : sizes
  if (row.dataset.sizes !== list.join(',')) {
    row.innerHTML = size_buttons(list)
    row.dataset.sizes = list.join(',')
  }
  q('size_free').hidden = native
  const ink = pref_theme() ? '#EDF0F7' : '#343746'
  q('normal_pen_grid').hidden = native
  q('native_pen_options').hidden = !native
  q('native_pen_expand').setAttribute('aria-pressed', String(p.native_tip >= 8))
  const dsi = mode === mode_dsi
  for (const tip of native_pen_tips_for(mode)) {
    const button = q('native_pen_' + tip.id)
    if (button.dataset.mode !== String(mode)) {
      button.title = tip.label
      button.querySelector('span')!.textContent = tip.label
      button.dataset.mode = String(mode)
    }
    button.hidden = (tip.id >= 8) !== (p.native_tip >= 8)
    pressed(button, p.native_tip === tip.id)
    if (native && !button.hidden) {
      if (dsi) ds_preview(button.querySelector('canvas')!, tip.id, ink)
      else native_preview(button.querySelector('canvas')!, tip.id, ink)
    }
  }
  q('native_pen_font').hidden = dsi
  if (native) {
    const tile = paint_pattern(mode, p.pat, paint_active(mode, p.paint_tile, p.paint_tile_normal))
    const pattern_key = ink + ':' + mode + ':' + p.pat + ':' + (p.paint_tile ? p.paint_tile.w + 'x' + p.paint_tile.h + ':' + p.paint_tile.b.join('') : '')
    const expanded = p.native_eraser >= 8
    q('native_eraser_expand').setAttribute('aria-pressed', String(expanded))
    for (const tip of native_eraser_tips_for(mode)) {
      const button = q('native_eraser_' + tip.id)
      button.hidden = (tip.id >= 8) !== expanded
      pressed(button, p.native_eraser === tip.id)
      if (button.hidden) continue
      const shape = dsi ? ds_eraser_shape(tip.id) : nd_eraser_tip(tip.id)
      mask_preview(button.querySelector('canvas')!, (tip.id >= 8 ? pattern_key : ink) + ':' + mode, shape.n, shape.b, ink, (x, y) => tip.id >= 8 ? paint_bit(tile, x, y) : 1)
    }
    const paint_labels = native_paint_labels_for(mode)
    for (let id = 0; id <= native_paint_bucket; id++) {
      const button = q('native_paint_' + id)
      if (button.dataset.mode !== String(mode)) {
        button.title = paint_labels[id]
        button.querySelector('span')!.textContent = paint_labels[id]
        button.dataset.mode = String(mode)
      }
      pressed(button, p.native_paint === id)
      const n = dsi && id < native_paint_bucket ? [3, 7, 15][id] : 0
      const shape = n ? { n, b: new Uint8Array(n * n).fill(1) } : nd_paint_tip(id) || { n: 20, b: new Uint8Array(400).fill(1) }
      mask_preview(button.querySelector('canvas')!, pattern_key + ':' + mode, shape.n, shape.b, ink, (x, y) => paint_bit(tile, x, y))
    }
  }
  for (const b of brush_defs) {
    const button = q('brush_' + b.id)
    pressed(button, p.brush === b.id)
    if (native) continue
    const cv = button.querySelector('canvas')!
    if (cv.dataset.drawn === ink) continue
    const tip = tip_get(b.id, 6, ink, 0)
    const x = cv.getContext('2d')!
    x.clearRect(0, 0, cv.width, cv.height)
    for (let n = 6; n < 58; n += brush_spacing(b.id, 6)) x.drawImage(tip, n - tip.width / 2, 14 + Math.sin(n / 9) * 5 - tip.height / 2)
    cv.dataset.drawn = ink
  }
}
