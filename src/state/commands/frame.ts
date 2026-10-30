import { animfx_cache_clear } from '../../animfx'
import { doc_frame_order, doc_cache_clear, doc_frame_clone, doc_frame_new, doc_frame_snap, doc_frame_insert, doc_frame_delete, doc_frame_move, doc_goto, doc_pack_live, doc_pack_layer, doc_unpack_live, doc_loop_insert, doc_loop_delete, doc_loop_move } from '../../doc'
import { live_write, live_drop, live_accept, live_canvas } from '../../engine'
import { d_all, d_stage, d_thumb, d_timeline, d_frameinfo, d_layer, d_tools, d_play, d_sound, d_page, l_draw_default, l_draw_max, l_n, hold_max, err_bad, err_noop, err_full, mode_normal, mode_3_d, type frame_t, type note_meta_t, type rle_t } from '../../h'
import { hist_grp, hist_frame_ins, hist_frame_del, hist_frame_move, hist_se, hist_pix, rect_grab, hist_undo, hist_redo, hist_clear, hist_layer_alpha, hist_frame_cursor, hist_paper } from '../../hist'
import { canvas_make, clamp, hex_rgb } from '../../lib'
import { kwz_flag_advanced, mode_allows_layer_alpha, mode_frame_limit, mode_one_sheet, mode_speeds, mode_order, mode_paper_opts, sheet_layer } from '../../mode'
import { thumb_clear } from '../../thumb'
import { fx_toast, fx_sfx } from '../fx_hooks'
import type { globals_t } from '../store'
import { anim_playing, play_commands } from './play'

type pixel_change_t = {
  layer: number
  x: number
  y: number
  w: number
  h: number
  before: rle_t
}

type pixel_commit_t = {
  grp: number
  frame: number
  changes: pixel_change_t[]
}

type frame_clip_t = { frame: frame_t, w: number, h: number, mode: number }
let frame_clip: frame_clip_t | null = null

function stop_if_playing(g: globals_t): void {
  if (anim_playing()) play_commands['play.stop'](g, null)
}

function frame_limit(g: globals_t): number {
  return mode_frame_limit(g.doc.mode)
}

function frame_room(g: globals_t): number {
  return Math.max(0, frame_limit(g) - g.doc.frames.length)
}

function frame_full(g: globals_t): number {
  fx_toast('これ以上コマを増やせないよ（最大' + frame_limit(g) + '）')
  return err_full
}

function range_bounds(g: globals_t, a0: number, b0: number): [number, number] {
  const n = g.doc.frames.length
  const aa = Number.isFinite(a0) ? Math.trunc(a0) : g.doc.cur
  const bb = Number.isFinite(b0) ? Math.trunc(b0) : g.doc.cur
  const a = clamp(Math.min(aa, bb), 0, n - 1)
  const b = clamp(Math.max(aa, bb), a, n - 1)
  return [a, b]
}

function commit_pixels(g: globals_t, p: pixel_commit_t): number {
  if (p.frame !== g.doc.cur || !p.changes.length) return err_bad
  for (const c of p.changes) {
    if (![c.layer, c.x, c.y, c.w, c.h].every(Number.isInteger) || c.layer < 0 || c.layer >= g.doc.frames[p.frame].pk.length || c.x < 0 || c.y < 0 || c.w < 1 || c.h < 1 || c.x + c.w > g.doc.w || c.y + c.h > g.doc.h) return err_bad
  }
  const packed = new Map<number, { x: number, y: number, w: number, h: number }>()
  for (const c of p.changes) {
    if (!hist_pix(g, p.grp, p.frame, c.layer, c.x, c.y, c.w, c.h, c.before)) continue
    const old = packed.get(c.layer)
    const x = old ? Math.min(old.x, c.x) : c.x
    const y = old ? Math.min(old.y, c.y) : c.y
    const right = old ? Math.max(old.x + old.w, c.x + c.w) : c.x + c.w
    const bottom = old ? Math.max(old.y + old.h, c.y + c.h) : c.y + c.h
    packed.set(c.layer, { x, y, w: right - x, h: bottom - y })
  }
  if (!packed.size) return err_noop
  for (const [layer, rect] of packed) doc_pack_layer(g, layer, rect)
  return 0
}

function clear_layer(g: globals_t, layer: number): number {
  if (!Number.isInteger(layer) || layer < 0 || layer >= g.doc.frames[g.doc.cur].pk.length) return err_bad
  stop_if_playing(g)
  const before = rect_grab(layer, 0, 0, g.doc.w, g.doc.h)
  live_write(layer).clearRect(0, 0, g.doc.w, g.doc.h)
  return commit_pixels(g, { grp: hist_grp(), frame: g.doc.cur, changes: [{ layer, x: 0, y: 0, w: g.doc.w, h: g.doc.h, before }] })
}

// 普通ふでばこは1枚の紙なので、消去は3枚のレイヤーをまとめて消す。
function clear_sheet(g: globals_t): number {
  stop_if_playing(g)
  const changes = [1, 2, 3].map(layer => {
    const before = rect_grab(layer, 0, 0, g.doc.w, g.doc.h)
    live_write(layer).clearRect(0, 0, g.doc.w, g.doc.h)
    return { layer, x: 0, y: 0, w: g.doc.w, h: g.doc.h, before }
  })
  return commit_pixels(g, { grp: hist_grp(), frame: g.doc.cur, changes })
}

export type cmds_t = {
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
  'frame.insert_bulk': { at: number, frames: frame_t[], set_cur: number }
  'frame.append_bulk': { frames: frame_t[], set_cur: number }
  'frame.replace_current_bulk': { frames: frame_t[] }
  'frame.delete_range': { a: number, b: number }
  'frame.reverse_range': { a: number, b: number }
  'frame.duplicate_range': { a: number, b: number, ping_pong: number }
  'frame.sync_live': null
  'frame.sync_layer': number
  'frame.commit_pixels': pixel_commit_t
  'history.undo': null
  'history.redo': null
  'layer.toggle_visible': number
  'layer.reorder_swap': { i: number, j: number }
  'layer.set_alpha': { l: number, a255: number }
  'layer.clear': null
  'layer.clear_at': number
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
  'doc.set_meta': note_meta_t
  'doc.set_penbox': number
}

export const frame_commands = {
  'frame.goto': (g: globals_t, i: number): number => {
    if (!Number.isFinite(i)) return err_bad
    stop_if_playing(g)
    const to = clamp(Math.trunc(i), 0, g.doc.frames.length - 1)
    if (to === g.doc.cur) return err_noop
    return doc_goto(g, to)
  },

  'frame.step': (g: globals_t, d: number): number => frame_commands['frame.goto'](g, g.doc.cur + d),

  'frame.add': (g: globals_t, _p: null): number => {
    if (!frame_room(g)) return frame_full(g)
    stop_if_playing(g)
    const i = g.doc.cur + 1
    doc_frame_insert(g, i, doc_frame_new())
    hist_frame_ins(g, hist_grp(), i)
    fx_sfx('paper')
    return 0
  },

  'frame.dup': (g: globals_t, _p: null): number => {
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

  'frame.del': (g: globals_t, _p: null): number => {
    stop_if_playing(g)
    const i = g.doc.cur
    const mark_a = g.doc.loop_a === i ? 1 : 0
    const mark_b = g.doc.loop_b === i ? 1 : 0
    const removed = doc_frame_delete(g, i)
    if (!removed) {
      fx_toast('最後の1枚は消せないよ')
      return err_noop
    }
    hist_frame_del(g, hist_grp(), i, removed, mark_a, mark_b)
    fx_sfx('del')
    return 0
  },

  'frame.copy': (g: globals_t, _p: null): number => {
    frame_clip = { frame: doc_frame_snap(g, g.doc.cur), w: g.doc.w, h: g.doc.h, mode: g.doc.mode }
    fx_toast('コマをコピーしました')
    fx_sfx('tap')
    return 0
  },

  'frame.paste': (g: globals_t, _p: null): number => {
    if (!frame_clip) {
      fx_toast('コピーしたコマがないよ')
      return err_noop
    }
    if (frame_clip.w !== g.doc.w || frame_clip.h !== g.doc.h || frame_clip.mode !== g.doc.mode) {
      fx_toast('コピー元とキャンバスのサイズ・モードが違うため、コマを貼り付けられません')
      return err_bad
    }
    for (let layer = 1; layer < frame_clip.frame.pk.length; layer++) {
      if (frame_clip.frame.pk[layer] && g.doc.lord.indexOf(layer) < 0) {
        fx_toast('コピー元のレイヤーがこの作品にはありません')
        return err_bad
      }
    }
    if (!frame_room(g)) return frame_full(g)
    stop_if_playing(g)
    const i = g.doc.cur + 1
    const frame = doc_frame_clone(frame_clip.frame)
    doc_frame_insert(g, i, frame)
    hist_frame_ins(g, hist_grp(), i)
    fx_sfx('paper')
    return 0
  },

  'frame.move': (g: globals_t, p: { a: number, b: number }): number => {
    if (!Number.isInteger(p.a) || !Number.isInteger(p.b)) return err_bad
    stop_if_playing(g)
    if (doc_frame_move(g, p.a, p.b) !== 0) return err_bad
    hist_frame_move(g, hist_grp(), p.a, p.b)
    fx_sfx('move')
    return 0
  },

  'frame.add_many': (g: globals_t, n: number): number => {
    if (!Number.isFinite(n)) return err_bad
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

  'frame.se_toggle': (g: globals_t, p: { i: number, bit: number }): number => {
    if (!Number.isInteger(p.i) || !Number.isInteger(p.bit)) return err_bad
    const f = g.doc.frames[p.i]
    if (!f || p.bit < 0 || p.bit > 3) return err_bad
    const before = f.se
    f.se ^= 1 << p.bit
    hist_se(g, hist_grp(), p.i, before, f.se)
    if (g.play.on) play_commands['play.retime'](g, null)
    fx_sfx('tap')
    return 0
  },

  'frame.set_hold_range': (g: globals_t, p: { a: number, b: number, hold: number }): number => {
    if (!Number.isFinite(p.a) || !Number.isFinite(p.b) || !Number.isFinite(p.hold)) return err_bad
    const [a, b] = range_bounds(g, p.a, p.b)
    const hold = clamp(Math.round(p.hold), 1, hold_max)
    let changed = 0
    for (let i = a; i <= b; i++) {
      if (g.doc.frames[i].hold === hold) continue
      g.doc.frames[i].hold = hold
      changed = 1
    }
    if (changed && g.play.on) play_commands['play.retime'](g, null)
    return changed ? 0 : err_noop
  },

  'frame.insert_bulk': (g: globals_t, p: { at: number, frames: frame_t[], set_cur: number }): number => {
    if (!Number.isFinite(p.at) || !Number.isFinite(p.set_cur) || !Array.isArray(p.frames)) return err_bad
    if (!p.frames.length) return err_noop
    const room = frame_room(g)
    if (room < 1) return err_full
    stop_if_playing(g)
    doc_pack_live(g)
    const at = clamp(Math.round(p.at), 0, g.doc.frames.length)
    const frames = p.frames.slice(0, room)
    g.doc.frames.splice(at, 0, ...frames)
    doc_loop_insert(g, at, frames.length)
    g.doc.cur = clamp(Math.trunc(p.set_cur), 0, g.doc.frames.length - 1)
    hist_clear()
    thumb_clear()
    animfx_cache_clear()
    doc_unpack_live(g)
    return 0
  },

  'frame.append_bulk': (g: globals_t, p: { frames: frame_t[], set_cur: number }): number => {
    if (!Number.isFinite(p.set_cur) || !Array.isArray(p.frames)) return err_bad
    if (!p.frames.length) return err_noop
    const room = frame_room(g)
    if (room < 1) return err_full
    stop_if_playing(g)
    doc_pack_live(g)
    g.doc.frames.push(...p.frames.slice(0, room))
    g.doc.cur = clamp(Math.trunc(p.set_cur), 0, g.doc.frames.length - 1)
    hist_clear()
    thumb_clear()
    animfx_cache_clear()
    doc_unpack_live(g)
    return 0
  },

  'frame.replace_current_bulk': (g: globals_t, p: { frames: frame_t[] }): number => {
    if (!Array.isArray(p.frames) || p.frames.length < 2) return err_bad
    if (g.doc.frames.length - 1 + p.frames.length > frame_limit(g)) return err_full
    for (const frame of p.frames) if (!frame || !Array.isArray(frame.pk) || frame.pk.length !== l_n) return err_bad
    stop_if_playing(g)
    doc_pack_live(g)
    const at = g.doc.cur
    const delta = p.frames.length - 1
    g.doc.frames.splice(at, 1, ...p.frames)
    const move_marker = (value: number): number => value < 0 || value < at ? value : value === at ? at : value + delta
    g.doc.loop_a = move_marker(g.doc.loop_a)
    g.doc.loop_b = move_marker(g.doc.loop_b)
    g.doc.cur = at
    hist_clear()
    thumb_clear()
    doc_cache_clear()
    animfx_cache_clear()
    doc_unpack_live(g)
    return 0
  },

  'frame.delete_range': (g: globals_t, p: { a: number, b: number }): number => {
    if (!Number.isFinite(p.a) || !Number.isFinite(p.b)) return err_bad
    const [a, b] = range_bounds(g, p.a, p.b)
    if (b - a + 1 >= g.doc.frames.length) return err_bad
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

  'frame.reverse_range': (g: globals_t, p: { a: number, b: number }): number => {
    if (!Number.isFinite(p.a) || !Number.isFinite(p.b)) return err_bad
    const [a, b] = range_bounds(g, p.a, p.b)
    if (a === b) return err_noop
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

  'frame.duplicate_range': (g: globals_t, p: { a: number, b: number, ping_pong: number }): number => {
    if (!Number.isFinite(p.a) || !Number.isFinite(p.b)) return err_bad
    const [a, b] = range_bounds(g, p.a, p.b)
    if (p.ping_pong && b - a < 2) return err_bad
    const room = frame_room(g)
    if (room < 1) return err_full
    stop_if_playing(g)
    doc_pack_live(g)
    const before_id = g.doc.frames[g.doc.cur].id
    const src: frame_t[] = []
    if (p.ping_pong) {
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
    hist_frame_cursor(g, grp, before_id, g.doc.frames[g.doc.cur].id)
    doc_unpack_live(g)
    if (take < src.length) fx_toast('上限で一部だけ足したよ')
    return 0
  },

  'frame.sync_live': (g: globals_t, _p: null): number => {
    doc_pack_live(g)
    return 0
  },

  'frame.sync_layer': (g: globals_t, layer: number): number => {
    if (!Number.isInteger(layer) || layer < 0 || layer >= g.doc.frames[g.doc.cur].pk.length) return err_bad
    doc_pack_layer(g, layer)
    return 0
  },

  'frame.commit_pixels': (g: globals_t, p: pixel_commit_t): number => commit_pixels(g, p),

  'history.undo': (g: globals_t, _p: null): number => {
    stop_if_playing(g)
    if (!hist_undo(g)) return err_noop
    fx_sfx('undo')
    return 0
  },

  'history.redo': (g: globals_t, _p: null): number => {
    stop_if_playing(g)
    if (!hist_redo(g)) return err_noop
    fx_sfx('redo')
    return 0
  },

  'layer.toggle_visible': (g: globals_t, l: number): number => {
    if (!Number.isInteger(l) || l < 0 || l >= g.doc.lvis.length) return err_bad
    g.doc.lvis[l] = g.doc.lvis[l] ? 0 : 1
    return 0
  },

  'layer.reorder_swap': (g: globals_t, p: { i: number, j: number }): number => {
    const o = doc_frame_order(g.doc.cur)
    if (!Number.isInteger(p.i) || !Number.isInteger(p.j) || p.i < 0 || p.j < 0 || p.i >= o.length || p.j >= o.length) return err_bad
    if (p.i === p.j) return err_noop
    const previous_native = o.filter(layer => layer >= 1 && layer <= 3)
    const t = o[p.i]
    o[p.i] = o[p.j]
    o[p.j] = t
    g.doc.lord = [...o, ...g.doc.lord.filter(layer => !o.includes(layer))]
    const native = o.filter(layer => layer >= 1 && layer <= 3)
    const native_changed = native.some((layer, index) => layer !== previous_native[index])
    if (native_changed && (g.doc.mode === mode_3_d || g.doc.mode === mode_normal && g.doc.frames.some(frame => frame.kwz))) {
      const depth = [0, 0, 0]
      for (let i = 0; i < native.length; i++) depth[native[i] - 1] = i
      for (const frame of g.doc.frames) {
        if (g.doc.mode !== mode_3_d && !frame.kwz) continue
        frame.kwz = frame.kwz ? { ...frame.kwz, depth: [...depth] } : { depth: [...depth], colors: [1, 2, 1, 3, 1, 4], author: /^[0-9a-f]{20}$/i.test(g.doc.meta.cur_id) ? g.doc.meta.cur_id : '00000000000000000000', camera: 0, reserved: 0 }
      }
    }
    thumb_clear()
    return 0
  },

  'layer.set_alpha': (g: globals_t, p: { l: number, a255: number }): number => {
    if (!mode_allows_layer_alpha(g.doc.mode)) return err_bad
    if (!Number.isInteger(p.l) || !Number.isFinite(p.a255) || p.l < 0 || p.l >= g.doc.lalpha.length) return err_bad
    const a = clamp(Math.round(p.a255), 0, 255)
    if (g.doc.lalpha[p.l] === a) return err_noop
    g.doc.lalpha[p.l] = a
    return 0
  },

  'layer.clear': (g: globals_t, _p: null): number => {
    return mode_one_sheet(g.doc) ? clear_sheet(g) : clear_layer(g, g.pen.layer)
  },

  'layer.clear_at': (g: globals_t, layer: number): number => clear_layer(g, layer),

  'layer.copy_to': (g: globals_t, dst: number): number => {
    const src = g.pen.layer
    const order = mode_order(g.doc.mode, g.doc.lord)
    if (!Number.isInteger(dst) || dst < 1 || dst >= g.doc.frames[g.doc.cur].pk.length || dst === src || order.indexOf(src) < 0 || order.indexOf(dst) < 0) return err_bad
    stop_if_playing(g)
    const before = rect_grab(dst, 0, 0, g.doc.w, g.doc.h)
    live_write(dst).drawImage(live_canvas(src), 0, 0)
    return commit_pixels(g, { grp: hist_grp(), frame: g.doc.cur, changes: [{ layer: dst, x: 0, y: 0, w: g.doc.w, h: g.doc.h, before }] })
  },

  'layer.merge_down': (g: globals_t, _p: null): number => {
    stop_if_playing(g)
    const src = g.pen.layer
    const order = doc_frame_order(g.doc.cur)
    const k = order.indexOf(src)
    if (k < 0 || k >= order.length - 1) {
      fx_toast('いちばん下のレイヤーは結合できないよ')
      return err_noop
    }
    const dst = order[k + 1]
    const before_dst = rect_grab(dst, 0, 0, g.doc.w, g.doc.h)
    const before_src = rect_grab(src, 0, 0, g.doc.w, g.doc.h)
    const before_alpha = g.doc.lalpha[dst]
    const alpha_enabled = mode_allows_layer_alpha(g.doc.mode)
    const [merged, mx] = canvas_make(g.doc.w, g.doc.h)
    mx.globalAlpha = alpha_enabled ? before_alpha / 255 : 1
    mx.drawImage(live_canvas(dst), 0, 0)
    mx.globalAlpha = alpha_enabled ? g.doc.lalpha[src] / 255 : 1
    mx.drawImage(live_canvas(src), 0, 0)
    mx.globalAlpha = 1
    const dx = live_write(dst)
    dx.clearRect(0, 0, g.doc.w, g.doc.h)
    dx.drawImage(merged, 0, 0)
    live_write(src).clearRect(0, 0, g.doc.w, g.doc.h)
    const grp = hist_grp()
    const result = commit_pixels(g, {
      grp,
      frame: g.doc.cur,
      changes: [
        { layer: dst, x: 0, y: 0, w: g.doc.w, h: g.doc.h, before: before_dst },
        { layer: src, x: 0, y: 0, w: g.doc.w, h: g.doc.h, before: before_src },
      ],
    })
    if (result < 0) return result
    if (before_alpha !== 255) {
      g.doc.lalpha[dst] = 255
      hist_layer_alpha(g, grp, dst, before_alpha, 255)
    }
    g.pen.layer = dst
    fx_toast('下のレイヤーと結合しました')
    fx_sfx('paper')
    return 0
  },


  'layer.add': (g: globals_t, _p: null): number => {
    if (g.doc.mode !== mode_normal) return err_bad
    if (g.doc.lord.length >= l_draw_max) {
      fx_toast('レイヤーは最大' + l_draw_max + '枚だよ')
      return err_full
    }
    stop_if_playing(g)
    let layer = 0
    for (let candidate = l_draw_default + 1; candidate <= l_draw_max; candidate++) {
      if (g.doc.lord.indexOf(candidate) < 0) {
        layer = candidate
        break
      }
    }
    if (!layer) return err_full
    for (const frame of g.doc.frames) frame.pk[layer] = null
    live_drop(layer)
    live_accept(layer, null)
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

  'layer.delete': (g: globals_t, layer: number): number => {
    if (g.doc.mode !== mode_normal || !Number.isInteger(layer) || layer <= l_draw_default || layer > l_draw_max) return err_bad
    const index = g.doc.lord.indexOf(layer)
    if (index < 0) return err_bad
    stop_if_playing(g)
    for (const frame of g.doc.frames) frame.pk[layer] = null
    live_drop(layer)
    live_accept(layer, null)
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

  'doc.set_name': (g: globals_t, name: string): number => {
    if (g.doc.name === name) return err_noop
    g.doc.name = name
    return 0
  },

  'doc.set_paper': (g: globals_t, color: string): number => {
    const opts = mode_paper_opts(g.doc.mode)
    if (!/^#[0-9a-f]{6}$/i.test(color)) return err_bad
    let c = color.toUpperCase()
    if (g.doc.mode !== mode_normal && opts.length > 1 && opts.indexOf(c.toUpperCase()) < 0) {
      const [r, gg, b] = hex_rgb(c)
      let best = 0
      let best_dist = Infinity
      for (let i = 0; i < opts.length; i++) {
        const [pr, pg, pb] = hex_rgb(opts[i])
        const dist = (pr - r) * (pr - r) + (pg - gg) * (pg - gg) + (pb - b) * (pb - b)
        if (dist < best_dist) {
          best_dist = dist
          best = i
        }
      }
      c = opts[best]
    }
    if (g.doc.paper === c && !g.doc.frames.some(f => f.paper)) return err_noop
    hist_paper(g, c)
    g.doc.paper = c
    for (const frame of g.doc.frames) delete frame.paper
    return 0
  },

  'doc.set_fps_idx': (g: globals_t, i: number): number => {
    if (!Number.isFinite(i)) return err_bad
    const speeds = mode_speeds(g.doc.mode)
    const fps = speeds[clamp(Math.round(i), 0, speeds.length - 1)]
    if (g.doc.fps === fps) return err_noop
    g.doc.fps = fps
    if (g.play.on) play_commands['play.retime'](g, null)
    return 0
  },

  'doc.toggle_loop': (g: globals_t, _p: null): number => {
    g.doc.loop = g.doc.loop ? 0 : 1
    if (g.play.on) play_commands['play.retime'](g, null)
    return 0
  },

  'doc.set_loop_a': (g: globals_t, i: number): number => {
    if (!Number.isFinite(i)) return err_bad
    const v = clamp(Math.round(i), -1, g.doc.frames.length - 1)
    g.doc.loop_a = v
    if (g.doc.loop_b >= 0 && g.doc.loop_b < v) g.doc.loop_b = -1
    if (g.play.on) play_commands['play.retime'](g, null)
    return 0
  },

  'doc.set_loop_b': (g: globals_t, i: number): number => {
    if (!Number.isFinite(i)) return err_bad
    const v = clamp(Math.round(i), -1, g.doc.frames.length - 1)
    g.doc.loop_b = v
    if (g.doc.loop_a >= 0 && g.doc.loop_a > v) g.doc.loop_a = -1
    if (g.play.on) play_commands['play.retime'](g, null)
    return 0
  },

  'doc.set_meta': (g: globals_t, m: note_meta_t): number => {
    g.doc.meta = m
    return 0
  },

  // ふでばこ (うごメモ3D): 0 は普通 (1枚の紙)、1 は上級 (3枚のレイヤー)。
  'doc.set_penbox': (g: globals_t, advanced: number): number => {
    if (g.doc.mode !== mode_3_d || (advanced !== 0 && advanced !== 1)) return err_bad
    const flags = advanced ? g.doc.meta.flags | kwz_flag_advanced : g.doc.meta.flags & ~kwz_flag_advanced
    if (flags === g.doc.meta.flags) return err_noop
    g.doc.meta = { ...g.doc.meta, flags }
    if (!advanced) g.pen.layer = sheet_layer(g.pen.color)
    return 0
  },

  'doc.clear_loop_ab': (g: globals_t, _p: null): number => {
    if (g.doc.loop_a < 0 && g.doc.loop_b < 0) return err_noop
    g.doc.loop_a = -1
    g.doc.loop_b = -1
    if (g.play.on) play_commands['play.retime'](g, null)
    return 0
  },
}

const d_frame = d_timeline | d_frameinfo | d_stage | d_thumb | d_layer | d_tools | d_play
const d_pixels = d_stage | d_thumb | d_tools | d_play

export const frame_effects: Partial<Record<keyof cmds_t, number>> = {
  'frame.goto': d_stage | d_frameinfo | d_timeline | d_thumb | d_layer,
  'frame.step': d_stage | d_frameinfo | d_timeline | d_thumb | d_layer,
  'frame.add': d_frame,
  'frame.dup': d_frame,
  'frame.del': d_frame,
  'frame.paste': d_frame,
  'frame.move': d_frame,
  'frame.add_many': d_frame,
  'frame.se_toggle': d_stage | d_frameinfo | d_thumb | d_sound | d_tools,
  'frame.set_hold_range': d_stage | d_frameinfo | d_timeline | d_play,
  'frame.insert_bulk': d_all,
  'frame.append_bulk': d_all,
  'frame.replace_current_bulk': d_all,
  'frame.delete_range': d_all,
  'frame.reverse_range': d_frame,
  'frame.duplicate_range': d_frame,
  'frame.sync_live': 0,
  'frame.sync_layer': 0,
  'frame.commit_pixels': d_pixels,
  'history.undo': d_page | d_stage | d_thumb | d_timeline | d_frameinfo | d_tools | d_layer | d_play,
  'history.redo': d_page | d_stage | d_thumb | d_timeline | d_frameinfo | d_tools | d_layer | d_play,
  'layer.toggle_visible': d_stage | d_layer,
  'layer.reorder_swap': d_stage | d_layer | d_thumb,
  'layer.set_alpha': d_stage | d_layer,
  'layer.clear': d_pixels,
  'layer.clear_at': d_pixels | d_layer,
  'layer.copy_to': d_pixels,
  'layer.merge_down': d_pixels | d_layer,
  'layer.add': d_layer | d_stage | d_tools,
  'layer.delete': d_all,
  'doc.set_name': d_page,
  'doc.set_paper': d_stage | d_thumb | d_page | d_tools,
  'doc.set_fps_idx': d_stage | d_frameinfo | d_play,
  'doc.toggle_loop': d_stage | d_frameinfo | d_play,
  'doc.set_loop_a': d_stage | d_frameinfo | d_timeline | d_play,
  'doc.set_loop_b': d_stage | d_frameinfo | d_timeline | d_play,
  'doc.clear_loop_ab': d_stage | d_frameinfo | d_timeline | d_play,
  'doc.set_meta': 0,
  'doc.set_penbox': d_layer | d_tools | d_page,
}

export const frame_touch = new Set<keyof cmds_t>([
  'frame.add', 'frame.dup', 'frame.del', 'frame.paste', 'frame.move', 'frame.add_many',
  'frame.se_toggle', 'frame.set_hold_range', 'frame.insert_bulk', 'frame.append_bulk', 'frame.replace_current_bulk', 'frame.delete_range',
  'frame.reverse_range', 'frame.duplicate_range', 'frame.commit_pixels', 'history.undo', 'history.redo',
  'layer.toggle_visible', 'layer.reorder_swap', 'layer.set_alpha', 'layer.clear', 'layer.clear_at', 'layer.copy_to', 'layer.merge_down', 'layer.add', 'layer.delete',
  'doc.set_name', 'doc.set_paper', 'doc.set_fps_idx', 'doc.toggle_loop', 'doc.set_loop_a', 'doc.set_loop_b',
  'doc.clear_loop_ab', 'doc.set_meta', 'doc.set_penbox',
])
