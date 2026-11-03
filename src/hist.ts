import { doc_frame_snap, doc_goto, doc_frame_insert, doc_frame_delete, doc_frame_move, doc_pack_layer, doc_pack_live, doc_unpack_live } from './doc'
import { live_slot, live_write, live_bytes } from './engine'
import { op_pix, op_frame_ins, op_frame_del, op_frame_move, op_se, op_layer_alpha, op_frame_cursor, op_note, op_paper, type hist_ent_t, type frame_t, type note_state_t, type rle_t } from './h'
import { rle_pack, rle_unpack } from './lib'
import { memory_budget } from './memory'
import type { globals_t } from './state/store'

const undo_stack: hist_ent_t[] = []
const redo_stack: hist_ent_t[] = []
let grp_seq = 1
let bytes_held = 0

function ent_bytes(e: hist_ent_t): number {
  let b = 64
  if (e.paper) {
    b += (e.paper.before.length + e.paper.after.length) * 2
    for (let i = 0; i < e.paper.frames.length; i++) b += 8 + (e.paper.frames[i]?.length || 0) * 2
  }
  if (e.before) b += e.before.byteLength
  if (e.after) b += e.after.byteLength
  if (e.snap) for (const pk of e.snap.pk) if (pk) b += pk.byteLength
  if (e.note) b += e.note.frames.length * 64 + e.note.lord.length * 8
  return b
}

function hist_budget(g: globals_t): number {
  let packed_bytes = 0
  for (const image of g.doc.frames[g.doc.cur].pk) if (image) packed_bytes += image.byteLength
  const reserved = live_bytes() + Math.min(packed_bytes, memory_budget(g.mobile, 'history'))
  return Math.max(4 << 20, memory_budget(g.mobile, 'history') - Math.floor(reserved / 4))
}

function hist_cap(g: globals_t, budget: number): number {
  const per = bytes_held / Math.max(1, undo_stack.length + redo_stack.length)
  return Math.max(8, Math.min(g.mobile ? 256 : 1024, Math.floor(budget / Math.max(64, per))))
}

function refresh_ent_bytes(e: hist_ent_t): void {
  const next = ent_bytes(e)
  bytes_held += next - e.bytes
  e.bytes = next
}

function push_ent(g: globals_t, e: hist_ent_t): void {
  e.bytes = ent_bytes(e)
  undo_stack.push(e)
  bytes_held += e.bytes
  for (const r of redo_stack) bytes_held -= r.bytes
  redo_stack.length = 0
  let groups = 0
  let last_grp = -1
  for (let i = undo_stack.length - 1; i >= 0; i--) {
    if (undo_stack[i].grp !== last_grp) {
      groups++
      last_grp = undo_stack[i].grp
    }
  }
  const budget = hist_budget(g)
  const cap = hist_cap(g, budget)
  while ((groups > cap || bytes_held > budget) && groups > 1) {
    const g0 = undo_stack[0].grp
    while (undo_stack.length > 0 && undo_stack[0].grp === g0) {
      bytes_held -= undo_stack[0].bytes
      undo_stack.shift()
    }
    groups--
  }
}

export function hist_grp(): number {
  return grp_seq++
}

export function rect_grab(l: number, x: number, y: number, w: number, h: number): rle_t {
  const img = live_slot(l).getImageData(x, y, w, h)
  return rle_pack(new Uint32Array(img.data.buffer))
}

function rect_put(l: number, x: number, y: number, w: number, h: number, pk: rle_t): void {
  const img = live_slot(l).createImageData(w, h)
  rle_unpack(pk, new Uint32Array(img.data.buffer))
  live_write(l).putImageData(img, x, y)
}

function rle_equal(a: rle_t, b: rle_t): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function hist_pix(g: globals_t, grp: number, f: number, l: number, x: number, y: number, w: number, h: number, before: rle_t): number {
  const after = rect_grab(l, x, y, w, h)
  if (rle_equal(before, after)) return 0
  push_ent(g, { op: op_pix, grp, f, l, x, y, w, h, before, after, snap: null, a: 0, b: 0, bytes: 0 })
  return 1
}

export function hist_frame_ins(g: globals_t, grp: number, i: number): void {
  push_ent(g, { op: op_frame_ins, grp, f: i, l: 0, x: 0, y: 0, w: 0, h: 0, before: null, after: null, snap: null, a: 0, b: 0, bytes: 0 })
}

export function hist_frame_del(g: globals_t, grp: number, i: number, snap: frame_t, mark_a: number, mark_b: number): void {
  push_ent(g, { op: op_frame_del, grp, f: i, l: 0, x: 0, y: 0, w: 0, h: 0, before: null, after: null, snap, a: mark_a, b: mark_b, bytes: 0 })
}

export function hist_frame_move(g: globals_t, grp: number, a: number, b: number): void {
  push_ent(g, { op: op_frame_move, grp, f: 0, l: 0, x: 0, y: 0, w: 0, h: 0, before: null, after: null, snap: null, a, b, bytes: 0 })
}

export function hist_se(g: globals_t, grp: number, i: number, before: number, after: number): void {
  push_ent(g, { op: op_se, grp, f: i, l: 0, x: 0, y: 0, w: 0, h: 0, before: null, after: null, snap: null, a: before, b: after, bytes: 0 })
}

export function hist_layer_alpha(g: globals_t, grp: number, l: number, before: number, after: number): void {
  push_ent(g, { op: op_layer_alpha, grp, f: 0, l, x: 0, y: 0, w: 0, h: 0, before: null, after: null, snap: null, a: before, b: after, bytes: 0 })
}

export function hist_frame_cursor(g: globals_t, grp: number, before_id: number, after_id: number): void {
  push_ent(g, { op: op_frame_cursor, grp, f: 0, l: 0, x: 0, y: 0, w: 0, h: 0, before: null, after: null, snap: null, a: before_id, b: after_id, bytes: 0 })
}

export function hist_paper(g: globals_t, after: string): void {
  const frames: (string | undefined)[] = []
  for (let i = 0; i < g.doc.frames.length; i++) frames.push(g.doc.frames[i].paper)
  const paper = { before: g.doc.paper, after, frames }
  push_ent(g, { op: op_paper, grp: hist_grp(), paper, f: 0, l: 0, x: 0, y: 0, w: 0, h: 0, before: null, after: null, snap: null, a: 0, b: 0, bytes: 0 })
}

// いまのコマ全体の状態を取っておく。このあとコマのならびや設定を変えて、hist_note_push で記録する。
// 中身を変えるコマは、取っておいたコマを書きかえずに、新しいコマへ置きかえること。
export function hist_note_take(g: globals_t): note_state_t {
  doc_pack_live(g)
  return { frames: g.doc.frames.slice(), fps: g.doc.fps, loop_a: g.doc.loop_a, loop_b: g.doc.loop_b, lord: [...g.doc.lord], lvis: g.doc.lvis.slice(), lalpha: g.doc.lalpha.slice() }
}

// 続けて同じ変更をしたときに、1回の「もどす」でもどるようにまとめる印 (スライダーを動かしているあいだなど)。0 はまとめない。
export const hist_merge_hold = 1
// この時間 (ミリ秒) より間があいたら、まとめない。
const hist_merge_ms = 1500

// hist_note_take で取っておいた状態へ、1回の「もどす」でもどれるようにする。
// merge と target (コマの番号など) が直前の記録と同じなら、直前の記録にまとめる (取っておいた状態は直前のもののまま)。
// op_note の記録では、a にまとめる印、l に target、b に記録した時刻を入れる。
export function hist_note_push(g: globals_t, before: note_state_t, merge = 0, target = 0): void {
  const now = performance.now()
  const top = undo_stack[undo_stack.length - 1]
  if (merge && top && top.op === op_note && top.a === merge && top.l === target && now - top.b < hist_merge_ms && !redo_stack.length) {
    top.b = now
    return
  }
  push_ent(g, { op: op_note, grp: hist_grp(), note: before, f: 0, l: target, x: 0, y: 0, w: 0, h: 0, before: null, after: null, snap: null, a: merge, b: now, bytes: 0 })
}

// list の中身を from に入れかえ、もとの中身を返す。
function list_swap(list: Uint8Array, from: Uint8Array): Uint8Array {
  const old = list.slice()
  list.set(from)
  return old
}

// コマ全体の状態を、記録の中身と入れかえる (もどすときも、やり直すときも同じ)。いまのコマは同じコマのまま。
function note_swap(g: globals_t, e: hist_ent_t): void {
  const note = e.note as note_state_t
  const id = g.doc.frames[g.doc.cur].id
  doc_pack_live(g)
  const frames = g.doc.frames
  const fps = g.doc.fps
  const loop_a = g.doc.loop_a
  const loop_b = g.doc.loop_b
  const lord = g.doc.lord
  g.doc.frames = note.frames
  g.doc.fps = note.fps
  g.doc.loop_a = note.loop_a
  g.doc.loop_b = note.loop_b
  g.doc.lord = note.lord
  const lvis = list_swap(g.doc.lvis, note.lvis)
  const lalpha = list_swap(g.doc.lalpha, note.lalpha)
  e.note = { frames, fps, loop_a, loop_b, lord, lvis, lalpha }
  const at = g.doc.frames.findIndex(frame => frame.id === id)
  g.doc.cur = at >= 0 ? at : Math.min(g.doc.cur, g.doc.frames.length - 1)
  if (g.doc.lord.indexOf(g.pen.layer) < 0 && g.doc.lord.length) g.pen.layer = g.doc.lord[0]
}

// コマ全体を frames に、再生の速さを fps に置きかえて記録する。A-B 区間は同じコマのまま。
export function hist_note(g: globals_t, frames: frame_t[], fps: number): void {
  const before = hist_note_take(g)
  const marker = (value: number): number => {
    if (value < 0) return value
    const id = g.doc.frames[value]?.id
    return frames.findIndex(frame => frame.id === id)
  }
  const id = g.doc.frames[g.doc.cur].id
  g.doc.loop_a = marker(g.doc.loop_a)
  g.doc.loop_b = marker(g.doc.loop_b)
  g.doc.frames = frames
  g.doc.fps = fps
  const at = frames.findIndex(frame => frame.id === id)
  g.doc.cur = at >= 0 ? at : Math.min(g.doc.cur, frames.length - 1)
  hist_note_push(g, before)
}

function apply_undo(g: globals_t, e: hist_ent_t): void {
  if (e.op === op_note) {
    note_swap(g, e)
    return
  }
  if (e.op === op_paper && e.paper) {
    g.doc.paper = e.paper.before
    for (let i = 0; i < g.doc.frames.length; i++) g.doc.frames[i].paper = e.paper.frames[i]
    return
  }
  if (e.op === op_pix) {
    doc_goto(g, e.f)
    rect_put(e.l, e.x, e.y, e.w, e.h, e.before as rle_t)
    doc_pack_layer(g, e.l, { x: e.x, y: e.y, w: e.w, h: e.h })
    return
  }
  if (e.op === op_frame_ins) {
    e.snap = doc_frame_snap(g, e.f)
    refresh_ent_bytes(e)
    doc_frame_delete(g, e.f)
    return
  }
  if (e.op === op_frame_del) {
    doc_frame_insert(g, e.f, e.snap as frame_t)
    if (e.a) g.doc.loop_a = e.f
    if (e.b) g.doc.loop_b = e.f
    return
  }
  if (e.op === op_frame_move) {
    doc_frame_move(g, e.b, e.a)
    return
  }
  if (e.op === op_se) g.doc.frames[e.f].se = e.a
  if (e.op === op_layer_alpha) g.doc.lalpha[e.l] = e.a
}

function apply_redo(g: globals_t, e: hist_ent_t): void {
  if (e.op === op_note) {
    note_swap(g, e)
    return
  }
  if (e.op === op_paper && e.paper) {
    g.doc.paper = e.paper.after
    for (const frame of g.doc.frames) delete frame.paper
    return
  }
  if (e.op === op_pix) {
    doc_goto(g, e.f)
    rect_put(e.l, e.x, e.y, e.w, e.h, e.after as rle_t)
    doc_pack_layer(g, e.l, { x: e.x, y: e.y, w: e.w, h: e.h })
    return
  }
  if (e.op === op_frame_ins) {
    doc_frame_insert(g, e.f, e.snap as frame_t)
    return
  }
  if (e.op === op_frame_del) {
    doc_frame_delete(g, e.f)
    return
  }
  if (e.op === op_frame_move) {
    doc_frame_move(g, e.a, e.b)
    return
  }
  if (e.op === op_se) g.doc.frames[e.f].se = e.b
  if (e.op === op_layer_alpha) g.doc.lalpha[e.l] = e.b
}

// もどせたら 1、コマ全体の状態までもどしたら 2 を返す。もどせなければ 0。
export function hist_undo(g: globals_t): number {
  if (undo_stack.length === 0) return 0
  const g0 = undo_stack[undo_stack.length - 1].grp
  let first = undo_stack.length - 1
  while (first > 0 && undo_stack[first - 1].grp === g0) first--
  let select_id = undo_stack.slice(first).every(e => e.op === op_frame_move) ? g.doc.frames[g.doc.cur]?.id : undefined
  let whole = 0
  while (undo_stack.length > 0 && undo_stack[undo_stack.length - 1].grp === g0) {
    const e = undo_stack.pop() as hist_ent_t
    if (e.op === op_frame_cursor) select_id = e.a
    else apply_undo(g, e)
    if (e.op === op_note) whole = 1
    redo_stack.push(e)
  }
  if (select_id !== undefined) {
    const i = g.doc.frames.findIndex(f => f.id === select_id)
    if (i >= 0) g.doc.cur = i
  }
  doc_unpack_live(g)
  return whole ? 2 : 1
}

// やり直せたら 1、コマ全体の状態までやり直したら 2 を返す。やり直せなければ 0。
export function hist_redo(g: globals_t): number {
  if (redo_stack.length === 0) return 0
  const g0 = redo_stack[redo_stack.length - 1].grp
  let first = redo_stack.length - 1
  while (first > 0 && redo_stack[first - 1].grp === g0) first--
  let select_id = redo_stack.slice(first).every(e => e.op === op_frame_move) ? g.doc.frames[g.doc.cur]?.id : undefined
  let whole = 0
  while (redo_stack.length > 0 && redo_stack[redo_stack.length - 1].grp === g0) {
    const e = redo_stack.pop() as hist_ent_t
    if (e.op === op_frame_cursor) select_id = e.b
    else apply_redo(g, e)
    if (e.op === op_note) whole = 1
    undo_stack.push(e)
  }
  if (select_id !== undefined) {
    const i = g.doc.frames.findIndex(f => f.id === select_id)
    if (i >= 0) g.doc.cur = i
  }
  doc_unpack_live(g)
  return whole ? 2 : 1
}

export function hist_can_undo(): number {
  return undo_stack.length > 0 ? 1 : 0
}

export function hist_can_redo(): number {
  return redo_stack.length > 0 ? 1 : 0
}

export function hist_clear(): void {
  undo_stack.length = 0
  redo_stack.length = 0
  bytes_held = 0
}
