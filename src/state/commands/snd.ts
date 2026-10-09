import { D_SOUND, ERR_BAD } from '../../h'
import { clamp } from '../../lib'
import type { Globals } from '../store'

export type SndSlotPayload = { kind: string, bytes: ArrayBuffer | null, name: string }

export type Cmds = {
  'snd.set_bgm_vol': number
  'snd.set_se_vol': number
  'snd.slot_apply': SndSlotPayload
  'snd.slot_clear': string
  'snd.set_bgm_fps': number
}

function slot_of(g: Globals, kind: string) {
  if (kind === 'bgm0') return g.snd.bgm[0]
  if (kind === 'bgm1') return g.snd.bgm[1]
  if (kind === 'se0') return g.snd.se[0]
  if (kind === 'se1') return g.snd.se[1]
  if (kind === 'se2') return g.snd.se[2]
  if (kind === 'se3') return g.snd.se[3]
  return null
}

export const SOUND_COMMANDS = {
  'snd.set_bgm_vol': (g: Globals, v: number): number => {
    if (!Number.isFinite(v)) return ERR_BAD
    g.snd.bgmVol = clamp(v, 0, 1)
    return 0
  },

  'snd.set_se_vol': (g: Globals, v: number): number => {
    if (!Number.isFinite(v)) return ERR_BAD
    g.snd.seVol = clamp(v, 0, 1)
    return 0
  },

  'snd.slot_apply': (g: Globals, p: SndSlotPayload): number => {
    const s = slot_of(g, p.kind)
    if (!s) return ERR_BAD
    s.bytes = p.bytes
    s.name = p.name
    if (p.kind.startsWith('bgm') && !g.snd.bgmFps) g.snd.bgmFps = g.doc.fps
    return 0
  },

  'snd.slot_clear': (g: Globals, kind: string): number => {
    const s = slot_of(g, kind)
    if (!s) return ERR_BAD
    s.bytes = null
    s.name = ''
    if (kind.startsWith('bgm') && !g.snd.bgm[0].bytes && !g.snd.bgm[1].bytes) g.snd.bgmFps = 0
    return 0
  },

  'snd.set_bgm_fps': (g: Globals, v: number): number => {
    g.snd.bgmFps = Number.isFinite(v) && v > 0 ? v : 0
    return 0
  },
}

export const SOUND_EFFECTS: Partial<Record<keyof Cmds, number>> = {
  'snd.set_bgm_vol': D_SOUND,
  'snd.set_se_vol': D_SOUND,
  'snd.slot_apply': D_SOUND,
  'snd.slot_clear': D_SOUND,
  'snd.set_bgm_fps': D_SOUND,
}

export const SOUND_TOUCH = new Set<keyof Cmds>(['snd.set_bgm_vol', 'snd.set_se_vol', 'snd.slot_apply', 'snd.slot_clear', 'snd.set_bgm_fps'])
