import { paint_active, pat_custom } from '../paint'
import { st } from '../state/store'
import { tr_line } from '../lang'
import { brush_spacing, tip_get } from '../brush'
import { q } from '../dom'
import { pat_canvas } from '../gfx'
import { native_pen_begin, native_pen_paint, native_pen_point } from '../nativepen'
import { native_pen_tip } from '../penprofile'
import { b_marker, b_pen, b_pencil, b_water, brush_defs, mode_normal, t_eraser, t_pen, type pen_t } from '../h'

let sample_tile: ReturnType<typeof st>['pen']['paint_tile'] = null

type sample_pen_t = Pick<pen_t, 'tool' | 'brush' | 'size' | 'color' | 'alpha' | 'pat'>
export function workbench_render(p: sample_pen_t): void {
  const eraser = p.tool === t_eraser
  const has_sample = p.tool === t_pen || eraser
  q('stroke_preview').parentElement!.hidden = !has_sample
  q('pop_tool').dataset.sample = has_sample ? 'on' : 'off'
  const g = st()
  const native = g.doc.mode !== mode_normal && !eraser
  const tip = native_pen_tip(g.pen.native_tip)
  q('stroke_name').textContent = tr_line(eraser ? 'けしごむの見本' : native ? tip.label : brush_defs.find(b => b.id === p.brush)?.label || 'ペン')
  q('stroke_size').textContent = `${p.size} px`
  q('color_preview').style.background = p.color
  q('color_preview_label').textContent = p.color.toUpperCase()
  const cv = q<HTMLCanvasElement>('stroke_preview')
  const tile = paint_active(g.doc.mode, g.pen.paint_tile, g.pen.paint_tile_normal)
  const signature = [p.tool, p.brush, p.size, p.color, p.alpha, p.pat, g.doc.mode, native ? tip.id : -1, g.pen.outline, g.pen.owidth, g.pen.ocolor].join(':')
  if (cv.dataset.sample === signature && (p.pat !== pat_custom || sample_tile === tile)) return
  sample_tile = tile
  const ctx = cv.getContext('2d')!
  ctx.clearRect(0, 0, cv.width, cv.height)
  const y_at = (x: number) => 50 + Math.sin((x - 40) / 560 * Math.PI * 3) * 15
  if (native) {
    const stroke = native_pen_begin(cv.width, cv.height, null)
    for (let x = 40; x < 600; x += 2) native_pen_point(stroke, tip, x, y_at(x), x + 2, y_at(x + 2))
    native_pen_paint(ctx, stroke.mask, g.pen)
  } else if (eraser || p.brush === b_pen) {
    if (eraser) {
      ctx.fillStyle = '#858b98'
      ctx.fillRect(24, 10, 592, 80)
      ctx.globalCompositeOperation = 'destination-out'
    }
    ctx.strokeStyle = p.pat ? ctx.createPattern(pat_canvas(p.pat, eraser ? '#000' : p.color), 'repeat')! : p.color
    ctx.globalAlpha = eraser ? 1 : p.alpha
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
