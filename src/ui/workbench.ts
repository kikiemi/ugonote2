import { tr_line } from '../lang'
import { brush_spacing, tip_get } from '../brush'
import { q } from '../dom'
import { pat_canvas } from '../gfx'
import { B_MARKER, B_PEN, B_PENCIL, B_WATER, BRUSH_DEFS, T_ERASER, T_PEN, type Pen } from '../h'

type SamplePen = Pick<Pen, 'tool' | 'brush' | 'size' | 'color' | 'alpha' | 'pat'>
export function workbench_render(p: SamplePen): void {
  const eraser = p.tool === T_ERASER
  const hasSample = p.tool === T_PEN || eraser
  q('strokePreview').parentElement!.hidden = !hasSample
  q('popTool').dataset.sample = hasSample ? 'on' : 'off'
  q('strokeName').textContent = tr_line(eraser ? 'けしごむの見本' : BRUSH_DEFS.find(b => b.id === p.brush)?.label || 'ペン')
  q('strokeSize').textContent = `${p.size} px`
  q('colorPreview').style.background = p.color
  q('colorPreviewLabel').textContent = p.color.toUpperCase()
  const cv = q<HTMLCanvasElement>('strokePreview')
  const signature = [p.tool, p.brush, p.size, p.color, p.alpha, p.pat].join(':')
  if (cv.dataset.sample === signature) return
  const ctx = cv.getContext('2d')!
  ctx.clearRect(0, 0, cv.width, cv.height)
  const yAt = (x: number) => 50 + Math.sin((x - 40) / 560 * Math.PI * 3) * 15
  if (eraser || p.brush === B_PEN) {
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
      if (x === 40) ctx.moveTo(x, yAt(x))
      else ctx.lineTo(x, yAt(x))
    }
    ctx.stroke()
  } else {
    const buffered = p.brush === B_MARKER || p.brush === B_WATER
    ctx.globalAlpha = buffered ? 1 : p.alpha * (p.brush === B_PENCIL ? 0.9 : 1)
    const tip = tip_get(p.brush, p.size, p.color, 0)
    for (let x = 40; x < 600; x += brush_spacing(p.brush, p.size)) {
      ctx.drawImage(tip, x - tip.width / 2, yAt(x) - tip.height / 2)
    }
    if (buffered) {
      ctx.globalCompositeOperation = 'destination-in'
      ctx.globalAlpha = p.alpha * (p.brush === B_MARKER ? 0.5 : 0.85)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, cv.width, cv.height)
    }
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  cv.dataset.sample = signature
}
export function layer_stack_layout(): void {
  const stack = q('layerStack')
  const horizontal = getComputedStyle(stack).flexDirection === 'row'
  const overflow = horizontal ? stack.scrollWidth > stack.clientWidth + 1 : stack.scrollHeight > stack.clientHeight + 1
  stack.dataset.scroll = overflow ? horizontal ? 'x' : 'y' : ''
}
