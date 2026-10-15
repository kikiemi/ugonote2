import { pixel_source_ready, pixel_source_prepare } from '../pixel_source'
import { workspace_writing_overlap, type workspace_rect_t } from './workspace_policy'
import { pointer_capture, pointer_release, q, toast } from '../dom'
import { d_grid, d_pen, d_stage, d_tools, t_eraser, t_fill, t_hand, t_lasso, t_paste, t_pen, t_pixel, t_select, t_text, zoom_max, zoom_min } from '../h'
import { clamp } from '../lib'
import { h_move, h_none, flo_active, flo_drag_end, flo_drag_start, flo_dragging, flo_hit, sel_move } from '../sel'
import { scratch_move, scratch_start, scratch_stop, sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { anim_playing } from '../state/commands/play'
import { dirty, st } from '../state/store'
import { pref_hide_controls } from '../prefs'
import { stroke_flush, tool_cancel, tool_down, tool_eyedrop, tool_fill, tool_is_stroking, tool_move_pt, tool_up } from '../tool'
import { modal_text } from './modal'
import { ctx_show, pop_close, rail_sheet } from './overlay'
import { anim_pending, anim_stop } from './playback'

function rgb_of(v: [number, number, number]): { r: number, g: number, b: number } {
  return { r: v[0], g: v[1], b: v[2] }
}
let panning = 0

let pan_start = [0, 0, 0, 0]

let stroke_pid = -1
let fill_tap: { pointer_id: number, bx: number, by: number, wx: number, wy: number } | null = null
let text_tap: { pointer_id: number, bx: number, by: number, wx: number, wy: number } | null = null
let control_press: PointerEvent | null = null
let control_click: { id: number, until: number } | null = null

let selecting = 0

const ptrs = new Map<number, [number, number]>()

const captured_pointers = new Set<number>()

let pinch0 = 0

let pinch_z = 1

let pinch_mid = [0, 0]

let pinch_pan = [0, 0]

let last_ptr_type = 'mouse'

let lp_timer: ReturnType<typeof setTimeout> | 0 = 0

let lp_done = 0

let lp_at = [0, 0]

let flo_mode = h_none

let interrupting = 0

let scr_last: number[] = [-1, -1]

export function wrap_xy(e: PointerEvent | WheelEvent | MouseEvent): [number, number] {
  const r = q('stage_wrap').getBoundingClientRect()
  let sx = e.clientX - r.left
  if (st().view.flip) sx = r.width - sx
  return [sx, e.clientY - r.top]
}

export function board_xy(e: PointerEvent | WheelEvent | MouseEvent): [number, number] {
  const g = st()
  const [sx, sy] = wrap_xy(e)
  return [(sx - g.view.px) / g.view.z, (sy - g.view.py) / g.view.z]
}

export function tool_pick(t: number, repeat = 1): void {
  const g = st()
  if (tool_is_stroking() || ptrs.size || stroke_pid >= 0 || panning) return
  if (q('rail').classList.contains('on')) rail_sheet(0)
  pop_close()
  if (flo_active()) dispatch('flo.cancel', null)
  if (t === t_paste) {
    if (!g.clip) {
      toast('さきに「はんい」でコピーしてね')
      return
    }
    dispatch('pen.set_tool', t)
    dispatch('flo.begin_paste', { repeat })
    sfx_play('tap')
    return
  }
  dispatch('pen.set_tool', t)
  dirty(d_tools | d_pen | d_grid)
  sfx_play('tap')
  if (t === t_text) modal_text(g.doc.w / 2, g.doc.h / 2)
}

function lp_clear(): void {
  if (lp_timer) clearTimeout(lp_timer)
  lp_timer = 0
}

function pointer_active(pointer_id: number): number {
  return ptrs.has(pointer_id) || captured_pointers.has(pointer_id) || stroke_pid === pointer_id ? 1 : 0
}

function writing_controls_hide(): void {
  if (!pref_hide_controls()) return
  const g = st()
  const wrap = q('stage_wrap').getBoundingClientRect()
  const width = g.doc.w * g.view.z
  const height = g.doc.h * g.view.z
  const left = wrap.left + (g.view.flip ? wrap.width - g.view.px - width : g.view.px)
  const top = wrap.top + g.view.py
  const paper = { left: Math.max(0, wrap.left, left), top: Math.max(0, wrap.top, top), right: Math.min(innerWidth, wrap.right, left + width), bottom: Math.min(innerHeight, wrap.bottom, top + height) }
  const controls: workspace_rect_t[] = []
  for (const element of document.querySelectorAll<HTMLElement>('#hd button,#mobile_tools button,#layer_stack button,#tl button,#frame_panel,#fs,#layout_choices,#focus_btn,.pop.on,#rail.on')) {
    if (element.hidden || !element.getClientRects().length) continue
    const style = getComputedStyle(element)
    if (style.visibility === 'hidden' || style.display === 'none') continue
    const rect = element.getBoundingClientRect()
    controls.push({ left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) })
  }
  if (workspace_writing_overlap(innerWidth, innerHeight, paper, controls, document.body.dataset.layout)) document.body.classList.add('canvas_writing')
}

export function stage_interrupt(): void {
  control_press = null
  control_click = null
  document.body.classList.remove('canvas_writing')
  if (interrupting) return
  const selection_pointer = selecting
  const floating_drag = flo_mode !== h_none || flo_dragging() !== 0
  if (!ptrs.size && !captured_pointers.size && !panning && stroke_pid < 0 && !selecting && !lp_timer && !tool_is_stroking() && !floating_drag) return
  const wrap = q('stage_wrap')
  const captured = [...captured_pointers]
  interrupting = 1
  ptrs.clear()
  captured_pointers.clear()
  lp_clear()
  lp_done = 0
  panning = 0
  pan_start = [0, 0, 0, 0]
  stroke_pid = -1
  fill_tap = null
  text_tap = null
  selecting = 0
  pinch0 = 0
  pinch_z = 1
  pinch_mid = [0, 0]
  pinch_pan = [0, 0]
  flo_mode = h_none
  scr_last = [-1, -1]
  try {
    scratch_stop()
    if (floating_drag) flo_drag_end()
    if (selection_pointer) dispatch('sel.clear', null)
    if (tool_is_stroking()) tool_cancel()
  } finally {
    for (const pointer_id of captured) pointer_release(wrap, pointer_id)
    interrupting = 0
  }
}

export function stage_lost_capture(e: PointerEvent): void {
  if (e.target !== e.currentTarget) return
  captured_pointers.delete(e.pointerId)
  if (!interrupting && pointer_active(e.pointerId)) stage_interrupt()
}

export function stage_pointer_out(e: PointerEvent): void {
  if (e.relatedTarget !== null || captured_pointers.has(e.pointerId) || !pointer_active(e.pointerId)) return
  stage_interrupt()
}

function pinch_begin(): void {
  document.body.classList.remove('canvas_writing')
  const g = st()
  if (tool_is_stroking()) tool_cancel()
  lp_clear()
  const pts = [...ptrs.values()]
  const dx = pts[0][0] - pts[1][0]
  const dy = pts[0][1] - pts[1][1]
  pinch0 = Math.max(8, Math.hypot(dx, dy))
  pinch_z = g.view.z
  pinch_mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
  pinch_pan = [g.view.px, g.view.py]
}

function pinch_move(): void {
  const pts = [...ptrs.values()]
  const dx = pts[0][0] - pts[1][0]
  const dy = pts[0][1] - pts[1][1]
  const d = Math.max(8, Math.hypot(dx, dy))
  const mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
  const nz = clamp(pinch_z * (d / pinch0), zoom_min, zoom_max)
  const bx = (pinch_mid[0] - pinch_pan[0]) / pinch_z
  const by = (pinch_mid[1] - pinch_pan[1]) / pinch_z
  dispatch('view.set_viewport', { z: nz, px: mid[0] - bx * nz, py: mid[1] - by * nz })
}

function eyedrop_tool(): number {
  const g = st()
  return g.pen.tool === t_pen || g.pen.tool === t_eraser || g.pen.tool === t_pixel ? 1 : 0
}

function over_ui(e: Event): number {
  if ((e.target as HTMLElement).closest('#layout_choices, #studio_quick')) return 1
  const t = e.target as HTMLElement
  return t && t.closest && t.closest('#quick, #live_layer_tabs, #sel_bar, #flo_bar, .pop, #rail, #zoom_label') ? 1 : 0
}

function control_on_board(e: PointerEvent): boolean {
  if (document.body.dataset.drawingLayout === 'full') return false
  const commands = (e.target as HTMLElement).closest<HTMLElement>('#frame_operations')
  if (e.pointerType === 'touch' && commands && commands.scrollWidth > commands.clientWidth + 1) return false
  const stack = (e.target as HTMLElement).closest<HTMLElement>('#layer_stack')
  if (e.pointerType === 'touch' && stack?.dataset.scroll) return false
  if (!(e.target as HTMLElement).closest('#quick, #layer_stack, #live_layer_tabs, #dock, #hd, #tl_bar, #frame_panel, #focus_btn')) return false
  const r = q('stage_wrap').getBoundingClientRect()
  if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) return false
  const [x, y] = board_xy(e)
  return x >= 0 && y >= 0 && x < st().doc.w && y < st().doc.h
}
export function stage_pen_down(e: PointerEvent): void {
  control_click = null
  if (e.pointerType === 'touch' && ptrs.size && control_on_board(e)) {
    control_press = null
    e.preventDefault()
    e.stopImmediatePropagation()
    stage_down(e, true)
    return
  }
  if (e.pointerType === 'touch' && control_press && control_press.pointerId !== e.pointerId) {
    const first = control_press
    control_press = null
    stage_down(first, true)
    if (control_on_board(e)) {
      e.preventDefault()
      e.stopImmediatePropagation()
      stage_down(e, true)
      return
    }
  }
  if (e.button !== 0 || !control_on_board(e)) return
  if (e.pointerType !== 'pen') {
    control_press = e
    return
  }
  e.preventDefault()
  e.stopImmediatePropagation()
  control_click = { id: e.pointerId, until: performance.now() + 60000 }
  stage_down(e, true)
}

export function stage_control_move(e: PointerEvent): void {
  if (!control_press || control_press.pointerId !== e.pointerId) return
  if (Math.hypot(e.clientX - control_press.clientX, e.clientY - control_press.clientY) < 7) return
  const first = control_press
  control_press = null
  first.target?.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: e.pointerId, pointerType: e.pointerType }))
  control_click = { id: e.pointerId, until: performance.now() + 60000 }
  stage_down(first, true)
}

export function stage_control_up(e: PointerEvent): void {
  if (control_press?.pointerId === e.pointerId) {
    const press = control_press
    control_press = null
    const button = press.target instanceof Element ? press.target.closest<HTMLButtonElement>('button') : null
    if (e.type === 'pointerup' && press.pointerType === 'touch' && button && !button.disabled) {
      const r = button.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom) {
        control_click = null
        button.click()
        control_click = { id: e.pointerId, until: performance.now() + 500 }
      }
    }
  }
  if (control_click?.id === e.pointerId) control_click.until = performance.now() + 500
}

export function stage_control_click(e: MouseEvent): void {
  if (!control_click || performance.now() > control_click.until) return
  if ('pointerId' in e && (e as PointerEvent).pointerId !== control_click.id) return
  e.preventDefault()
  e.stopImmediatePropagation()
  control_click = null
}

export function stage_down(e: PointerEvent, through_control = false): void {
  const g = st()
  last_ptr_type = e.pointerType
  if (over_ui(e) && !through_control) return
  if (e.button === 2) return
  if (!pixel_source_ready(g.doc.frames[g.doc.cur])) {
    void pixel_source_prepare(g.doc.frames[g.doc.cur]).catch(() => {})
    toast('動画のコマを準備中です。表示されてから描いてください')
    return
  }
  if (anim_pending()) anim_stop()
  if (ptrs.has(e.pointerId)) stage_interrupt()
  const wrap = q('stage_wrap')
  if (pointer_capture(wrap, e.pointerId)) captured_pointers.add(e.pointerId)
  else captured_pointers.delete(e.pointerId)
  const [wx, wy] = wrap_xy(e)
  ptrs.set(e.pointerId, [wx, wy])
  if (ptrs.size === 2) {
    fill_tap = null
    text_tap = null
    document.body.classList.remove('canvas_writing')
    scratch_stop()
    if (tool_is_stroking()) tool_cancel()
    else if (selecting) dispatch('sel.clear', null)
    panning = 0
    stroke_pid = -1
    selecting = 0
    flo_mode = h_none
    flo_drag_end()
    pinch_begin()
    return
  }
  if (ptrs.size > 2) return
  if (e.button === 1 || g.pen.tool === t_hand) {
    panning = 1
    pan_start = [wx, wy, g.view.px, g.view.py]
    return
  }
  const [bx, by] = board_xy(e)
  if (flo_active()) {
    const hit = flo_hit(bx, by)
    if (hit === h_none) {
      dispatch('flo.confirm', null)
      return
    }
    flo_mode = hit
    flo_drag_start(hit, bx, by)
    stroke_pid = e.pointerId
    return
  }
  if (anim_playing()) {
    anim_stop()
    return
  }
  if (g.pen.tool === t_text) {
    if (e.pointerType === 'touch') {
      text_tap = { pointer_id: e.pointerId, bx, by, wx, wy }
      return
    }
    modal_text(bx, by)
    return
  }
  if (g.pen.tool === t_fill && e.pointerType === 'touch') {
    fill_tap = { pointer_id: e.pointerId, bx, by, wx, wy }
    return
  }
  if (g.pen.tool === t_select || g.pen.tool === t_lasso) {
    dispatch('sel.pointer_down', { x: bx, y: by })
    stroke_pid = e.pointerId
    if (flo_active()) flo_mode = h_move
    else selecting = 1
    return
  }
  lp_done = 0
  if (eyedrop_tool()) {
    lp_at = [wx, wy]
    lp_clear()
    lp_timer = setTimeout(() => {
      lp_timer = 0
      if (stroke_pid !== e.pointerId) return
      lp_done = 1
      tool_cancel()
      document.body.classList.remove('canvas_writing')
      dispatch('pen.eyedrop_pick', rgb_of(tool_eyedrop(bx, by)))
      stroke_pid = -1
      dirty(d_stage)
    }, 500)
  }
  if (tool_down(bx, by, e.pressure || 0)) {
    if (tool_is_stroking()) writing_controls_hide()
    stroke_pid = e.pointerId
    scr_last = [e.clientX, e.clientY]
    if (g.pen.tool === t_pen || g.pen.tool === t_eraser) scratch_start(g.pen.brush, g.pen.tool === t_eraser ? 1 : 0)
  }
}

export function stage_move(e: PointerEvent): void {
  if (!ptrs.has(e.pointerId)) return
  const [wx, wy] = wrap_xy(e)
  ptrs.set(e.pointerId, [wx, wy])
  if (ptrs.size === 2) {
    pinch_move()
    return
  }
  if (text_tap?.pointer_id === e.pointerId) {
    if (Math.hypot(wx - text_tap.wx, wy - text_tap.wy) > 7) text_tap = null
    return
  }
  if (fill_tap?.pointer_id === e.pointerId) {
    if (Math.hypot(wx - fill_tap.wx, wy - fill_tap.wy) > 7) fill_tap = null
    return
  }
  if (panning) {
    dispatch('view.pan_to', { px: pan_start[2] + (wx - pan_start[0]), py: pan_start[3] + (wy - pan_start[1]) })
    return
  }
  if (e.pointerId !== stroke_pid) return
  if (lp_timer && Math.hypot(wx - lp_at[0], wy - lp_at[1]) > 7) lp_clear()
  if (lp_done) return
  const [bx, by] = board_xy(e)
  if (flo_active() && flo_mode !== h_none) {
    dispatch('flo.drag_move', { x: bx, y: by, shift: e.shiftKey ? 1 : 0 })
    return
  }
  if (selecting) {
    sel_move(bx, by)
    return
  }
  const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
  if (tool_is_stroking()) {
    let spd = Math.hypot(e.movementX || 0, e.movementY || 0)
    if (!spd && scr_last[0] >= 0) spd = Math.hypot(e.clientX - scr_last[0], e.clientY - scr_last[1])
    scr_last = [e.clientX, e.clientY]
    scratch_move(spd)
  }
  if (evs.length > 1) {
    for (const ce of evs) {
      const [cx, cy] = board_xy(ce as PointerEvent)
      tool_move_pt(cx, cy, (ce as PointerEvent).pressure || 0)
    }
  } else {
    tool_move_pt(bx, by, e.pressure || 0)
  }
  stroke_flush()
}

export function stage_up(e: PointerEvent): void {
  if (!ptrs.has(e.pointerId)) return
  ptrs.delete(e.pointerId)
  if (!ptrs.size) document.body.classList.remove('canvas_writing')
  captured_pointers.delete(e.pointerId)
  lp_clear()
  if (text_tap?.pointer_id === e.pointerId) {
    const tap = text_tap
    text_tap = null
    if (!ptrs.size) modal_text(tap.bx, tap.by)
    return
  }
  if (fill_tap?.pointer_id === e.pointerId) {
    const tap = fill_tap
    fill_tap = null
    if (!ptrs.size) tool_fill(tap.bx, tap.by)
    return
  }
  if (ptrs.size === 1) {
    stroke_pid = -1
    selecting = 0
    panning = 0
    return
  }
  if (panning && ptrs.size === 0) {
    panning = 0
    return
  }
  if (e.pointerId !== stroke_pid) return
  stroke_pid = -1
  if (lp_done) {
    lp_done = 0
    return
  }
  const [bx, by] = board_xy(e)
  if (flo_active() && flo_mode !== h_none) {
    flo_drag_end()
    flo_mode = h_none
    return
  }
  if (selecting) {
    selecting = 0
    if (flo_active()) {
      flo_drag_end()
      flo_mode = h_none
      return
    }
    sel_move(bx, by)
    dispatch('sel.pointer_up', null)
    return
  }
  scratch_stop()
  tool_up(bx, by)
}

export function stage_cancel(e: PointerEvent): void {
  if (pointer_active(e.pointerId)) stage_interrupt()
}

export function stage_wheel(e: WheelEvent): void {
  if (over_ui(e)) return
  e.preventDefault()
  const [wx, wy] = wrap_xy(e)
  const f = Math.exp(-e.deltaY * 0.0016)
  dispatch('view.zoom_at', { sx: wx, sy: wy, factor: f })
}

export function do_undo(): void {
  if (flo_active()) {
    dispatch('flo.cancel', null)
    return
  }
  dispatch('history.undo', null)
}

export function do_redo(): void {
  dispatch('history.redo', null)
}

export function stage_ctx(e: MouseEvent): void {
  const g = st()
  if (over_ui(e)) return
  e.preventDefault()
  if (last_ptr_type === 'touch') return
  ctx_show(e.clientX, e.clientY, [
    { label: 'もどす', icon: 'undo', fn: () => do_undo() },
    { label: 'やりなおす', icon: 'redo', fn: () => do_redo() },
    { label: 'コピー', icon: 'dup', fn: () => dispatch('sel.copy', null), off: g.sel.has ? 0 : 1 },
    { label: '切り取り', icon: 'select', fn: () => dispatch('sel.cut', null), off: g.sel.has ? 0 : 1 },
    { label: 'はりつけ', icon: 'paste', fn: () => tool_pick(t_paste), off: g.clip ? 0 : 1 },
    { label: '選択を消す', icon: 'trash', fn: () => dispatch('sel.delete', null), off: g.sel.has ? 0 : 1 },
  ])
}

export function last_pointer_type(): string {
  return last_ptr_type
}

export function last_pointer_type_set(t: string): void {
  last_ptr_type = t
}
