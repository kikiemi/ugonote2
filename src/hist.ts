import { doc_frame_snap, doc_goto, doc_frame_insert, doc_frame_delete, doc_frame_move, doc_pack_layer, doc_unpack_live } from './doc'
import { live_slot } from './engine'
import { OP_PIX, OP_FRAME_INS, OP_FRAME_DEL, OP_FRAME_MOVE, OP_SE, OP_LAYER_ALPHA, OP_FRAME_CURSOR, MAX_UNDO_PC, MAX_UNDO_MOBILE, UNDO_BYTE_CAP, type HistEnt, type Frame, type Rle } from './h'
import { rle_pack, rle_unpack } from './lib'
import type { Globals } from './state/store'

const undoStack: HistEnt[] = []
const redoStack: HistEnt[] = []
let grpSeq = 1
let bytesHeld = 0

function ent_bytes(e: HistEnt): number {
  let b = 64
  if (e.before) b += e.before.byteLength
  if (e.after) b += e.after.byteLength
  if (e.snap) for (const pk of e.snap.pk) if (pk) b += pk.byteLength
  return b
}

function hist_cap(g: Globals): number {
  return g.mobile ? MAX_UNDO_MOBILE : MAX_UNDO_PC
}

function refresh_ent_bytes(e: HistEnt): void {
  const next = ent_bytes(e)
  bytesHeld += next - e.bytes
  e.bytes = next
}

function push_ent(g: Globals, e: HistEnt): void {
  e.bytes = ent_bytes(e)
  undoStack.push(e)
  bytesHeld += e.bytes
  for (const r of redoStack) bytesHeld -= r.bytes
  redoStack.length = 0
  let groups = 0
  let lastGrp = -1
  for (let i = undoStack.length - 1; i >= 0; i--) {
    if (undoStack[i].grp !== lastGrp) {
      groups++
      lastGrp = undoStack[i].grp
    }
  }
  while ((groups > hist_cap(g) || bytesHeld > UNDO_BYTE_CAP) && undoStack.length > 1) {
    const g0 = undoStack[0].grp
    while (undoStack.length > 0 && undoStack[0].grp === g0) {
      bytesHeld -= undoStack[0].bytes
      undoStack.shift()
    }
    groups--
  }
}

export function hist_grp(): number {
  return grpSeq++
}

export function rect_grab(l: number, x: number, y: number, w: number, h: number): Rle {
  const img = live_slot(l).getImageData(x, y, w, h)
  return rle_pack(new Uint32Array(img.data.buffer))
}

function rect_put(l: number, x: number, y: number, w: number, h: number, pk: Rle): void {
  const img = live_slot(l).createImageData(w, h)
  rle_unpack(pk, new Uint32Array(img.data.buffer))
  live_slot(l).putImageData(img, x, y)
}

function rle_equal(a: Rle, b: Rle): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function hist_pix(g: Globals, grp: number, f: number, l: number, x: number, y: number, w: number, h: number, before: Rle): number {
  const after = rect_grab(l, x, y, w, h)
  if (rle_equal(before, after)) return 0
  push_ent(g, { op: OP_PIX, grp, f, l, x, y, w, h, before, after, snap: null, a: 0, b: 0, bytes: 0 })
  return 1
}

export function hist_frame_ins(g: Globals, grp: number, i: number): void {
  push_ent(g, { op: OP_FRAME_INS, grp, f: i, l: 0, x: 0, y: 0, w: 0, h: 0, before: null, after: null, snap: null, a: 0, b: 0, bytes: 0 })
}

export function hist_frame_del(g: Globals, grp: number, i: number, snap: Frame, markA: number, markB: number): void {
  push_ent(g, { op: OP_FRAME_DEL, grp, f: i, l: 0, x: 0, y: 0, w: 0, h: 0, before: null, after: null, snap, a: markA, b: markB, bytes: 0 })
}

export function hist_frame_move(g: Globals, grp: number, a: number, b: number): void {
  push_ent(g, { op: OP_FRAME_MOVE, grp, f: 0, l: 0, x: 0, y: 0, w: 0, h: 0, before: null, after: null, snap: null, a, b, bytes: 0 })
}

export function hist_se(g: Globals, grp: number, i: number, before: number, after: number): void {
  push_ent(g, { op: OP_SE, grp, f: i, l: 0, x: 0, y: 0, w: 0, h: 0, before: null, after: null, snap: null, a: before, b: after, bytes: 0 })
}

export function hist_layer_alpha(g: Globals, grp: number, l: number, before: number, after: number): void {
  push_ent(g, { op: OP_LAYER_ALPHA, grp, f: 0, l, x: 0, y: 0, w: 0, h: 0, before: null, after: null, snap: null, a: before, b: after, bytes: 0 })
}

export function hist_frame_cursor(g: Globals, grp: number, beforeId: number, afterId: number): void {
  push_ent(g, { op: OP_FRAME_CURSOR, grp, f: 0, l: 0, x: 0, y: 0, w: 0, h: 0, before: null, after: null, snap: null, a: beforeId, b: afterId, bytes: 0 })
}

function apply_undo(g: Globals, e: HistEnt): void {
  if (e.op === OP_PIX) {
    doc_goto(g, e.f)
    rect_put(e.l, e.x, e.y, e.w, e.h, e.before as Rle)
    doc_pack_layer(g, e.l)
    return
  }
  if (e.op === OP_FRAME_INS) {
    e.snap = doc_frame_snap(g, e.f)
    refresh_ent_bytes(e)
    doc_frame_delete(g, e.f)
    return
  }
  if (e.op === OP_FRAME_DEL) {
    doc_frame_insert(g, e.f, e.snap as Frame)
    if (e.a) g.doc.loopA = e.f
    if (e.b) g.doc.loopB = e.f
    return
  }
  if (e.op === OP_FRAME_MOVE) {
    doc_frame_move(g, e.b, e.a)
    return
  }
  if (e.op === OP_SE) g.doc.frames[e.f].se = e.a
  if (e.op === OP_LAYER_ALPHA) g.doc.lalpha[e.l] = e.a
}

function apply_redo(g: Globals, e: HistEnt): void {
  if (e.op === OP_PIX) {
    doc_goto(g, e.f)
    rect_put(e.l, e.x, e.y, e.w, e.h, e.after as Rle)
    doc_pack_layer(g, e.l)
    return
  }
  if (e.op === OP_FRAME_INS) {
    doc_frame_insert(g, e.f, e.snap as Frame)
    return
  }
  if (e.op === OP_FRAME_DEL) {
    doc_frame_delete(g, e.f)
    return
  }
  if (e.op === OP_FRAME_MOVE) {
    doc_frame_move(g, e.a, e.b)
    return
  }
  if (e.op === OP_SE) g.doc.frames[e.f].se = e.b
  if (e.op === OP_LAYER_ALPHA) g.doc.lalpha[e.l] = e.b
}

export function hist_undo(g: Globals): number {
  if (undoStack.length === 0) return 0
  const g0 = undoStack[undoStack.length - 1].grp
  let first = undoStack.length - 1
  while (first > 0 && undoStack[first - 1].grp === g0) first--
  let selectId = undoStack.slice(first).every(e => e.op === OP_FRAME_MOVE) ? g.doc.frames[g.doc.cur]?.id : undefined
  while (undoStack.length > 0 && undoStack[undoStack.length - 1].grp === g0) {
    const e = undoStack.pop() as HistEnt
    if (e.op === OP_FRAME_CURSOR) selectId = e.a
    else apply_undo(g, e)
    redoStack.push(e)
  }
  if (selectId !== undefined) {
    const i = g.doc.frames.findIndex(f => f.id === selectId)
    if (i >= 0) g.doc.cur = i
  }
  doc_unpack_live(g)
  return 1
}

export function hist_redo(g: Globals): number {
  if (redoStack.length === 0) return 0
  const g0 = redoStack[redoStack.length - 1].grp
  let first = redoStack.length - 1
  while (first > 0 && redoStack[first - 1].grp === g0) first--
  let selectId = redoStack.slice(first).every(e => e.op === OP_FRAME_MOVE) ? g.doc.frames[g.doc.cur]?.id : undefined
  while (redoStack.length > 0 && redoStack[redoStack.length - 1].grp === g0) {
    const e = redoStack.pop() as HistEnt
    if (e.op === OP_FRAME_CURSOR) selectId = e.b
    else apply_redo(g, e)
    undoStack.push(e)
  }
  if (selectId !== undefined) {
    const i = g.doc.frames.findIndex(f => f.id === selectId)
    if (i >= 0) g.doc.cur = i
  }
  doc_unpack_live(g)
  return 1
}

export function hist_can_undo(): number {
  return undoStack.length > 0 ? 1 : 0
}

export function hist_can_redo(): number {
  return redoStack.length > 0 ? 1 : 0
}

export function hist_clear(): void {
  undoStack.length = 0
  redoStack.length = 0
  bytesHeld = 0
}
