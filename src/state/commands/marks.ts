import { D_PEN, type MarkDef } from '../../h'
import type { Globals } from '../store'

export type Cmds = {
  'marks.set_list': MarkDef[]
  'marks.remove': string
}

export const MARK_COMMANDS = {
  'marks.set_list': (g: Globals, arr: MarkDef[]): number => {
    g.marks = arr
    return 0
  },

  'marks.remove': (g: Globals, id: string): number => {
    g.marks = g.marks.filter(m => m.id !== id)
    if (g.pen.markId === id) g.pen.markId = ''
    return 0
  },
}

export const MARK_EFFECTS: Partial<Record<keyof Cmds, number>> = {
  'marks.set_list': D_PEN,
  'marks.remove': D_PEN,
}

export const MARK_TOUCH = new Set<keyof Cmds>([])
