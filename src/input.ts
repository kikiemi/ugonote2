import { el, pointer_capture, pointer_release, q, toast } from './dom'
import { D_ALL, D_PEN, D_SAVE, D_TOOLS, DRAG_SLOP, K_PASTE, LONGPRESS_MS, T_CIRCLE, T_ERASER, T_FILL, T_HEART, T_LINE, T_PASTE, T_PEN, T_PIXEL, T_RECT, T_STAR, T_TEXT } from './h'
import { lang_set, lang_saved, tr } from './lang'
import { file_pick, clamp } from './lib'
import { mark_capture_from_file, mark_capture_from_selection, mark_delete, mark_place } from './mark'
import { mode_order } from './mode'
import { modal_active, modal_close, modal_prompt_num } from './panels'
import { store_save_auto } from './persist'
import { pref_theme_toggle, pref_uisfx_toggle, pref_kit_set } from './prefs'
import { flo_active, sel_bind } from './sel'
import { TOOL_DEFS } from './shell'
import { sfx_play, sfx_warm } from './snd'
import { dispatch } from './state/commands/index'
import { anim_playing } from './state/commands/play'
import { dirty, st } from './state/store'
import { storage_read_json } from './storage'
import { tool_has_options, tl_index_at } from './sync'
import { tf_active, tf_begin, tf_cancel, tf_commit, tf_preview, tool_bind_preview, tool_is_stroking, tool_mod_shift } from './tool'
import { drawer_set, ctx_hide, ctx_show, ctx_show_above, pop_close, pop_close_hook, pop_is_open, pop_open, pop_toggle, rail_sheet } from './ui/overlay'
import { anim_seek, anim_stop, anim_toggle } from './ui/playback'
import { do_redo, do_undo, last_pointer_type, last_pointer_type_set, stage_cancel, stage_ctx, stage_down, stage_interrupt, stage_lost_capture, stage_move, stage_pointer_out, stage_up, stage_wheel, tool_pick } from './ui/stage_input'

function pref_kit_apply(v: number): void {
  pref_kit_set(v)
  dirty(D_TOOLS | D_PEN)
}

let fsRoot: HTMLElement | null = null
const FS_EDGE = 62
const FS_SPEED = 17
type FsDrag = {
  on: number
  scrolling: number
  from: number
  to: number
  timer: ReturnType<typeof setTimeout> | 0
  sx: number
  sy: number
  x: number
  y: number
  sl: number
  ghost: HTMLElement | null
  pointerId: number
  captured: number
  touchId: number
  raf: number
  lock: number
}
const FS_DRAG_IDLE: FsDrag = { on: 0, scrolling: 0, from: -1, to: -1, timer: 0, sx: 0, sy: 0, x: 0, y: 0, sl: 0, ghost: null, pointerId: -1, captured: 0, touchId: -1, raf: 0, lock: 0 }
let fsDrag: FsDrag = { ...FS_DRAG_IDLE }
let onionLp: ReturnType<typeof setTimeout> | 0 = 0
let onionLpFired = 0

function view_fit_if_stale(): void {
  requestAnimationFrame(() => dispatch('view.fit_if_stale', null))
}

function typing_now(): number {
  const a = document.activeElement
  if (!a) return 0
  const t = a.tagName
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' ? 1 : 0
}

function fs_ctx(e: MouseEvent, i: number): void {
  e.preventDefault()
  if (last_pointer_type() === 'touch') return
  dispatch('frame.goto', i)
  ctx_show(e.clientX, e.clientY, [
    { label: '複製', icon: 'dup', fn: () => dispatch('frame.dup', null) },
    { label: 'コピー', icon: 'select', fn: () => dispatch('frame.copy', null) },
    { label: 'はりつけ', icon: 'paste', fn: () => dispatch('frame.paste', null) },
    { label: 'ここからループA', icon: 'ab', fn: () => ab_set_a(i) },
    { label: 'ここまでループB', icon: 'ab', fn: () => ab_set_b(i) },
    { label: '削除', icon: 'trash', fn: () => dispatch('frame.del', null) },
  ])
}

function ab_set_a(i: number): void {
  dispatch('doc.set_loop_a', i)
  toast('ループのはじまり: ' + (i + 1))
}

function ab_set_b(i: number): void {
  dispatch('doc.set_loop_b', i)
  toast('ループのおわり: ' + (i + 1))
}

function ab_cycle(): void {
  const g = st()
  const cur = g.doc.cur
  if (g.doc.loopA < 0) {
    ab_set_a(cur)
    return
  }
  if (g.doc.loopB < 0) {
    if (cur < g.doc.loopA) {
      ab_set_a(cur)
      return
    }
    ab_set_b(cur)
    return
  }
  dispatch('doc.clear_loop_ab', null)
  toast('A-Bループを解除')
  sfx_play('tap')
}

function frame_home(): void {
  if (dispatch('frame.goto', 0) === 0) sfx_play('tap')
}

function frame_last(): void {
  if (dispatch('frame.goto', st().doc.frames.length - 1) === 0) sfx_play('tap')
}

function frame_duplicate(): void {
  dispatch('frame.dup', null)
}

function loop_toggle(): void {
  dispatch('doc.toggle_loop', null)
  sfx_play('tap')
}

function hold_toggle(anchor: HTMLElement): void {
  pop_toggle('popHold', anchor)
}

function fps_toggle(anchor: HTMLElement): void {
  pop_toggle('popFps', anchor)
}

function timeline_toggle(): void {
  dispatch('view.toggle_timeline', null)
  view_fit_if_stale()
  sfx_play('tap')
}

function tl_more_open(): void {
  const g = st()
  const button = q('tlMoreBtn')
  const items = [
    { label: tr('さいしょのコマへ'), icon: 'skipback', fn: frame_home, off: g.doc.cur === 0 ? 1 : 0 },
    { label: tr('さいごのコマへ'), icon: 'last', fn: frame_last, off: g.doc.cur === g.doc.frames.length - 1 ? 1 : 0 },
    { label: tr(g.doc.loop ? 'ループを解除' : 'ループ再生'), icon: 'loop', fn: loop_toggle },
    { label: tr('A-B区間ループ'), icon: 'ab', fn: ab_cycle },
    { label: tr('このコマの表示時間'), icon: 'clock', fn: () => hold_toggle(button) },
    { label: tr('コマを複製'), icon: 'dup', fn: frame_duplicate },
    { label: tr('はやさ'), icon: 'clock', fn: () => fps_toggle(button) },
    {
      label: tr(g.view.tlopen ? 'コマ一覧を閉じる' : 'コマ一覧を開く'),
      icon: g.view.tlopen ? 'down' : 'up',
      fn: timeline_toggle,
    },
  ]
  ctx_show_above(button, items)
}

function fs_drag_clear(): void {
  if (fsDrag.pointerId < 0 && fsDrag.touchId < 0 && !fsDrag.timer && !fsDrag.ghost && !fsDrag.scrolling) return
  if (fsDrag.timer) clearTimeout(fsDrag.timer)
  if (fsDrag.raf) cancelAnimationFrame(fsDrag.raf)
  const fs = fsRoot
  const pointerId = fsDrag.pointerId
  const captured = fsDrag.captured
  if (fs) {
    for (const cell of fs.querySelectorAll<HTMLElement>('.fcell')) {
      cell.classList.remove('drop')
      cell.classList.remove('lift')
    }
  }
  if (fsDrag.ghost) fsDrag.ghost.remove()
  if (fs && fsDrag.lock) fs.style.overflowX = ''
  fsDrag = { ...FS_DRAG_IDLE }
  if (fs && captured && pointerId >= 0) pointer_release(fs, pointerId)
}

function fs_cell_index(cell: HTMLElement | null): number {
  if (!cell) return -1
  const raw = cell.dataset.i
  if (raw === undefined || raw === '') return -1
  const index = Number(raw)
  return index >= 0 ? index : -1
}

function fs_marks(): void {
  const fs = fsRoot
  if (!fs) return
  for (const cell of fs.querySelectorAll<HTMLElement>('.fcell')) {
    const index = fs_cell_index(cell)
    const lifted = fsDrag.on === 1 && index >= 0 && index === fsDrag.from
    const dropped = fsDrag.on === 1 && index >= 0 && index === fsDrag.to && index !== fsDrag.from
    cell.classList.toggle('lift', lifted)
    cell.classList.toggle('drop', dropped)
  }
}

function fs_ghost_place(): void {
  if (!fsDrag.ghost) return
  fsDrag.ghost.style.left = fsDrag.x - 35 + 'px'
  fsDrag.ghost.style.top = fsDrag.y - 60 + 'px'
}

function fs_hover(): void {
  fsDrag.to = tl_index_at(fsDrag.x)
  fs_marks()
}

function fs_autoscroll(): void {
  fsDrag.raf = 0
  const fs = fsRoot
  if (!fs || !fsDrag.on) return
  const max = fs.scrollWidth - fs.clientWidth
  if (max > 0) {
    const r = fs.getBoundingClientRect()
    const left = fsDrag.x - r.left
    const right = r.right - fsDrag.x
    let dx = 0
    if (left < FS_EDGE) dx = -Math.ceil(((FS_EDGE - Math.max(left, -FS_EDGE)) / FS_EDGE) * FS_SPEED)
    else if (right < FS_EDGE) dx = Math.ceil(((FS_EDGE - Math.max(right, -FS_EDGE)) / FS_EDGE) * FS_SPEED)
    if (dx) {
      const before = fs.scrollLeft
      fs.scrollLeft = clamp(before + dx, 0, max)
      if (fs.scrollLeft !== before) fsDrag.sl = fs.scrollLeft
    }
  }
  fs_hover()
  fsDrag.raf = requestAnimationFrame(fs_autoscroll)
}

function fs_drag_begin(cell: HTMLElement): void {
  const canvas = cell.querySelector<HTMLCanvasElement>('canvas')
  if (!canvas) {
    fs_drag_clear()
    return
  }
  fsDrag.timer = 0
  fsDrag.on = 1
  const fs = fsRoot
  if (fs && fsDrag.touchId >= 0) {
    fsDrag.lock = 1
    fs.style.overflowX = 'hidden'
  }
  const ghost = el('div', '', '')
  ghost.id = 'fsGhost'
  ghost.draggable = false
  const ghostCanvas = canvas.cloneNode(true) as HTMLCanvasElement
  ghostCanvas.draggable = false
  const context = ghostCanvas.getContext('2d')
  if (context) context.drawImage(canvas, 0, 0)
  ghost.appendChild(ghostCanvas)
  document.body.appendChild(ghost)
  fsDrag.ghost = ghost
  fs_ghost_place()
  fs_marks()
  fsDrag.raf = requestAnimationFrame(fs_autoscroll)
  sfx_play('move')
}

function fs_drag_track(x: number, y: number): void {
  if (!fsDrag.on) {
    const fs = fsRoot
    if (fs && fs.scrollLeft !== fsDrag.sl) {
      fs_drag_clear()
      return
    }
    if (Math.hypot(x - fsDrag.sx, y - fsDrag.sy) > DRAG_SLOP) fs_drag_clear()
    return
  }
  fsDrag.x = x
  fsDrag.y = y
  fs_ghost_place()
  fs_hover()
}

function fs_drag_finish(cell: HTMLElement | null, canceled: number): void {
  const from = fsDrag.from
  const to = fsDrag.to
  const wasDrag = fsDrag.on
  fs_drag_clear()
  if (canceled) return
  if (wasDrag) {
    if (to !== from) dispatch('frame.move', { a: from, b: to })
    return
  }
  const index = fs_cell_index(cell)
  if (index < 0) return
  if (anim_playing()) {
    anim_seek(index)
    return
  }
  if (index !== st().doc.cur) {
    dispatch('frame.goto', index)
    sfx_play('tap')
  }
}

function fs_press(fs: HTMLElement, cell: HTMLElement, x: number, y: number): number {
  const from = fs_cell_index(cell)
  if (from < 0) return 0
  fsDrag.from = from
  fsDrag.to = from
  fsDrag.on = 0
  fsDrag.scrolling = 0
  fsDrag.sx = x
  fsDrag.sy = y
  fsDrag.x = x
  fsDrag.y = y
  fsDrag.sl = fs.scrollLeft
  return 1
}

function fs_touch_of(list: TouchList): Touch | null {
  for (let i = 0; i < list.length; i++) if (list[i].identifier === fsDrag.touchId) return list[i]
  return null
}

function fs_closest_cell(node: EventTarget | null): HTMLElement | null {
  const target = node as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return null
  return target.closest('.fcell') as HTMLElement | null
}

function fs_pointer(fs: HTMLElement): void {
  fsRoot = fs
  fs.addEventListener('pointerdown', e => {
    last_pointer_type_set(e.pointerType)
    if (e.pointerType === 'touch') return
    const cell = fs_closest_cell(e.target)
    if (!cell || e.button === 2) return
    if (fsDrag.on && fsDrag.touchId >= 0) return
    fs_drag_clear()
    if (!fs_press(fs, cell, e.clientX, e.clientY)) return
    const from = fsDrag.from
    fsDrag.pointerId = e.pointerId
    fsDrag.timer = setTimeout(() => {
      if (fsDrag.pointerId !== e.pointerId || fsDrag.from !== from) return
      fsDrag.captured = pointer_capture(fs, e.pointerId)
      fs_drag_begin(cell)
    }, LONGPRESS_MS)
  })
  fs.addEventListener(
    'touchstart',
    e => {
      if (fsDrag.on && fsDrag.touchId >= 0) return
      if (e.touches.length > 1) {
        fs_drag_clear()
        return
      }
      const t = e.changedTouches[0]
      if (!t) return
      const cell = fs_closest_cell(t.target)
      if (!cell) return
      // iOS Safari must be told at the start of the gesture that the app owns
      // it. Horizontal scrolling is reproduced below until a long press turns
      // the same gesture into a frame reorder.
      if (e.cancelable) e.preventDefault()
      fs_drag_clear()
      if (!fs_press(fs, cell, t.clientX, t.clientY)) return
      const from = fsDrag.from
      const id = t.identifier
      fsDrag.touchId = id
      fsDrag.timer = setTimeout(() => {
        if (fsDrag.touchId !== id || fsDrag.from !== from) return
        if (fs.scrollLeft !== fsDrag.sl) {
          fs_drag_clear()
          return
        }
        fs_drag_begin(cell)
      }, LONGPRESS_MS)
    },
    { passive: false }
  )
  window.addEventListener(
    'touchmove',
    e => {
      if (fsDrag.touchId < 0 || fsDrag.from < 0) return
      const t = fs_touch_of(e.touches)
      if (!t) return
      if (e.cancelable) e.preventDefault()
      if (!fsDrag.on) {
        const dx = t.clientX - fsDrag.sx
        const dy = t.clientY - fsDrag.sy
        if (!fsDrag.scrolling && Math.hypot(dx, dy) > DRAG_SLOP) {
          if (fsDrag.timer) clearTimeout(fsDrag.timer)
          fsDrag.timer = 0
          fsDrag.scrolling = 1
        }
        if (fsDrag.scrolling) {
          const max = Math.max(0, fs.scrollWidth - fs.clientWidth)
          fs.scrollLeft = clamp(fsDrag.sl - dx, 0, max)
          fsDrag.x = t.clientX
          fsDrag.y = t.clientY
          return
        }
      }
      fs_drag_track(t.clientX, t.clientY)
    },
    { passive: false, capture: true }
  )
  const touch_finish = (e: TouchEvent): void => {
    if (fsDrag.touchId < 0 || fsDrag.from < 0) return
    const t = fs_touch_of(e.changedTouches)
    if (!t) return
    if (e.cancelable) e.preventDefault()
    if (fsDrag.scrolling) {
      fs_drag_clear()
      return
    }
    if (fsDrag.on) fs_drag_track(t.clientX, t.clientY)
    fs_drag_finish(fs_closest_cell(t.target), e.type === 'touchcancel' ? 1 : 0)
  }
  window.addEventListener('touchend', touch_finish, { passive: false, capture: true })
  window.addEventListener('touchcancel', touch_finish, { passive: false, capture: true })
  const move = (e: PointerEvent): void => {
    if (fsDrag.touchId >= 0 || e.pointerId !== fsDrag.pointerId || fsDrag.from < 0) return
    fs_drag_track(e.clientX, e.clientY)
  }
  const finish = (e: PointerEvent): void => {
    if (fsDrag.touchId >= 0 || e.pointerId !== fsDrag.pointerId || fsDrag.from < 0) return
    fs_drag_finish(fs_closest_cell(e.target), e.type === 'pointercancel' ? 1 : 0)
  }
  const lost = (e: PointerEvent): void => {
    if (fsDrag.touchId < 0 && e.pointerId === fsDrag.pointerId && fsDrag.from >= 0) fs_drag_clear()
  }
  const pointerOut = (e: PointerEvent): void => {
    if (fsDrag.touchId >= 0 || e.pointerId !== fsDrag.pointerId || e.relatedTarget !== null || fsDrag.captured) return
    fs_drag_clear()
  }
  window.addEventListener('pointermove', move, { capture: true })
  window.addEventListener('pointerup', finish, { capture: true })
  window.addEventListener('pointercancel', finish, { capture: true })
  window.addEventListener('pointerout', pointerOut, { capture: true })
  fs.addEventListener('lostpointercapture', lost)
  fs.addEventListener('contextmenu', e => {
    const cell = fs_closest_cell(e.target)
    if (!cell) return
    fs_ctx(e, Number(cell.dataset.i))
  })
  fs.addEventListener('dragstart', e => {
    e.preventDefault()
  })
  fs.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault()
      fs.scrollLeft += e.deltaY
    }
  })
}

function rail_events(): void {
  q('railTools').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.rb') as HTMLElement | null
    if (!b) return
    const t = Number(b.dataset.t)
    if (st().pen.tool === t && tool_has_options(t)) {
      pop_toggle('popTool', b)
      return
    }
    tool_pick(t)
    if (pop_is_open() === 'popTool') pop_open('popTool', b)
  })
  q('colorBtn').addEventListener('click', () => pop_toggle('popColor', q('colorBtn')))
  q('sizeBtn').addEventListener('click', () => pop_toggle('popTool', q('sizeBtn')))
  q('optBtn').addEventListener('click', () => pop_toggle('popSettings', q('optBtn')))
}

function hex_ok(s: string): number {
  return /^#[0-9a-fA-F]{6}$/.test(s) ? 1 : 0
}

export function custom_load(): void {
  const value = storage_read_json('ug2_pal')
  if (!Array.isArray(value)) return
  dispatch('pen.custom_set', value.filter((color: unknown): color is string => typeof color === 'string' && hex_ok(color) !== 0))
}

let custLp: ReturnType<typeof setTimeout> | 0 = 0

function color_pop_events(): void {
  for (let t = 0; t < 3; t++) {
    q('palTab_' + t).addEventListener('click', () => {
      dispatch('pen.set_pal_mode', t)
      sfx_play('tap')
    })
  }
  const pickC = (c: string) => {
    dispatch('pen.set_color', c)
    sfx_play('tap')
  }
  q('palGrid').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.palc') as HTMLElement | null
    if (b && b.dataset.c) pickC(b.dataset.c)
  })
  q('custGrid').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.palc') as HTMLElement | null
    if (b && b.dataset.c) pickC(b.dataset.c)
  })
  q('custGrid').addEventListener('pointerdown', e => {
    const b = (e.target as HTMLElement).closest('.palc') as HTMLElement | null
    if (!b || b.dataset.ci === undefined) return
    if (custLp) clearTimeout(custLp)
    custLp = setTimeout(() => {
      custLp = 0
      dispatch('pen.custom_remove', Number(b.dataset.ci))
    }, 600)
  })
  const custUp = () => {
    if (custLp) clearTimeout(custLp)
    custLp = 0
  }
  q('custGrid').addEventListener('pointerup', custUp)
  q('custGrid').addEventListener('pointercancel', custUp)
  q('custGrid').addEventListener('pointerleave', custUp)
  q('custAdd').addEventListener('click', () => {
    dispatch('pen.custom_add', st().pen.color)
  })
  q<HTMLInputElement>('pickIn').addEventListener('input', e => {
    dispatch('pen.set_color', (e.target as HTMLInputElement).value)
  })
  const applyHex = () => {
    const v = q<HTMLInputElement>('hexIn').value.trim()
    if (!hex_ok(v)) {
      toast('#RRGGBB の形で入れてね')
      return
    }
    dispatch('pen.set_color', v)
    sfx_play('tap')
  }
  q('hexIn').addEventListener('keydown', e => {
    if ((e as KeyboardEvent).key === 'Enter') applyHex()
  })
  q('hexIn').addEventListener('blur', applyHex)
}

function tool_pop_events(): void {
  q('popTool').addEventListener('click', e => {
    const sz = (e.target as HTMLElement).closest('.szb') as HTMLElement | null
    if (sz) {
      dispatch('pen.set_size', Number(sz.dataset.sz))
      sfx_play('tap')
      return
    }
    const pb = (e.target as HTMLElement).closest('.patb') as HTMLElement | null
    if (pb) {
      dispatch('pen.set_pat', Number(pb.dataset.pat))
      sfx_play('tap')
      return
    }
  })
  const tgl = (id: string, fn: () => void) => q(id).addEventListener('click', fn)
  tgl('optPressure', () => {
    dispatch('pen.toggle_pressure', null)
    sfx_play('tap')
  })
  tgl('optSymX', () => {
    dispatch('pen.toggle_sym', null)
    sfx_play('tap')
  })
  tgl('optSymY', () => {
    dispatch('pen.toggle_symy', null)
    sfx_play('tap')
  })
  tgl('optOutline', () => {
    dispatch('pen.toggle_outline', null)
    sfx_play('tap')
  })
  tgl('optFill', () => {
    dispatch('pen.toggle_fill', null)
    sfx_play('tap')
  })
  q<HTMLInputElement>('optSmooth').addEventListener('input', e => {
    dispatch('pen.set_smooth', Number((e.target as HTMLInputElement).value))
  })
  q<HTMLInputElement>('optAlpha').addEventListener('input', e => {
    dispatch('pen.set_alpha_pct', Number((e.target as HTMLInputElement).value))
  })
  q<HTMLInputElement>('optOWidth').addEventListener('input', e => {
    dispatch('pen.set_owidth', Number((e.target as HTMLInputElement).value))
  })
  q<HTMLInputElement>('optOColor').addEventListener('input', e => {
    dispatch('pen.set_ocolor', (e.target as HTMLInputElement).value)
  })
  const pxnSet = (v: number) => {
    if (!Number.isFinite(v) || v <= 0) return
    dispatch('pen.set_pxn', v)
  }
  q<HTMLInputElement>('pxnRange').addEventListener('input', e => pxnSet(Number((e.target as HTMLInputElement).value)))
  q<HTMLInputElement>('pxnNum').addEventListener('input', e => pxnSet(Number((e.target as HTMLInputElement).value)))
  const sizeSet = (v: number) => {
    if (!Number.isFinite(v) || v <= 0) return
    dispatch('pen.set_size', v)
  }
  q<HTMLInputElement>('sizeRange').addEventListener('input', e => sizeSet(Number((e.target as HTMLInputElement).value)))
  q<HTMLInputElement>('sizeNum').addEventListener('input', e => sizeSet(Number((e.target as HTMLInputElement).value)))
  q('popTool').addEventListener('click', e => {
    const bb = (e.target as HTMLElement).closest('.brushb') as HTMLElement | null
    if (!bb) return
    dispatch('pen.set_brush', Number(bb.dataset.b))
    if (st().pen.tool !== T_PEN) tool_pick(T_PEN)
    sfx_play('tap')
  })
  q('optFillAll').addEventListener('click', () => {
    dispatch('pen.toggle_fill_all', null)
    sfx_play('tap')
  })
  q('selCopy').addEventListener('click', () => dispatch('sel.copy', null))
  q('selCut').addEventListener('click', () => dispatch('sel.cut', null))
  q('selDel').addEventListener('click', () => dispatch('sel.delete', null))
}

let tfTarget = -1

function tf_pop_events(): void {
  const rScale = q<HTMLInputElement>('tfScale')
  const rDx = q<HTMLInputElement>('tfDx')
  const rDy = q<HTMLInputElement>('tfDy')
  const rRot = q<HTMLInputElement>('tfRot')
  const cur = () => ({ f: Number(rScale.value) / 100, dx: Number(rDx.value), dy: Number(rDy.value), deg: Number(rRot.value) })
  const show = () => {
    q('tfScaleV').textContent = rScale.value + '%'
    q('tfDxV').textContent = rDx.value
    q('tfDyV').textContent = rDy.value
    q('tfRotV').textContent = rRot.value + '°'
  }
  const reset_ui = () => {
    rScale.value = '100'
    rDx.value = '0'
    rDy.value = '0'
    rRot.value = '0'
    show()
  }
  const move = () => {
    if (!tf_active()) tf_begin(tfTarget < 0 ? -1 : st().pen.layer)
    const v = cur()
    show()
    tf_preview(v.f, v.dx, v.dy, v.deg)
  }
  for (const r of [rScale, rDx, rDy, rRot]) r.addEventListener('input', move)
  q('tfAll').addEventListener('click', () => {
    tf_cancel()
    reset_ui()
    tfTarget = -1
    q('tfAll').classList.add('on')
    q('tfOne').classList.remove('on')
  })
  q('tfOne').addEventListener('click', () => {
    tf_cancel()
    reset_ui()
    tfTarget = 1
    q('tfOne').classList.add('on')
    q('tfAll').classList.remove('on')
  })
  q('tfApply').addEventListener('click', () => {
    tf_commit()
    reset_ui()
    sfx_play('save')
    toast('絵をうごかしました')
  })
  q('tfCancel').addEventListener('click', () => {
    tf_cancel()
    reset_ui()
    sfx_play('tap')
  })
}

function layer_pop_events(): void {
  const rows = q('layerRows')
  rows.addEventListener('click', e => {
    const eye = (e.target as HTMLElement).closest('.leye') as HTMLElement | null
    if (eye) {
      dispatch('layer.toggle_visible', Number(eye.dataset.l))
      sfx_play('tap')
      return
    }
    const up = (e.target as HTMLElement).closest('.lup') as HTMLElement | null
    const dn = (e.target as HTMLElement).closest('.ldn') as HTMLElement | null
    if (up || dn) {
      const button = (up || dn) as HTMLElement
      if (button.classList.contains('off')) return
      const g = st()
      const l = Number(button.dataset.l)
      const active = mode_order(g.doc.mode, g.doc.lord)
      const i = active.indexOf(l)
      const j = up ? i - 1 : i + 1
      if (i < 0 || j < 0 || j >= active.length) return
      const a = g.doc.lord.indexOf(active[i])
      const b = g.doc.lord.indexOf(active[j])
      if (dispatch('layer.reorder_swap', { i: a, j: b }) === 0) sfx_play('move')
      return
    }
    const pick = (e.target as HTMLElement).closest('.lpick') as HTMLElement | null
    if (pick) {
      const layer = Number(pick.dataset.l)
      if (layer === 0) {
        q('photoLayerBtn').click()
        return
      }
      dispatch('pen.set_layer', layer)
      sfx_play('tap')
    }
  })
  rows.addEventListener('input', e => {
    const al = (e.target as HTMLElement).closest('.lal') as HTMLInputElement | null
    if (!al) return
    dispatch('layer.set_alpha', { l: Number(al.dataset.l), a255: (Number(al.value) / 100) * 255 })
  })
}

let markLp: ReturnType<typeof setTimeout> | 0 = 0

function mark_events(): void {
  const g = st()
  q('markBtn').addEventListener('click', () => pop_toggle('popMark', q('markBtn')))
  q('markGrid').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.mkb') as HTMLElement | null
    if (!b || !b.dataset.markid) return
    const id = b.dataset.markid
    mark_place(id, canvas => {
      if (!canvas) {
        toast('マークを読み込めなかった…')
        return
      }
      dispatch('flo.begin_image', { canvas, kind: K_PASTE, x: g.doc.w / 2, y: g.doc.h / 2, continuous: 1 })
      pop_close()
      toast('✓で確定→そのまま連続スタンプ！おわるときはEsc')
      sfx_play('tap')
    })
  })
  q('markGrid').addEventListener('pointerdown', e => {
    const b = (e.target as HTMLElement).closest('.mkb') as HTMLElement | null
    if (!b || !b.dataset.markid) return
    const id = b.dataset.markid
    if (markLp) clearTimeout(markLp)
    markLp = setTimeout(() => {
      markLp = 0
      mark_delete(id)
      toast('マークを消しました')
    }, 600)
  })
  const mUp = () => {
    if (markLp) clearTimeout(markLp)
    markLp = 0
  }
  q('markGrid').addEventListener('pointerup', mUp)
  q('markGrid').addEventListener('pointercancel', mUp)
  q('markGrid').addEventListener('pointerleave', mUp)
  q('markAddSel').addEventListener('click', () => {
    mark_capture_from_selection('マーク', ok => {
      toast(ok ? '選択範囲をマークに登録しました' : '登録できるものが見つからないよ（レイヤーがからっぽかも）')
      if (ok) sfx_play('save')
    })
  })
  q('markAddFile').addEventListener('click', () => {
    file_pick('image/*', f => mark_capture_from_file(f, ok => {
      toast(ok ? '画像をマークに登録しました' : '画像を読めなかった…')
      if (ok) sfx_play('save')
    }))
  })
}

function settings_events(): void {
  const gs = (v: number) => {
    if (!Number.isFinite(v)) return
    dispatch('view.set_grid_size', v)
  }
  q<HTMLInputElement>('setGsize').addEventListener('input', e => gs(Number((e.target as HTMLInputElement).value)))
  q<HTMLInputElement>('setGsizeN').addEventListener('input', e => gs(Number((e.target as HTMLInputElement).value)))
  q<HTMLInputElement>('setOnion').addEventListener('input', e => {
    dispatch('view.set_onion_count', Number((e.target as HTMLInputElement).value))
  })
  q('setTheme').addEventListener('click', () => {
    pref_theme_toggle()
    dirty(D_ALL)
    sfx_play('tap')
  })
  q('setUisfx').addEventListener('click', () => {
    pref_uisfx_toggle()
    dirty(D_SAVE | D_TOOLS)
    sfx_play('tap')
  })
  q('setVflip').addEventListener('click', () => {
    dispatch('view.toggle_flip', null)
    sfx_play('tap')
  })
  const langSel = q<HTMLSelectElement>('setLang')
  langSel.value = lang_saved()
  langSel.addEventListener('change', () => lang_set(langSel.value))
  const kit = (v: number) => {
    pref_kit_apply(v)
    toast(v ? '初級筆箱にしたよ（7つのどうぐ）' : '上級筆箱にしたよ（ぜんぶのどうぐ）')
    sfx_play('tap')
  }
  q('kitAdv').addEventListener('click', () => kit(0))
  q('kitBasic').addEventListener('click', () => kit(1))
}

const DOCK_COLORS = ['#111111', '#FF3B30', '#FF9500', '#FFD60A', '#34C759', '#0A84FF', '#BF5AF2', '#FFFFFF']
const SHAPES = [T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART, T_PIXEL]
let lastShape = T_RECT

function mobile_ui_events(): void {
  const g = st()
  const pick_or_options = (id: string, tool: number): void => {
    const button = q(id)
    if (st().pen.tool === tool && tool_has_options(tool)) {
      pop_toggle('popTool', button)
      return
    }
    tool_pick(tool)
  }
  q('mp_draw').addEventListener('click', () => pick_or_options('mp_draw', T_PEN))
  q('mp_fill').addEventListener('click', () => pick_or_options('mp_fill', T_FILL))
  q('mp_text').addEventListener('click', () => tool_pick(T_TEXT))
  q('mp_shape').addEventListener('click', () => {
    const t = g.pen.tool
    const i = SHAPES.indexOf(t)
    if (i >= 0) {
      lastShape = t
      pop_toggle('popTool', q('mp_shape'))
      return
    }
    tool_pick(lastShape)
  })
  q('sbT').addEventListener('click', () => dispatch('sel.transform', null))
  q('sbC').addEventListener('click', () => dispatch('sel.copy', null))
  q('sbX').addEventListener('click', () => dispatch('sel.cut', null))
  q('sbQ').addEventListener('click', () => dispatch('sel.clear', null))
  q('dockEraser').addEventListener('click', () => pick_or_options('dockEraser', T_ERASER))
  q('dockMain').addEventListener('click', () => {
    const t = st().pen.tool
    if (tool_has_options(t)) pop_toggle('popTool', q('dockMain'))
    else rail_sheet(1)
  })
  q('dockColor').addEventListener('click', () => pop_toggle('popColor', q('dockColor')))
  q('dockSize').addEventListener('click', () => pop_toggle('popTool', q('dockSize')))
  q('dockMore').addEventListener('click', () => rail_sheet(q('rail').classList.contains('on') ? 0 : 1))
  q('hdLayerBtn').addEventListener('click', () => pop_toggle('popLayer', q('hdLayerBtn')))
  q('hdSettings').addEventListener('click', () => pop_toggle('popSettings', q('hdSettings')))
  const dc = q('dockColors')
  let h = ''
  for (let i = 0; i < DOCK_COLORS.length; i++) h += '<button class="dcol" id="dcol_' + i + '" data-c="' + DOCK_COLORS[i] + '" style="background:' + DOCK_COLORS[i] + '"></button>'
  dc.innerHTML = h
  dc.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.dcol') as HTMLElement | null
    if (!b) return
    dispatch('pen.set_color', b.dataset.c || g.pen.color)
    sfx_play('tap')
  })
}

function quick_events(): void {
  q('layerBtn').addEventListener('click', () => pop_toggle('popLayer', q('layerBtn')))
  q('tfBtn').addEventListener('click', () => {
    const g = st()
    q<HTMLInputElement>('tfDx').min = String(-g.doc.w)
    q<HTMLInputElement>('tfDx').max = String(g.doc.w)
    q<HTMLInputElement>('tfDy').min = String(-g.doc.h)
    q<HTMLInputElement>('tfDy').max = String(g.doc.h)
    pop_toggle('popTf', q('tfBtn'))
  })
  q('onionBtn').addEventListener('pointerdown', () => {
    onionLpFired = 0
    if (onionLp) clearTimeout(onionLp)
    onionLp = setTimeout(() => {
      onionLp = 0
      onionLpFired = 1
      pop_open('popOnion', q('onionBtn'))
    }, 450)
  })
  const onionUp = (): void => {
    if (onionLp) clearTimeout(onionLp)
    onionLp = 0
  }
  q('onionBtn').addEventListener('pointerup', onionUp)
  q('onionBtn').addEventListener('pointercancel', onionUp)
  q('onionBtn').addEventListener('pointerleave', onionUp)
  q('onionBtn').addEventListener('click', () => {
    onionUp()
    if (onionLpFired) return
    dispatch('view.toggle_onion', null)
    sfx_play('tap')
  })
  q('gridBtn').addEventListener('click', () => {
    dispatch('view.toggle_grid', null)
    sfx_play('tap')
  })
  q('vflipBtn').addEventListener('click', () => {
    dispatch('view.toggle_flip', null)
    sfx_play('tap')
  })
  q('fitBtn').addEventListener('click', () => {
    dispatch('view.fit', null)
    sfx_play('tap')
  })
  q<HTMLInputElement>('onionCount').addEventListener('input', e => {
    dispatch('view.set_onion_count', Number((e.target as HTMLInputElement).value))
  })
}

function flobar_events(): void {
  q('floRotL').addEventListener('click', () => dispatch('flo.rot', -1))
  q('floRotR').addEventListener('click', () => dispatch('flo.rot', 1))
  q('floFlipH').addEventListener('click', () => dispatch('flo.flip', 0))
  q('floFlipV').addEventListener('click', () => dispatch('flo.flip', 1))
  q('floReset').addEventListener('click', () => dispatch('flo.reset', null))
  q('floOk').addEventListener('click', () => dispatch('flo.confirm', null))
  q('floNo').addEventListener('click', () => dispatch('flo.cancel', null))
}

function tl_events(): void {
  const g = st()
  q('prevBtn').addEventListener('click', () => {
    if (dispatch('frame.step', -1) === 0) sfx_play('tap')
  })
  q('nextBtn').addEventListener('click', () => {
    if (dispatch('frame.step', 1) === 0) sfx_play('tap')
  })
  q('homeBtn').addEventListener('click', frame_home)
  q('lastBtn').addEventListener('click', frame_last)
  q('frameNo').addEventListener('click', () => {
    dispatch('play.stop', null)
    modal_prompt_num('コマへジャンプ', '何コマ目にとぶ？（1〜' + g.doc.frames.length + '）', g.doc.cur + 1, 1, g.doc.frames.length, v => {
      dispatch('frame.goto', v - 1)
    })
  })
  q('playBtn').addEventListener('click', () => anim_toggle())
  q('loopBtn').addEventListener('click', loop_toggle)
  q('abBtn').addEventListener('click', ab_cycle)
  q('fpsBtn').addEventListener('click', () => fps_toggle(q('fpsBtn')))
  q('holdBtn').addEventListener('click', () => hold_toggle(q('holdBtn')))
  q('addBtn').addEventListener('click', () => dispatch('frame.add', null))
  q('dupBtn').addEventListener('click', frame_duplicate)
  q('delBtn').addEventListener('click', () => dispatch('frame.del', null))
  q('tlToggle').addEventListener('click', timeline_toggle)
  q('tlMoreBtn').addEventListener('click', tl_more_open)
  q<HTMLInputElement>('fpsRange').addEventListener('input', e => {
    dispatch('doc.set_fps_idx', Number((e.target as HTMLInputElement).value))
  })
  q<HTMLInputElement>('holdRange').addEventListener('input', e => {
    const cur = g.doc.cur
    dispatch('frame.set_hold_range', { a: cur, b: cur, hold: Number((e.target as HTMLInputElement).value) })
  })
}

function header_events(): void {
  q('menuBtn').addEventListener('click', () => drawer_set(q('drawer').classList.contains('on') ? 0 : 1))
  q('drawerClose').addEventListener('click', () => drawer_set(0))
  q('scrim').addEventListener('click', () => drawer_set(0))
  q('undoBtn').addEventListener('click', do_undo)
  q('redoBtn').addEventListener('click', do_redo)
  const ti = q<HTMLInputElement>('title')
  ti.addEventListener('input', () => {
    dispatch('doc.set_name', ti.value)
  })
  ti.addEventListener('keydown', e => {
    if (e.key === 'Enter') ti.blur()
  })
}

function keydown(e: KeyboardEvent): void {
  const g = st()
  if (e.key === 'Shift') tool_mod_shift(1)
  if (tool_is_stroking() && e.key !== 'Escape' && e.key !== 'Shift') return
  if (typing_now()) {
    if (e.key === 'Escape') (document.activeElement as HTMLElement).blur()
    return
  }
  const k = e.key
  const K = k.length === 1 ? k.toUpperCase() : k
  if ((e.ctrlKey || e.metaKey) && K === 'Z' && !e.shiftKey) {
    e.preventDefault()
    do_undo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && (K === 'Y' || (K === 'Z' && e.shiftKey))) {
    e.preventDefault()
    do_redo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && K === 'C') {
    e.preventDefault()
    dispatch('sel.copy', null)
    return
  }
  if ((e.ctrlKey || e.metaKey) && K === 'X') {
    e.preventDefault()
    dispatch('sel.cut', null)
    return
  }
  if ((e.ctrlKey || e.metaKey) && K === 'V') {
    e.preventDefault()
    tool_pick(T_PASTE)
    return
  }
  if ((e.ctrlKey || e.metaKey) && K === 'S') {
    e.preventDefault()
    store_save_auto()
    toast('保存したよ')
    return
  }
  if (e.ctrlKey || e.metaKey) return
  if (k === 'Escape') {
    if (modal_active()) {
      modal_close()
      return
    }
    if (!q('ctxMenu').classList.contains('hide')) {
      ctx_hide()
      return
    }
    if (pop_is_open()) {
      pop_close()
      return
    }
    if (q('drawer').classList.contains('on')) {
      drawer_set(0)
      return
    }
    if (flo_active()) {
      dispatch('flo.cancel', null)
      return
    }
    if (g.sel.has) {
      dispatch('sel.clear', null)
      return
    }
    if (anim_playing()) anim_stop()
    return
  }
  if (modal_active()) return
  if (k === 'Enter') {
    if (flo_active()) {
      dispatch('flo.confirm', null)
      return
    }
  }
  if (k === ' ') {
    e.preventDefault()
    anim_toggle()
    return
  }
  if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
    e.preventDefault()
    if (flo_active()) {
      const d = e.shiftKey ? 10 : 1
      dispatch('flo.nudge', { dx: k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, dy: k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0 })
      return
    }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (anim_playing()) anim_stop()
      const n = g.doc.frames.length
      const i = clamp(g.doc.cur + (k === 'ArrowRight' ? 1 : -1), 0, n - 1)
      if (i !== g.doc.cur) {
        dispatch('frame.goto', i)
      }
    }
    return
  }
  if (k === 'Delete' || k === 'Backspace') {
    if (g.sel.has) dispatch('sel.delete', null)
    return
  }
  if (K === 'N') {
    dispatch('frame.add', null)
    return
  }
  if (K === 'D') {
    dispatch('frame.dup', null)
    return
  }
  if (k === '[' || k === ']') {
    const f = g.doc.frames[g.doc.cur]
    if (!f) return
    dispatch('frame.set_hold_range', { a: g.doc.cur, b: g.doc.cur, hold: f.hold + (k === ']' ? 1 : -1) })
    return
  }
  if (k === '+' || k === '=') {
    zoom_step(1.2)
    return
  }
  if (k === '-') {
    zoom_step(1 / 1.2)
    return
  }
  if (k === '0') {
    dispatch('view.fit', null)
    return
  }
  if (k === '1' || k === '2' || k === '3') {
    dispatch('pen.set_layer', Number(k))
    sfx_play('tap')
    return
  }
  for (const d of TOOL_DEFS) {
    if (d.key && d.key === K) {
      tool_pick(d.t)
      return
    }
  }
}

function keyup(e: KeyboardEvent): void {
  if (e.key === 'Shift') tool_mod_shift(0)
}

function zoom_step(f: number): void {
  const wrap = q('stageWrap')
  dispatch('view.zoom_at', { sx: wrap.clientWidth / 2, sy: wrap.clientHeight / 2, factor: f })
}

function pop_chrome_events(): void {
  const close_all = (e?: Event): void => {
    if (e?.cancelable) e.preventDefault()
    e?.stopPropagation()
    pop_close()
    rail_sheet(0)
  }
  q('popScrim').addEventListener('pointerdown', close_all)
  q('popScrim').addEventListener('click', close_all)
  const pops = document.querySelectorAll('.pop .popx')
  for (let i = 0; i < pops.length; i++) {
    const close = pops[i] as HTMLElement
    close.addEventListener('pointerdown', close_all)
    close.addEventListener('click', close_all)
  }
}

function outside_close(): void {
  document.addEventListener(
    'pointerdown',
    e => {
      const t = e.target as HTMLElement
      if (!q('ctxMenu').classList.contains('hide') && !t.closest('#ctxMenu')) ctx_hide()
      if (!pop_is_open()) return
      if (t.closest('.pop')) return
      if (t.closest('#rail') || t.closest('#quick') || t.closest('#tlBar')) return
      pop_close()
    },
    { capture: true }
  )
}

function input_interrupt(): void {
  fs_drag_clear()
  if (custLp) clearTimeout(custLp)
  custLp = 0
  if (markLp) clearTimeout(markLp)
  markLp = 0
  if (onionLp) clearTimeout(onionLp)
  onionLp = 0
  onionLpFired = 0
  tool_mod_shift(0)
  stage_interrupt()
}

export function input_mount(): void {
  custom_load()
  const wrap = q('stageWrap')
  const ants = q<HTMLCanvasElement>('antsCv').getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  const flo = q<HTMLCanvasElement>('floCv').getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  sel_bind(ants, flo)
  tool_bind_preview(ants)
  wrap.addEventListener('pointerdown', stage_down)
  wrap.addEventListener('lostpointercapture', stage_lost_capture)
  window.addEventListener('pointermove', stage_move, { capture: true })
  window.addEventListener('pointerup', stage_up, { capture: true })
  window.addEventListener('pointercancel', stage_cancel, { capture: true })
  window.addEventListener('pointerout', stage_pointer_out, { capture: true })
  wrap.addEventListener('wheel', stage_wheel, { passive: false })
  wrap.addEventListener('contextmenu', stage_ctx)
  wrap.addEventListener('pointerdown', sfx_warm, { once: true })
  rail_events()
  color_pop_events()
  tool_pop_events()
  mark_events()
  layer_pop_events()
  tf_pop_events()
  pop_close_hook(id => {
    if (id !== 'popTf') return
    tf_cancel()
    for (const [rid, v] of [['tfScale', '100'], ['tfDx', '0'], ['tfDy', '0'], ['tfRot', '0']]) q<HTMLInputElement>(rid).value = v
    q('tfScaleV').textContent = '100%'
    q('tfDxV').textContent = '0'
    q('tfDyV').textContent = '0'
    q('tfRotV').textContent = '0°'
  })
  quick_events()
  flobar_events()
  tl_events()
  header_events()
  fs_pointer(q('fs'))
  pop_chrome_events()
  mobile_ui_events()
  settings_events()
  outside_close()
  window.addEventListener('keydown', keydown)
  window.addEventListener('keyup', keyup)
  window.addEventListener('blur', input_interrupt)
  window.addEventListener('pagehide', input_interrupt)
  window.addEventListener('orientationchange', () => {
    input_interrupt()
    pop_close()
    rail_sheet(0)
    ctx_hide()
  }, { passive: true })
  window.addEventListener('resize', view_fit_if_stale)
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(view_fit_if_stale).observe(q('stageWrap'))
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    input_interrupt()
    store_save_auto()
  })
}
