import { D_STAGE, D_THUMB, D_SEL, D_TOOLS, D_TRANS, ERR_BAD } from '../../h'
import { sel_down, sel_up, sel_copy, sel_cut, sel_delete, sel_transform, sel_clear, flo_drag_move, flo_nudge, flo_rot, flo_flip, flo_reset, flo_scale, flo_confirm, flo_cancel, flo_begin_paste, flo_begin_img } from '../../sel'
import type { Globals } from '../store'

export type Cmds = {
  'sel.pointer_down': { x: number, y: number }
  'sel.pointer_up': null
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
  'flo.begin_paste': null
  'flo.begin_image': { canvas: HTMLCanvasElement, kind: number, x: number, y: number, continuous: number }
}

export const SELECTION_COMMANDS = {
  'sel.pointer_down': (g: Globals, p: { x: number, y: number }): number => Number.isFinite(p.x) && Number.isFinite(p.y) ? sel_down(g, p.x, p.y) : ERR_BAD,
  'sel.pointer_up': (g: Globals, _p: null): number => sel_up(g),
  'sel.copy': (g: Globals, _p: null): number => sel_copy(g),
  'sel.cut': (g: Globals, _p: null): number => sel_cut(g),
  'sel.delete': (g: Globals, _p: null): number => sel_delete(g),
  'sel.transform': (g: Globals, _p: null): number => sel_transform(g),
  'sel.clear': (g: Globals, _p: null): number => sel_clear(g),
  'flo.drag_move': (g: Globals, p: { x: number, y: number, shift: number }): number => Number.isFinite(p.x) && Number.isFinite(p.y) ? flo_drag_move(g, p.x, p.y, p.shift) : ERR_BAD,
  'flo.nudge': (g: Globals, p: { dx: number, dy: number }): number => Number.isFinite(p.dx) && Number.isFinite(p.dy) ? flo_nudge(g, p.dx, p.dy) : ERR_BAD,
  'flo.rot': (g: Globals, dir: number): number => Number.isFinite(dir) ? flo_rot(g, dir) : ERR_BAD,
  'flo.flip': (g: Globals, axis: number): number => Number.isFinite(axis) ? flo_flip(g, axis) : ERR_BAD,
  'flo.reset': (g: Globals, _p: null): number => flo_reset(g),
  'flo.scale': (g: Globals, factor: number): number => Number.isFinite(factor) && factor > 0 ? flo_scale(g, factor) : ERR_BAD,
  'flo.confirm': (g: Globals, _p: null): number => flo_confirm(g),
  'flo.cancel': (g: Globals, _p: null): number => flo_cancel(g),
  'flo.begin_paste': (g: Globals, _p: null): number => flo_begin_paste(g),
  'flo.begin_image': (g: Globals, p: { canvas: HTMLCanvasElement, kind: number, x: number, y: number, continuous: number }): number => {
    if (!p.canvas || !Number.isInteger(p.kind) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return ERR_BAD
    return flo_begin_img(g, p.canvas, p.kind, p.x, p.y, p.continuous ? 1 : 0)
  },
}

export const SELECTION_EFFECTS: Partial<Record<keyof Cmds, number>> = {
  'sel.pointer_down': D_STAGE | D_SEL | D_TOOLS | D_TRANS,
  'sel.pointer_up': D_SEL,
  'sel.copy': D_TOOLS,
  'sel.cut': D_STAGE | D_THUMB | D_SEL | D_TOOLS,
  'sel.delete': D_STAGE | D_THUMB | D_SEL | D_TOOLS,
  'sel.transform': D_STAGE | D_THUMB | D_SEL | D_TOOLS | D_TRANS,
  'sel.clear': D_SEL,
  'flo.drag_move': D_TRANS,
  'flo.nudge': D_TRANS,
  'flo.rot': D_TRANS,
  'flo.flip': D_TRANS,
  'flo.reset': D_TRANS,
  'flo.scale': D_TRANS,
  'flo.confirm': D_STAGE | D_THUMB | D_SEL | D_TOOLS | D_TRANS,
  'flo.cancel': D_STAGE | D_THUMB | D_SEL | D_TOOLS | D_TRANS,
  'flo.begin_paste': D_SEL | D_TOOLS | D_TRANS,
  'flo.begin_image': D_SEL | D_TOOLS | D_TRANS,
}

export const SELECTION_TOUCH = new Set<keyof Cmds>(['sel.cut', 'sel.delete', 'flo.confirm'])
