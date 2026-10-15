import { d_stage, d_thumb, d_sel, d_tools, d_trans, d_pen, err_bad } from '../../h'
import { sel_invert, sel_paint, sel_register_paint, sel_down, sel_up, sel_copy, sel_cut, sel_delete, sel_transform, sel_clear, flo_drag_move, flo_nudge, flo_rot, flo_flip, flo_reset, flo_scale, flo_confirm, flo_cancel, flo_begin_paste, flo_begin_img } from '../../sel'
import type { globals_t } from '../store'

export type cmds_t = {
  'sel.pointer_down': { x: number, y: number }
  'sel.pointer_up': null
  'sel.invert': null
  'sel.paint': null
  'sel.register_paint': null
  'sel.copy': null
  'sel.cut': null
  'sel.delete': null
  'sel.transform': null
  'sel.clear': null
  'flo.drag_move': { x: number, y: number, shift: number }
  'flo.nudge': { dx: number, dy: number }
  'flo.rot': number
  'flo.flip': number
  'flo.reset': null
  'flo.scale': number
  'flo.confirm': null
  'flo.cancel': null
  'flo.begin_paste': { repeat: number } | null
  'flo.begin_image': { canvas: HTMLCanvasElement, kind: number, x: number, y: number, continuous: number }
}

export const selection_commands = {
  'sel.pointer_down': (g: globals_t, p: { x: number, y: number }): number => Number.isFinite(p.x) && Number.isFinite(p.y) ? sel_down(g, p.x, p.y) : err_bad,
  'sel.pointer_up': (g: globals_t, _p: null): number => sel_up(g),
  'sel.invert': (g: globals_t, _p: null): number => sel_invert(g),
  'sel.paint': (g: globals_t, _p: null): number => sel_paint(g),
  'sel.register_paint': (g: globals_t, _p: null): number => sel_register_paint(g),
  'sel.copy': (g: globals_t, _p: null): number => sel_copy(g),
  'sel.cut': (g: globals_t, _p: null): number => sel_cut(g),
  'sel.delete': (g: globals_t, _p: null): number => sel_delete(g),
  'sel.transform': (g: globals_t, _p: null): number => sel_transform(g),
  'sel.clear': (g: globals_t, _p: null): number => sel_clear(g),
  'flo.drag_move': (g: globals_t, p: { x: number, y: number, shift: number }): number => Number.isFinite(p.x) && Number.isFinite(p.y) ? flo_drag_move(g, p.x, p.y, p.shift) : err_bad,
  'flo.nudge': (g: globals_t, p: { dx: number, dy: number }): number => Number.isFinite(p.dx) && Number.isFinite(p.dy) ? flo_nudge(g, p.dx, p.dy) : err_bad,
  'flo.rot': (g: globals_t, dir: number): number => Number.isFinite(dir) ? flo_rot(g, dir) : err_bad,
  'flo.flip': (g: globals_t, axis: number): number => Number.isFinite(axis) ? flo_flip(g, axis) : err_bad,
  'flo.reset': (g: globals_t, _p: null): number => flo_reset(g),
  'flo.scale': (g: globals_t, factor: number): number => Number.isFinite(factor) && factor > 0 ? flo_scale(g, factor) : err_bad,
  'flo.confirm': (g: globals_t, _p: null): number => flo_confirm(g),
  'flo.cancel': (g: globals_t, _p: null): number => flo_cancel(g),
  'flo.begin_paste': (g: globals_t, p: { repeat: number } | null): number => flo_begin_paste(g, p ? p.repeat : 1),
  'flo.begin_image': (g: globals_t, p: { canvas: HTMLCanvasElement, kind: number, x: number, y: number, continuous: number }): number => {
    if (!p.canvas || !Number.isInteger(p.kind) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return err_bad
    return flo_begin_img(g, p.canvas, p.kind, p.x, p.y, p.continuous ? 1 : 0)
  },
}

export const selection_effects: Partial<Record<keyof cmds_t, number>> = {
  'sel.pointer_down': d_stage | d_sel | d_tools | d_trans,
  'sel.pointer_up': d_sel | d_tools,
  'sel.invert': d_stage | d_thumb | d_sel | d_tools,
  'sel.paint': d_stage | d_thumb | d_sel | d_tools,
  'sel.register_paint': d_pen | d_sel | d_tools,
  'sel.copy': d_tools | d_sel,
  'sel.cut': d_stage | d_thumb | d_sel | d_tools,
  'sel.delete': d_stage | d_thumb | d_sel | d_tools,
  'sel.transform': d_stage | d_thumb | d_sel | d_tools | d_trans,
  'sel.clear': d_sel | d_tools,
  'flo.drag_move': d_trans,
  'flo.nudge': d_trans,
  'flo.rot': d_trans,
  'flo.flip': d_trans,
  'flo.reset': d_trans,
  'flo.scale': d_trans,
  'flo.confirm': d_stage | d_thumb | d_sel | d_tools | d_trans,
  'flo.cancel': d_stage | d_thumb | d_sel | d_tools | d_trans,
  'flo.begin_paste': d_sel | d_tools | d_trans,
  'flo.begin_image': d_sel | d_tools | d_trans,
}

export const selection_touch = new Set<keyof cmds_t>(['sel.invert', 'sel.paint', 'sel.cut', 'sel.delete', 'flo.confirm'])
