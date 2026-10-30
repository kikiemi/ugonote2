import { paint_active, paint_pattern, pat_custom } from '../paint'
import { st } from '../state/store'
import { tr_line } from '../lang'
import { brush_spacing, tip_get } from '../brush'
import { q } from '../dom'
import { pat_canvas } from '../gfx'
import { nd_begin, nd_eraser, nd_ink, nd_pen, nd_pen_index, nd_rand_load, nd_rand_save, nd_seed, nd_state, nd_step, nd_surface } from '../nativedraw'
import { native_eraser_tips_for, native_pen_tip, pen_tool } from '../penprofile'
import { b_marker, b_pen, b_pencil, b_water, brush_defs, mode_dsi, mode_normal, t_eraser, t_patbrush, type pen_t } from '../h'
import { ds_box_of_pat, ds_down, ds_eraser_brushes, ds_pen_brushes, ds_pen_pro_brushes, ds_sample, ds_samples, ds_seed, ds_seed_value, ds_state } from '../dsidraw'

let sample_tile: ReturnType<typeof st>['pen']['paint_tile'] = null

type sample_pen_t = Pick<pen_t, 'tool' | 'brush' | 'size' | 'color' | 'alpha' | 'pat'>
export function workbench_render(p: sample_pen_t): void {
  const eraser = p.tool === t_eraser
  const has_sample = pen_tool(p.tool) || eraser
  q('stroke_preview').parentElement!.hidden = !has_sample
  q('pop_tool').dataset.sample = has_sample ? 'on' : 'off'
  const g = st()
  const native = g.doc.mode !== mode_normal
  const tip = native_pen_tip(g.pen.native_tip, g.doc.mode)
  const etips = native_eraser_tips_for(g.doc.mode)
  const etip = etips[g.pen.native_eraser] || etips[2]
  const pen_name = p.tool === t_patbrush ? '模様ブラシ' : native ? tip.label : brush_defs.find(b => b.id === p.brush)?.label || 'ペン'
  q('stroke_name').textContent = tr_line(eraser ? (native ? 'けしごむ ' + etip.label : 'けしごむの見本') : pen_name)
  q('stroke_size').textContent = `${native && eraser ? etip.size : p.size} px`
  q('color_preview').style.background = p.color
  q('color_preview_label').textContent = p.color.toUpperCase()
  const cv = q<HTMLCanvasElement>('stroke_preview')
  const tile = paint_active(g.doc.mode, g.pen.paint_tile, g.pen.paint_tile_normal)
  const signature = [p.tool, p.brush, p.size, p.color, p.alpha, p.pat, g.doc.mode, native ? tip.id : -1, native ? etip.id : -1, g.pen.outline, g.pen.owidth, g.pen.ocolor].join(':')
  if (cv.dataset.sample === signature && (p.pat !== pat_custom || sample_tile === tile)) return
  sample_tile = tile
  const ctx = cv.getContext('2d')!
  ctx.clearRect(0, 0, cv.width, cv.height)
  const y_at = (x: number) => 50 + Math.sin((x - 40) / 560 * Math.PI * 3) * 15
  if (native) {
    // 実機と同じ処理で、1フレームに3pxずつ動かしたときの線を2倍で見せる。
    const w = cv.width >> 1
    const h = cv.height >> 1
    const img = ctx.createImageData(w, h)
    const px = new Uint32Array(img.data.buffer)
    if (eraser) px.fill(nd_ink('#858B98'), w * 8, w * (h - 8))
    const s = nd_surface(w, h, px, nd_ink(p.color), paint_pattern(g.doc.mode, p.pat, tile), 0)
    if (!eraser && p.pat) s.mask = s.tile
    const yy = (x: number) => Math.round(y_at(x * 2) / 2)
    if (g.doc.mode === mode_dsi) {
      // DSi は1フレームに4回読むので、3px/フレームなら1回に0.75pxずつ進む。描画用の乱数は元に戻す。
      const id = eraser ? etip.id : tip.id
      const ds = ds_state(s, eraser ? ds_eraser_brushes[id & 7] : id >= 8 ? ds_pen_pro_brushes[id & 7] : ds_pen_brushes[id & 7])
      ds.pat_erase = eraser && id >= 8 ? 1 : 0
      ds.pat = Math.max(0, ds_box_of_pat(p.pat))
      const saved = ds_seed_value()
      ds_seed(4099)
      ds_down(ds, 20, yy(20))
      let i = 0
      for (let x = 20; x <= 300; x += 0.75, i++) {
        ds.start = i < ds_samples ? 1 : 0
        ds_sample(ds, Math.round(x), yy(Math.round(x)))
      }
      ds_seed(saved)
    } else {
      const pen = nd_state(eraser ? nd_eraser : nd_pen, eraser ? etip.id : nd_pen_index(tip.id), s)
      const saved = nd_rand_save()
      nd_seed(4099)
      nd_begin(pen, 20, yy(20))
      for (let x = 20; x <= 300; x += 3) nd_step(pen, x, yy(x))
      nd_rand_load(saved)
    }
    const buf = document.createElement('canvas')
    buf.width = w
    buf.height = h
    buf.getContext('2d')!.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(buf, 0, 0, w * 2, h * 2)
  } else if (eraser || p.brush === b_pen) {
    if (eraser) {
      ctx.fillStyle = '#858b98'
      ctx.fillRect(24, 10, 592, 80)
      ctx.globalCompositeOperation = 'destination-out'
    }
    ctx.strokeStyle = p.pat ? ctx.createPattern(pat_canvas(p.pat, eraser ? '#000' : p.color), 'repeat')! : p.color
    ctx.globalAlpha = p.alpha
    ctx.lineWidth = p.size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    for (let x = 40; x <= 600; x += 2) {
      if (x === 40) ctx.moveTo(x, y_at(x))
      else ctx.lineTo(x, y_at(x))
    }
    ctx.stroke()
  } else {
    const buffered = p.brush === b_marker || p.brush === b_water
    ctx.globalAlpha = buffered ? 1 : p.alpha * (p.brush === b_pencil ? 0.9 : 1)
    const tip = tip_get(p.brush, p.size, p.color, 0)
    for (let x = 40; x < 600; x += brush_spacing(p.brush, p.size)) {
      ctx.drawImage(tip, x - tip.width / 2, y_at(x) - tip.height / 2)
    }
    if (buffered) {
      ctx.globalCompositeOperation = 'destination-in'
      ctx.globalAlpha = p.alpha * (p.brush === b_marker ? 0.5 : 0.85)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, cv.width, cv.height)
    }
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  cv.dataset.sample = signature
}
