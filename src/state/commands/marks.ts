import { d_pen, type mark_def_t } from '../../h'
import type { globals_t } from '../store'

export type cmds_t = {
  'marks.set_list': mark_def_t[]
  'marks.remove': string
}

export const mark_commands = {
  'marks.set_list': (g: globals_t, arr: mark_def_t[]): number => {
    g.marks = arr
    return 0
  },

  'marks.remove': (g: globals_t, id: string): number => {
    g.marks = g.marks.filter(m => m.id !== id)
    if (g.pen.mark_id === id) g.pen.mark_id = ''
    return 0
  },
}

export const mark_effects: Partial<Record<keyof cmds_t, number>> = {
  'marks.set_list': d_pen,
  'marks.remove': d_pen,
}

export const mark_touch = new Set<keyof cmds_t>([])
