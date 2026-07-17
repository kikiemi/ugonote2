import { animfx_cache_clear } from '../../animfx'
import { doc_cache_clear, doc_frame_clone, doc_frame_new, doc_frame_snap, doc_frame_insert, doc_frame_delete, doc_frame_move, doc_goto, doc_pack_live, doc_pack_layer, doc_unpack_live, frame_id_next, doc_loop_insert, doc_loop_delete, doc_loop_move } from '../../doc'
import { live_slot, live_canvas } from '../../engine'
import { D_ALL, D_STAGE, D_THUMB, D_TIMELINE, D_FRAMEINFO, D_LAYER, D_TOOLS, D_PLAY, D_SOUND, D_PAGE, L_DRAW_DEFAULT, L_DRAW_MAX, L_N, HOLD_MAX, FPS_SPEEDS, ERR_BAD, ERR_NOOP, ERR_FULL, MODE_NORMAL, type Frame, type NoteMeta, type Rle } from '../../h'
import { hist_grp, hist_frame_ins, hist_frame_del, hist_frame_move, hist_se, hist_pix, rect_grab, hist_undo, hist_redo, hist_clear, hist_layer_alpha, hist_frame_cursor } from '../../hist'
import { canvas_make, clamp, hex_rgb } from '../../lib'
import { mode_allows_layer_alpha, mode_frame_limit, mode_order, mode_paper_opts } from '../../mode'
import { thumb_clear } from '../../thumb'
import { fx_toast, fx_sfx } from '../fx_hooks'
import type { Globals } from '../store'
import { anim_playing, PLAY_COMMANDS } from './play'

type PixelChange = {
  layer: number
  x: number
  y: number
  w: number
  h: number
  before: Rle
}

type PixelCommit = {
  grp: number
  frame: number
  changes: PixelChange[]
}

let frameClip: Frame | null = null

function stop_if_playing(g: Globals): void {
  if (anim_playing()) PLAY_COMMANDS['play.stop'](g, null)
}

function frame_limit(g: Globals): number {
  return mode_frame_limit(g.doc.mode)
}

function frame_room(g: Globals): number {
  return Math.max(0, frame_limit(g) - g.doc.frames.length)
}

function frame_full(g: Globals): number {
  fx_toast('これ以上コマを増やせないよ（最大' + frame_limit(g) + '）')
  return ERR_FULL
}

function range_bounds(g: Globals, a0: number, b0: number): [number, number] {
  const n = g.doc.frames.length
  const aa = Number.isFinite(a0) ? Math.trunc(a0) : g.doc.cur
  const bb = Number.isFinite(b0) ? Math.trunc(b0) : g.doc.cur
  const a = clamp(Math.min(aa, bb), 0, n - 1)
  const b = clamp(Math.max(aa, bb), a, n - 1)
  return [a, b]
}

function commit_pixels(g: Globals, p: PixelCommit): number {
  if (p.frame !== g.doc.cur || !p.changes.length) return ERR_BAD
  for (const c of p.changes) {
    if (c.layer < 0 || c.layer >= g.doc.frames[p.frame].pk.length || c.x < 0 || c.y < 0 || c.w < 1 || c.h < 1 || c.x + c.w > g.doc.w || c.y + c.h > g.doc.h) return ERR_BAD
  }
  const packed = new Set<number>()
  for (const c of p.changes) {
    if (hist_pix(g, p.grp, p.frame, c.layer, c.x, c.y, c.w, c.h, c.before)) packed.add(c.layer)
  }
  if (!packed.size) return ERR_NOOP
  for (const layer of packed) doc_pack_layer(g, layer)
  return 0
}

export type Cmds = {
  'frame.goto': number
  'frame.step': number
  'frame.add': null
  'frame.dup': null
  'frame.del': null
  'frame.copy': null
  'frame.paste': null
  'frame.move': { a: number, b: number }
  'frame.add_many': number
  'frame.se_toggle': { i: number, bit: number }
  'frame.set_hold_range': { a: number, b: number, hold: number }
  'frame.insert_bulk': { at: number, frames: Frame[], setCur: number }
  'frame.append_bulk': { frames: Frame[], setCur: number }
  'frame.replace_current_bulk': { frames: Frame[] }
  'frame.delete_range': { a: number, b: number }
  'frame.reverse_range': { a: number, b: number }
  'frame.duplicate_range': { a: number, b: number, pingPong: number }
  'frame.sync_live': null
  'frame.sync_layer': number
  'frame.commit_pixels': PixelCommit
  'history.undo': null
  'history.redo': null
  'layer.toggle_visible': number
  'layer.reorder_swap': { i: number, j: number }
  'layer.set_alpha': { l: number, a255: number }
  'layer.clear': null
  'layer.copy_to': number
  'layer.merge_down': null
  'layer.add': null
  'layer.delete': number
  'doc.set_name': string
  'doc.set_paper': string
  'doc.set_fps_idx': number
  'doc.toggle_loop': null
  'doc.set_loop_a': number
  'doc.set_loop_b': number
  'doc.clear_loop_ab': null
  'doc.set_meta': NoteMeta
}

export const FRAME_COMMANDS = {
  'frame.goto': (g: Globals, i: number): number => {
    if (!Number.isFinite(i)) return ERR_BAD
    stop_if_playing(g)
    const to = clamp(Math.trunc(i), 0, g.doc.frames.length - 1)
    if (to === g.doc.cur) return ERR_NOOP
    return doc_goto(g, to)
  },

  'frame.step': (g: Globals, d: number): number => FRAME_COMMANDS['frame.goto'](g, g.doc.cur + d),

  'frame.add': (g: Globals, _p: null): number => {
    if (!frame_room(g)) return frame_full(g)
    stop_if_playing(g)
    const i = g.doc.cur + 1
    doc_frame_insert(g, i, doc_frame_new())
    hist_frame_ins(g, hist_grp(), i)
    fx_sfx('paper')
    return 0
  },

  'frame.dup': (g: Globals, _p: null): number => {
    if (!frame_room(g)) return frame_full(g)
    stop_if_playing(g)
    doc_pack_live(g)
    const snap = doc_frame_clone(g.doc.frames[g.doc.cur])
    const i = g.doc.cur + 1
    doc_frame_insert(g, i, snap)
    hist_frame_ins(g, hist_grp(), i)
    fx_sfx('dup')
    return 0
  },

  'frame.del': (g: Globals, _p: null): number => {
    stop_if_playing(g)
    const i = g.doc.cur
    const markA = g.doc.loopA === i ? 1 : 0
    const markB = g.doc.loopB === i ? 1 : 0
    const removed = doc_frame_delete(g, i)
    if (!removed) {
      fx_toast('最後の1枚は消せないよ')
      return ERR_NOOP
    }
    hist_frame_del(g, hist_grp(), i, removed, markA, markB)
    fx_sfx('del')
    return 0
  },

  'frame.copy': (g: Globals, _p: null): number => {
    frameClip = doc_frame_snap(g, g.doc.cur)
    fx_toast('コマをコピーしました')
    fx_sfx('tap')
    return 0
  },

  'frame.paste': (g: Globals, _p: null): number => {
    if (!frameClip) {
      fx_toast('コピーしたコマがないよ')
      return ERR_NOOP
    }
    if (!frame_room(g)) return frame_full(g)
    stop_if_playing(g)
    const i = g.doc.cur + 1
    const frame = { id: frame_id_next(), se: frameClip.se, hold: frameClip.hold, pk: frameClip.pk.map(p => (p ? p.slice() : null)) }
    doc_frame_insert(g, i, frame)
    hist_frame_ins(g, hist_grp(), i)
    fx_sfx('paper')
    return 0
  },

  'frame.move': (g: Globals, p: { a: number, b: number }): number => {
    if (!Number.isInteger(p.a) || !Number.isInteger(p.b)) return ERR_BAD
    stop_if_playing(g)
    if (doc_frame_move(g, p.a, p.b) !== 0) return ERR_BAD
    hist_frame_move(g, hist_grp(), p.a, p.b)
    fx_sfx('move')
    return 0
  },

  'frame.add_many': (g: Globals, n: number): number => {
    if (!Number.isFinite(n)) return ERR_BAD
    const room = frame_room(g)
    if (room < 1) return frame_full(g)
    const cnt = clamp(Math.round(n), 1, room)
    stop_if_playing(g)
    const grp = hist_grp()
    doc_pack_live(g)
    for (let k = 0; k < cnt; k++) {
      const i = g.doc.cur + 1
      g.doc.frames.splice(i, 0, doc_frame_new())
      doc_loop_insert(g, i)
      g.doc.cur = i
      hist_frame_ins(g, grp, i)
    }
    doc_unpack_live(g)
    fx_toast(cnt + 'コマ追加しました')
    fx_sfx('paper')
    return 0
  },

  'frame.se_toggle': (g: Globals, p: { i: number, bit: number }): number => {
    if (!Number.isInteger(p.i) || !Number.isInteger(p.bit)) return ERR_BAD
    const f = g.doc.frames[p.i]
    if (!f || p.bit < 0 || p.bit > 3) return ERR_BAD
    const before = f.se
    f.se ^= 1 << p.bit
    hist_se(g, hist_grp(), p.i, before, f.se)
    fx_sfx('tap')
    return 0
  },

  'frame.set_hold_range': (g: Globals, p: { a: number, b: number, hold: number }): number => {
    if (!Number.isFinite(p.a) || !Number.isFinite(p.b) || !Number.isFinite(p.hold)) return ERR_BAD
    const [a, b] = range_bounds(g, p.a, p.b)
    const hold = clamp(Math.round(p.hold), 1, HOLD_MAX)
    let changed = 0
    for (let i = a; i <= b; i++) {
      if (g.doc.frames[i].hold === hold) continue
      g.doc.frames[i].hold = hold
      changed = 1
    }
    return changed ? 0 : ERR_NOOP
  },

  'frame.insert_bulk': (g: Globals, p: { at: number, frames: Frame[], setCur: number }): number => {
    if (!Number.isFinite(p.at) || !Number.isFinite(p.setCur) || !Array.isArray(p.frames)) return ERR_BAD
    if (!p.frames.length) return ERR_NOOP
    const room = frame_room(g)
    if (room < 1) return ERR_FULL
    stop_if_playing(g)
    doc_pack_live(g)
    const at = clamp(Math.round(p.at), 0, g.doc.frames.length)
    const frames = p.frames.slice(0, room)
    g.doc.frames.splice(at, 0, ...frames)
    doc_loop_insert(g, at, frames.length)
    g.doc.cur = clamp(Math.trunc(p.setCur), 0, g.doc.frames.length - 1)
    hist_clear()
    thumb_clear()
    animfx_cache_clear()
    doc_unpack_live(g)
    return 0
  },

  'frame.append_bulk': (g: Globals, p: { frames: Frame[], setCur: number }): number => {
    if (!Number.isFinite(p.setCur) || !Array.isArray(p.frames)) return ERR_BAD
    if (!p.frames.length) return ERR_NOOP
    const room = frame_room(g)
    if (room < 1) return ERR_FULL
    stop_if_playing(g)
    doc_pack_live(g)
    g.doc.frames.push(...p.frames.slice(0, room))
    g.doc.cur = clamp(Math.trunc(p.setCur), 0, g.doc.frames.length - 1)
    hist_clear()
    thumb_clear()
    animfx_cache_clear()
    doc_unpack_live(g)
    return 0
  },

  'frame.replace_current_bulk': (g: Globals, p: { frames: Frame[] }): number => {
    if (!Array.isArray(p.frames) || p.frames.length < 2) return ERR_BAD
    if (g.doc.frames.length - 1 + p.frames.length > frame_limit(g)) return ERR_FULL
    for (const frame of p.frames) if (!frame || !Array.isArray(frame.pk) || frame.pk.length !== L_N) return ERR_BAD
    stop_if_playing(g)
    doc_pack_live(g)
    const at = g.doc.cur
    const delta = p.frames.length - 1
    g.doc.frames.splice(at, 1, ...p.frames)
    const move_marker = (value: number): number => value < 0 || value < at ? value : value === at ? at : value + delta
    g.doc.loopA = move_marker(g.doc.loopA)
    g.doc.loopB = move_marker(g.doc.loopB)
    g.doc.cur = at
    hist_clear()
    thumb_clear()
    doc_cache_clear()
    animfx_cache_clear()
    doc_unpack_live(g)
    return 0
  },

  'frame.delete_range': (g: Globals, p: { a: number, b: number }): number => {
    if (!Number.isFinite(p.a) || !Number.isFinite(p.b)) return ERR_BAD
    const [a, b] = range_bounds(g, p.a, p.b)
    if (b - a + 1 >= g.doc.frames.length) return ERR_BAD
    stop_if_playing(g)
    doc_pack_live(g)
    const current = g.doc.frames[g.doc.cur]
    const count = b - a + 1
    g.doc.frames.splice(a, count)
    doc_loop_delete(g, a, count)
    const keep = g.doc.frames.indexOf(current)
    g.doc.cur = keep >= 0 ? keep : Math.min(a, g.doc.frames.length - 1)
    hist_clear()
    thumb_clear()
    animfx_cache_clear()
    doc_unpack_live(g)
    return 0
  },

  'frame.reverse_range': (g: Globals, p: { a: number, b: number }): number => {
    if (!Number.isFinite(p.a) || !Number.isFinite(p.b)) return ERR_BAD
    const [a, b] = range_bounds(g, p.a, p.b)
    if (a === b) return ERR_NOOP
    stop_if_playing(g)
    doc_pack_live(g)
    const current = g.doc.frames[g.doc.cur]
    const grp = hist_grp()
    for (let k = 0; k < b - a; k++) {
      const to = a + k
      const frame = g.doc.frames.splice(b, 1)[0]
      g.doc.frames.splice(to, 0, frame)
      doc_loop_move(g, b, to)
      hist_frame_move(g, grp, b, to)
    }
    g.doc.cur = g.doc.frames.indexOf(current)
    doc_unpack_live(g)
    return 0
  },

  'frame.duplicate_range': (g: Globals, p: { a: number, b: number, pingPong: number }): number => {
    if (!Number.isFinite(p.a) || !Number.isFinite(p.b)) return ERR_BAD
    const [a, b] = range_bounds(g, p.a, p.b)
    if (p.pingPong && b - a < 2) return ERR_BAD
    const room = frame_room(g)
    if (room < 1) return ERR_FULL
    stop_if_playing(g)
    doc_pack_live(g)
    const beforeId = g.doc.frames[g.doc.cur].id
    const src: Frame[] = []
    if (p.pingPong) {
      for (let i = b - 1; i > a; i--) src.push(doc_frame_clone(g.doc.frames[i]))
    } else {
      for (let i = a; i <= b; i++) src.push(doc_frame_clone(g.doc.frames[i]))
    }
    const take = Math.min(room, src.length)
    const grp = hist_grp()
    for (let k = 0; k < take; k++) {
      const at = b + 1 + k
      g.doc.frames.splice(at, 0, src[k])
      doc_loop_insert(g, at)
      g.doc.cur = at
      hist_frame_ins(g, grp, at)
    }
    hist_frame_cursor(g, grp, beforeId, g.doc.frames[g.doc.cur].id)
    doc_unpack_live(g)
    if (take < src.length) fx_toast('上限で一部だけ足したよ')
    return 0
  },

  'frame.sync_live': (g: Globals, _p: null): number => {
    doc_pack_live(g)
    return 0
  },

  'frame.sync_layer': (g: Globals, layer: number): number => {
    if (!Number.isInteger(layer) || layer < 0 || layer >= g.doc.frames[g.doc.cur].pk.length) return ERR_BAD
    doc_pack_layer(g, layer)
    return 0
  },

  'frame.commit_pixels': (g: Globals, p: PixelCommit): number => commit_pixels(g, p),

  'history.undo': (g: Globals, _p: null): number => {
    stop_if_playing(g)
    if (!hist_undo(g)) return ERR_NOOP
    fx_sfx('undo')
    return 0
  },

  'history.redo': (g: Globals, _p: null): number => {
    stop_if_playing(g)
    if (!hist_redo(g)) return ERR_NOOP
    fx_sfx('redo')
    return 0
  },

  'layer.toggle_visible': (g: Globals, l: number): number => {
    if (!Number.isInteger(l) || l < 0 || l >= g.doc.lvis.length) return ERR_BAD
    g.doc.lvis[l] = g.doc.lvis[l] ? 0 : 1
    return 0
  },

  'layer.reorder_swap': (g: Globals, p: { i: number, j: number }): number => {
    const o = g.doc.lord
    if (!Number.isInteger(p.i) || !Number.isInteger(p.j) || p.i < 0 || p.j < 0 || p.i >= o.length || p.j >= o.length) return ERR_BAD
    const t = o[p.i]
    o[p.i] = o[p.j]
    o[p.j] = t
    return 0
  },

  'layer.set_alpha': (g: Globals, p: { l: number, a255: number }): number => {
    if (!mode_allows_layer_alpha(g.doc.mode)) return ERR_BAD
    if (!Number.isInteger(p.l) || !Number.isFinite(p.a255) || p.l < 0 || p.l >= g.doc.lalpha.length) return ERR_BAD
    const a = clamp(Math.round(p.a255), 0, 255)
    if (g.doc.lalpha[p.l] === a) return ERR_NOOP
    g.doc.lalpha[p.l] = a
    return 0
  },

  'layer.clear': (g: Globals, _p: null): number => {
    stop_if_playing(g)
    const layer = g.pen.layer
    const before = rect_grab(layer, 0, 0, g.doc.w, g.doc.h)
    live_slot(layer).clearRect(0, 0, g.doc.w, g.doc.h)
    return commit_pixels(g, { grp: hist_grp(), frame: g.doc.cur, changes: [{ layer, x: 0, y: 0, w: g.doc.w, h: g.doc.h, before }] })
  },

  'layer.copy_to': (g: Globals, dst: number): number => {
    const src = g.pen.layer
    const order = mode_order(g.doc.mode, g.doc.lord)
    if (!Number.isInteger(dst) || dst < 1 || dst >= g.doc.frames[g.doc.cur].pk.length || dst === src || order.indexOf(src) < 0 || order.indexOf(dst) < 0) return ERR_BAD
    stop_if_playing(g)
    const before = rect_grab(dst, 0, 0, g.doc.w, g.doc.h)
    live_slot(dst).drawImage(live_canvas(src), 0, 0)
    return commit_pixels(g, { grp: hist_grp(), frame: g.doc.cur, changes: [{ layer: dst, x: 0, y: 0, w: g.doc.w, h: g.doc.h, before }] })
  },

  'layer.merge_down': (g: Globals, _p: null): number => {
    stop_if_playing(g)
    const src = g.pen.layer
    const order = mode_order(g.doc.mode, g.doc.lord)
    const k = order.indexOf(src)
    if (k < 0 || k >= order.length - 1) {
      fx_toast('いちばん下のレイヤーは結合できないよ')
      return ERR_NOOP
    }
    const dst = order[k + 1]
    const beforeDst = rect_grab(dst, 0, 0, g.doc.w, g.doc.h)
    const beforeSrc = rect_grab(src, 0, 0, g.doc.w, g.doc.h)
    const beforeAlpha = g.doc.lalpha[dst]
    const alphaEnabled = mode_allows_layer_alpha(g.doc.mode)
    const [merged, mx] = canvas_make(g.doc.w, g.doc.h)
    mx.globalAlpha = alphaEnabled ? beforeAlpha / 255 : 1
    mx.drawImage(live_canvas(dst), 0, 0)
    mx.globalAlpha = alphaEnabled ? g.doc.lalpha[src] / 255 : 1
    mx.drawImage(live_canvas(src), 0, 0)
    mx.globalAlpha = 1
    const dx = live_slot(dst)
    dx.clearRect(0, 0, g.doc.w, g.doc.h)
    dx.drawImage(merged, 0, 0)
    live_slot(src).clearRect(0, 0, g.doc.w, g.doc.h)
    const grp = hist_grp()
    const result = commit_pixels(g, {
      grp,
      frame: g.doc.cur,
      changes: [
        { layer: dst, x: 0, y: 0, w: g.doc.w, h: g.doc.h, before: beforeDst },
        { layer: src, x: 0, y: 0, w: g.doc.w, h: g.doc.h, before: beforeSrc },
      ],
    })
    if (result < 0) return result
    if (beforeAlpha !== 255) {
      g.doc.lalpha[dst] = 255
      hist_layer_alpha(g, grp, dst, beforeAlpha, 255)
    }
    g.pen.layer = dst
    fx_toast('下のレイヤーと結合しました')
    fx_sfx('paper')
    return 0
  },


  'layer.add': (g: Globals, _p: null): number => {
    if (g.doc.mode !== MODE_NORMAL) return ERR_BAD
    if (g.doc.lord.length >= L_DRAW_MAX) {
      fx_toast('レイヤーは最大' + L_DRAW_MAX + '枚だよ')
      return ERR_FULL
    }
    stop_if_playing(g)
    let layer = 0
    for (let candidate = L_DRAW_DEFAULT + 1; candidate <= L_DRAW_MAX; candidate++) {
      if (g.doc.lord.indexOf(candidate) < 0) {
        layer = candidate
        break
      }
    }
    if (!layer) return ERR_FULL
    for (const frame of g.doc.frames) frame.pk[layer] = null
    live_slot(layer).clearRect(0, 0, g.doc.w, g.doc.h)
    g.doc.lvis[layer] = 1
    g.doc.lalpha[layer] = 255
    g.doc.lord.unshift(layer)
    g.pen.layer = layer
    hist_clear()
    thumb_clear()
    doc_cache_clear()
    animfx_cache_clear()
    fx_toast('レイヤーを追加しました')
    fx_sfx('paper')
    return 0
  },

  'layer.delete': (g: Globals, layer: number): number => {
    if (g.doc.mode !== MODE_NORMAL || !Number.isInteger(layer) || layer <= L_DRAW_DEFAULT || layer > L_DRAW_MAX) return ERR_BAD
    const index = g.doc.lord.indexOf(layer)
    if (index < 0) return ERR_BAD
    stop_if_playing(g)
    for (const frame of g.doc.frames) frame.pk[layer] = null
    live_slot(layer).clearRect(0, 0, g.doc.w, g.doc.h)
    g.doc.lord.splice(index, 1)
    g.doc.lvis[layer] = 0
    g.doc.lalpha[layer] = 255
    if (g.pen.layer === layer) g.pen.layer = g.doc.lord[Math.min(index, g.doc.lord.length - 1)] || 1
    hist_clear()
    thumb_clear()
    doc_cache_clear()
    animfx_cache_clear()
    fx_toast('レイヤーを削除しました')
    fx_sfx('del')
    return 0
  },

  'doc.set_name': (g: Globals, name: string): number => {
    if (g.doc.name === name) return ERR_NOOP
    g.doc.name = name
    return 0
  },

  'doc.set_paper': (g: Globals, color: string): number => {
    const opts = mode_paper_opts(g.doc.mode)
    let c = color
    if (opts.length > 1 && opts.indexOf(c.toUpperCase()) < 0) {
      const [r, gg, b] = hex_rgb(c)
      let best = 0
      let bestDist = Infinity
      for (let i = 0; i < opts.length; i++) {
        const [pr, pg, pb] = hex_rgb(opts[i])
        const dist = (pr - r) * (pr - r) + (pg - gg) * (pg - gg) + (pb - b) * (pb - b)
        if (dist < bestDist) {
          bestDist = dist
          best = i
        }
      }
      c = opts[best]
    }
    if (g.doc.paper === c) return ERR_NOOP
    g.doc.paper = c
    return 0
  },

  'doc.set_fps_idx': (g: Globals, i: number): number => {
    if (!Number.isFinite(i)) return ERR_BAD
    const fps = FPS_SPEEDS[clamp(Math.round(i), 0, FPS_SPEEDS.length - 1)]
    if (g.doc.fps === fps) return ERR_NOOP
    g.doc.fps = fps
    return 0
  },

  'doc.toggle_loop': (g: Globals, _p: null): number => {
    g.doc.loop = g.doc.loop ? 0 : 1
    return 0
  },

  'doc.set_loop_a': (g: Globals, i: number): number => {
    if (!Number.isFinite(i)) return ERR_BAD
    const v = clamp(Math.round(i), -1, g.doc.frames.length - 1)
    g.doc.loopA = v
    if (g.doc.loopB >= 0 && g.doc.loopB < v) g.doc.loopB = -1
    return 0
  },

  'doc.set_loop_b': (g: Globals, i: number): number => {
    if (!Number.isFinite(i)) return ERR_BAD
    const v = clamp(Math.round(i), -1, g.doc.frames.length - 1)
    g.doc.loopB = v
    if (g.doc.loopA >= 0 && g.doc.loopA > v) g.doc.loopA = -1
    return 0
  },

  'doc.set_meta': (g: Globals, m: NoteMeta): number => {
    g.doc.meta = m
    return 0
  },

  'doc.clear_loop_ab': (g: Globals, _p: null): number => {
    if (g.doc.loopA < 0 && g.doc.loopB < 0) return ERR_NOOP
    g.doc.loopA = -1
    g.doc.loopB = -1
    return 0
  },
}

const D_FRAME = D_TIMELINE | D_FRAMEINFO | D_STAGE | D_THUMB | D_LAYER | D_TOOLS | D_PLAY
const D_PIXELS = D_STAGE | D_THUMB | D_TOOLS | D_PLAY

export const FRAME_EFFECTS: Partial<Record<keyof Cmds, number>> = {
  'frame.goto': D_STAGE | D_FRAMEINFO | D_TIMELINE | D_THUMB | D_LAYER,
  'frame.step': D_STAGE | D_FRAMEINFO | D_TIMELINE | D_THUMB | D_LAYER,
  'frame.add': D_FRAME,
  'frame.dup': D_FRAME,
  'frame.del': D_FRAME,
  'frame.paste': D_FRAME,
  'frame.move': D_FRAME,
  'frame.add_many': D_FRAME,
  'frame.se_toggle': D_THUMB | D_SOUND | D_TOOLS,
  'frame.set_hold_range': D_TIMELINE | D_FRAMEINFO | D_PLAY,
  'frame.insert_bulk': D_ALL,
  'frame.append_bulk': D_ALL,
  'frame.replace_current_bulk': D_ALL,
  'frame.delete_range': D_ALL,
  'frame.reverse_range': D_FRAME,
  'frame.duplicate_range': D_FRAME,
  'frame.sync_live': 0,
  'frame.sync_layer': 0,
  'frame.commit_pixels': D_PIXELS,
  'history.undo': D_STAGE | D_THUMB | D_TIMELINE | D_FRAMEINFO | D_TOOLS | D_LAYER | D_PLAY,
  'history.redo': D_STAGE | D_THUMB | D_TIMELINE | D_FRAMEINFO | D_TOOLS | D_LAYER | D_PLAY,
  'layer.toggle_visible': D_STAGE | D_LAYER,
  'layer.reorder_swap': D_STAGE | D_LAYER,
  'layer.set_alpha': D_STAGE | D_LAYER,
  'layer.clear': D_PIXELS,
  'layer.copy_to': D_PIXELS,
  'layer.merge_down': D_PIXELS | D_LAYER,
  'layer.add': D_LAYER | D_STAGE | D_TOOLS,
  'layer.delete': D_ALL,
  'doc.set_name': D_PAGE,
  'doc.set_paper': D_STAGE | D_THUMB | D_PAGE | D_TOOLS,
  'doc.set_fps_idx': D_PLAY | D_FRAMEINFO,
  'doc.toggle_loop': D_PLAY,
  'doc.set_loop_a': D_TIMELINE | D_PLAY,
  'doc.set_loop_b': D_TIMELINE | D_PLAY,
  'doc.clear_loop_ab': D_TIMELINE | D_PLAY,
  'doc.set_meta': 0,
}

export const FRAME_TOUCH = new Set<keyof Cmds>([
  'frame.add', 'frame.dup', 'frame.del', 'frame.paste', 'frame.move', 'frame.add_many',
  'frame.se_toggle', 'frame.set_hold_range', 'frame.insert_bulk', 'frame.append_bulk', 'frame.replace_current_bulk', 'frame.delete_range',
  'frame.reverse_range', 'frame.duplicate_range', 'frame.commit_pixels', 'history.undo', 'history.redo',
  'layer.toggle_visible', 'layer.reorder_swap', 'layer.set_alpha', 'layer.clear', 'layer.copy_to', 'layer.merge_down', 'layer.add', 'layer.delete',
  'doc.set_name', 'doc.set_paper', 'doc.set_fps_idx', 'doc.toggle_loop', 'doc.set_loop_a', 'doc.set_loop_b',
  'doc.clear_loop_ab', 'doc.set_meta',
])
