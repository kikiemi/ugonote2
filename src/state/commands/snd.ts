import { d_sound, err_bad } from '../../h'
import { clamp } from '../../lib'
import type { globals_t } from '../store'

export type snd_slot_payload_t = { kind: string, bytes: ArrayBuffer | null, name: string }

export type cmds_t = {
  'snd.set_bgm_vol': number
  'snd.set_se_vol': number
  'snd.slot_apply': snd_slot_payload_t
  'snd.slot_clear': string
  'snd.set_bgm_fps': number
}

function slot_of(g: globals_t, kind: string) {
  if (kind === 'bgm0') return g.snd.bgm[0]
  if (kind === 'bgm1') return g.snd.bgm[1]
  if (kind === 'se0') return g.snd.se[0]
  if (kind === 'se1') return g.snd.se[1]
  if (kind === 'se2') return g.snd.se[2]
  if (kind === 'se3') return g.snd.se[3]
  return null
}

export const sound_commands = {
  'snd.set_bgm_vol': (g: globals_t, v: number): number => {
    if (!Number.isFinite(v)) return err_bad
    g.snd.bgm_vol = clamp(v, 0, 1)
    return 0
  },

  'snd.set_se_vol': (g: globals_t, v: number): number => {
    if (!Number.isFinite(v)) return err_bad
    g.snd.se_vol = clamp(v, 0, 1)
    return 0
  },

  'snd.slot_apply': (g: globals_t, p: snd_slot_payload_t): number => {
    const s = slot_of(g, p.kind)
    if (!s) return err_bad
    s.bytes = p.bytes
    s.name = p.name
    if (p.kind.startsWith('bgm') && !g.snd.bgm_fps) g.snd.bgm_fps = g.doc.fps
    return 0
  },

  'snd.slot_clear': (g: globals_t, kind: string): number => {
    const s = slot_of(g, kind)
    if (!s) return err_bad
    s.bytes = null
    s.name = ''
    if (kind.startsWith('bgm') && !g.snd.bgm[0].bytes && !g.snd.bgm[1].bytes) g.snd.bgm_fps = 0
    return 0
  },

  'snd.set_bgm_fps': (g: globals_t, v: number): number => {
    g.snd.bgm_fps = Number.isFinite(v) && v > 0 ? v : 0
    return 0
  },
}

export const sound_effects: Partial<Record<keyof cmds_t, number>> = {
  'snd.set_bgm_vol': d_sound,
  'snd.set_se_vol': d_sound,
  'snd.slot_apply': d_sound,
  'snd.slot_clear': d_sound,
  'snd.set_bgm_fps': d_sound,
}

export const sound_touch = new Set<keyof cmds_t>(['snd.set_bgm_vol', 'snd.set_se_vol', 'snd.slot_apply', 'snd.slot_clear', 'snd.set_bgm_fps'])
