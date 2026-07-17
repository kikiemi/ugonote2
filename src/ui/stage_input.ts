import { pointer_capture, pointer_release, q, toast } from '../dom'
import { D_GRID, D_PEN, D_STAGE, D_TOOLS, T_ERASER, T_HAND, T_LASSO, T_PASTE, T_PEN, T_PIXEL, T_SELECT, T_TEXT, ZOOM_MAX, ZOOM_MIN } from '../h'
import { clamp } from '../lib'
import { H_MOVE, H_NONE, flo_active, flo_drag_end, flo_drag_start, flo_dragging, flo_hit, sel_move } from '../sel'
import { scratch_move, scratch_start, scratch_stop, sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { anim_playing } from '../state/commands/play'
import { dirty, st } from '../state/store'
import { kit_tool_ok } from '../sync'
import { stroke_flush, tool_cancel, tool_down, tool_eyedrop, tool_is_stroking, tool_move_pt, tool_up } from '../tool'
import { modal_text } from './modal'
import { ctx_show, pop_close, rail_sheet } from './overlay'
import { anim_stop } from './playback'

function rgb_of(v: [number, number, number]): { r: number, g: number, b: number } {
  return { r: v[0], g: v[1], b: v[2] }
}
let panning = 0

let panStart = [0, 0, 0, 0]

let strokePid = -1

let selecting = 0

const ptrs = new Map<number, [number, number]>()

const capturedPointers = new Set<number>()

let pinch0 = 0

let pinchZ = 1

let pinchMid = [0, 0]

let pinchPan = [0, 0]

let lastPtrType = 'mouse'

let lpTimer: ReturnType<typeof setTimeout> | 0 = 0

let lpDone = 0

let lpAt = [0, 0]

let floMode = H_NONE

let interrupting = 0

let scrLast: number[] = [-1, -1]

export function wrap_xy(e: PointerEvent | WheelEvent | MouseEvent): [number, number] {
  const r = q('stageWrap').getBoundingClientRect()
  let sx = e.clientX - r.left
  if (st().view.flip) sx = r.width - sx
  return [sx, e.clientY - r.top]
}

export function board_xy(e: PointerEvent | WheelEvent | MouseEvent): [number, number] {
  const g = st()
  const [sx, sy] = wrap_xy(e)
  return [(sx - g.view.px) / g.view.z, (sy - g.view.py) / g.view.z]
}

export function tool_pick(t: number): void {
  const g = st()
  if (tool_is_stroking() || ptrs.size || strokePid >= 0 || panning) return
  if (q('rail').classList.contains('on')) rail_sheet(0)
  if (!kit_tool_ok(t)) {
    toast('初級筆箱にはないどうぐだよ（せっていで切替）')
    return
  }
  if (flo_active() && t !== T_PASTE) dispatch('flo.cancel', null)
  if (t === T_PASTE) {
    if (!g.clip) {
      toast('さきに「はんい」でコピーしてね')
      return
    }
    dispatch('pen.set_tool', t)
    dispatch('flo.begin_paste', null)
    sfx_play('tap')
    return
  }
  dispatch('pen.set_tool', t)
  dirty(D_TOOLS | D_PEN | D_GRID)
  sfx_play('tap')
  if (t === T_TEXT) modal_text(g.doc.w / 2, g.doc.h / 2)
}

function lp_clear(): void {
  if (lpTimer) clearTimeout(lpTimer)
  lpTimer = 0
}

function pointer_active(pointerId: number): number {
  return ptrs.has(pointerId) || capturedPointers.has(pointerId) || strokePid === pointerId ? 1 : 0
}

export function stage_interrupt(): void {
  if (interrupting) return
  const selectionPointer = selecting
  const floatingDrag = floMode !== H_NONE || flo_dragging() !== 0
  if (!ptrs.size && !capturedPointers.size && !panning && strokePid < 0 && !selecting && !lpTimer && !tool_is_stroking() && !floatingDrag) return
  const wrap = q('stageWrap')
  const captured = [...capturedPointers]
  interrupting = 1
  ptrs.clear()
  capturedPointers.clear()
  lp_clear()
  lpDone = 0
  panning = 0
  panStart = [0, 0, 0, 0]
  strokePid = -1
  selecting = 0
  pinch0 = 0
  pinchZ = 1
  pinchMid = [0, 0]
  pinchPan = [0, 0]
  floMode = H_NONE
  scrLast = [-1, -1]
  try {
    scratch_stop()
    if (floatingDrag) flo_drag_end()
    if (selectionPointer) dispatch('sel.clear', null)
    if (tool_is_stroking()) tool_cancel()
  } finally {
    for (const pointerId of captured) pointer_release(wrap, pointerId)
    interrupting = 0
  }
}

export function stage_lost_capture(e: PointerEvent): void {
  capturedPointers.delete(e.pointerId)
  if (!interrupting && pointer_active(e.pointerId)) stage_interrupt()
}

export function stage_pointer_out(e: PointerEvent): void {
  if (e.relatedTarget !== null || capturedPointers.has(e.pointerId) || !pointer_active(e.pointerId)) return
  stage_interrupt()
}

function pinch_begin(): void {
  const g = st()
  if (tool_is_stroking()) tool_cancel()
  lp_clear()
  const pts = [...ptrs.values()]
  const dx = pts[0][0] - pts[1][0]
  const dy = pts[0][1] - pts[1][1]
  pinch0 = Math.max(8, Math.hypot(dx, dy))
  pinchZ = g.view.z
  pinchMid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
  pinchPan = [g.view.px, g.view.py]
}

function pinch_move(): void {
  const pts = [...ptrs.values()]
  const dx = pts[0][0] - pts[1][0]
  const dy = pts[0][1] - pts[1][1]
  const d = Math.max(8, Math.hypot(dx, dy))
  const mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
  const nz = clamp(pinchZ * (d / pinch0), ZOOM_MIN, ZOOM_MAX)
  const bx = (pinchMid[0] - pinchPan[0]) / pinchZ
  const by = (pinchMid[1] - pinchPan[1]) / pinchZ
  dispatch('view.set_viewport', { z: nz, px: mid[0] - bx * nz, py: mid[1] - by * nz })
}

function eyedrop_tool(): number {
  const g = st()
  return g.pen.tool === T_PEN || g.pen.tool === T_ERASER || g.pen.tool === T_PIXEL ? 1 : 0
}

function over_ui(e: Event): number {
  const t = e.target as HTMLElement
  return t && t.closest && t.closest('#quick, #floBar, .pop, #zoomLabel') ? 1 : 0
}

export function stage_down(e: PointerEvent): void {
  const g = st()
  lastPtrType = e.pointerType
  if (over_ui(e)) return
  pop_close()
  if (e.button === 2) return
  if (ptrs.has(e.pointerId)) stage_interrupt()
  const wrap = q('stageWrap')
  if (pointer_capture(wrap, e.pointerId)) capturedPointers.add(e.pointerId)
  else capturedPointers.delete(e.pointerId)
  const [wx, wy] = wrap_xy(e)
  ptrs.set(e.pointerId, [wx, wy])
  if (ptrs.size === 2) {
    scratch_stop()
    if (tool_is_stroking()) tool_cancel()
    else if (selecting) dispatch('sel.clear', null)
    panning = 0
    strokePid = -1
    selecting = 0
    floMode = H_NONE
    flo_drag_end()
    pinch_begin()
    return
  }
  if (ptrs.size > 2) return
  if (e.button === 1 || g.pen.tool === T_HAND) {
    panning = 1
    panStart = [wx, wy, g.view.px, g.view.py]
    return
  }
  const [bx, by] = board_xy(e)
  if (flo_active()) {
    const hit = flo_hit(bx, by)
    if (hit === H_NONE) {
      dispatch('flo.confirm', null)
      return
    }
    floMode = hit
    flo_drag_start(hit, bx, by)
    strokePid = e.pointerId
    return
  }
  if (anim_playing()) {
    anim_stop()
    return
  }
  if (g.pen.tool === T_TEXT) {
    modal_text(bx, by)
    return
  }
  if (g.pen.tool === T_SELECT || g.pen.tool === T_LASSO) {
    dispatch('sel.pointer_down', { x: bx, y: by })
    strokePid = e.pointerId
    if (flo_active()) floMode = H_MOVE
    else selecting = 1
    return
  }
  lpDone = 0
  if (eyedrop_tool()) {
    lpAt = [wx, wy]
    lp_clear()
    lpTimer = setTimeout(() => {
      lpTimer = 0
      if (strokePid !== e.pointerId) return
      lpDone = 1
      tool_cancel()
      dispatch('pen.eyedrop_pick', rgb_of(tool_eyedrop(bx, by)))
      strokePid = -1
      dirty(D_STAGE)
    }, 500)
  }
  if (tool_down(bx, by, e.pressure || 0)) {
    strokePid = e.pointerId
    scrLast = [e.clientX, e.clientY]
    if (g.pen.tool === T_PEN || g.pen.tool === T_ERASER) scratch_start(g.pen.brush, g.pen.tool === T_ERASER ? 1 : 0)
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
  if (panning) {
    dispatch('view.pan_to', { px: panStart[2] + (wx - panStart[0]), py: panStart[3] + (wy - panStart[1]) })
    return
  }
  if (e.pointerId !== strokePid) return
  if (lpTimer && Math.hypot(wx - lpAt[0], wy - lpAt[1]) > 7) lp_clear()
  if (lpDone) return
  const [bx, by] = board_xy(e)
  if (flo_active() && floMode !== H_NONE) {
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
    if (!spd && scrLast[0] >= 0) spd = Math.hypot(e.clientX - scrLast[0], e.clientY - scrLast[1])
    scrLast = [e.clientX, e.clientY]
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
  capturedPointers.delete(e.pointerId)
  lp_clear()
  if (ptrs.size === 1) {
    strokePid = -1
    selecting = 0
    panning = 0
    return
  }
  if (panning && ptrs.size === 0) {
    panning = 0
    return
  }
  if (e.pointerId !== strokePid) return
  strokePid = -1
  if (lpDone) {
    lpDone = 0
    return
  }
  const [bx, by] = board_xy(e)
  if (flo_active() && floMode !== H_NONE) {
    flo_drag_end()
    floMode = H_NONE
    return
  }
  if (selecting) {
    selecting = 0
    if (flo_active()) {
      flo_drag_end()
      floMode = H_NONE
      return
    }
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
  if (lastPtrType === 'touch') return
  ctx_show(e.clientX, e.clientY, [
    { label: 'もどす', icon: 'undo', fn: () => do_undo() },
    { label: 'やりなおす', icon: 'redo', fn: () => do_redo() },
    { label: 'コピー', icon: 'dup', fn: () => dispatch('sel.copy', null), off: g.sel.has ? 0 : 1 },
    { label: '切り取り', icon: 'select', fn: () => dispatch('sel.cut', null), off: g.sel.has ? 0 : 1 },
    { label: 'はりつけ', icon: 'paste', fn: () => tool_pick(T_PASTE), off: g.clip ? 0 : 1 },
    { label: '選択を消す', icon: 'trash', fn: () => dispatch('sel.delete', null), off: g.sel.has ? 0 : 1 },
  ])
}

export function last_pointer_type(): string {
  return lastPtrType
}

export function last_pointer_type_set(t: string): void {
  lastPtrType = t
}
