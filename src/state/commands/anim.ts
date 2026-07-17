import { animfx_cache_clear } from '../../animfx'
import { animfx_normalize, animfx_same } from '../../animset'
import { D_ANIM, D_PLAY, D_SAVE, D_STAGE, ERR_BAD, ERR_NOOP, anim_fx_zero, type AnimFx } from '../../h'
import { mode_allows_runtime_anim } from '../../mode'
import type { Globals } from '../store'

export type Cmds = {
  'anim.set': AnimFx
  'anim.clear': null
}

export const ANIM_COMMANDS = {
  'anim.set': (g: Globals, value: AnimFx): number => {
    if (!mode_allows_runtime_anim(g.doc.mode)) return ERR_BAD
    const next = animfx_normalize(value)
    if (animfx_same(g.doc.anim, next)) return ERR_NOOP
    g.doc.anim = next
    animfx_cache_clear()
    return 0
  },

  'anim.clear': (g: Globals, _value: null): number => {
    const next = anim_fx_zero()
    if (animfx_same(g.doc.anim, next)) return ERR_NOOP
    g.doc.anim = next
    animfx_cache_clear()
    return 0
  },

}

export const ANIM_EFFECTS: Partial<Record<keyof Cmds, number>> = {
  'anim.set': D_STAGE | D_PLAY | D_ANIM | D_SAVE,
  'anim.clear': D_STAGE | D_PLAY | D_ANIM | D_SAVE,
}

export const ANIM_TOUCH = new Set<keyof Cmds>(['anim.set', 'anim.clear'])
