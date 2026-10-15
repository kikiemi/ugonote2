import { animfx_cache_clear } from '../../animfx'
import { animfx_normalize, animfx_same } from '../../animset'
import { d_anim, d_play, d_save, d_stage, err_bad, err_noop, anim_fx_zero, type anim_fx_t } from '../../h'
import { mode_allows_runtime_anim } from '../../mode'
import type { globals_t } from '../store'

export type cmds_t = {
  'anim.set': anim_fx_t
  'anim.clear': null
}

export const anim_commands = {
  'anim.set': (g: globals_t, value: anim_fx_t): number => {
    if (!mode_allows_runtime_anim(g.doc.mode)) return err_bad
    const next = animfx_normalize(value)
    if (animfx_same(g.doc.anim, next)) return err_noop
    g.doc.anim = next
    animfx_cache_clear()
    return 0
  },

  'anim.clear': (g: globals_t, _value: null): number => {
    const next = anim_fx_zero()
    if (animfx_same(g.doc.anim, next)) return err_noop
    g.doc.anim = next
    animfx_cache_clear()
    return 0
  },

}

export const anim_effects: Partial<Record<keyof cmds_t, number>> = {
  'anim.set': d_stage | d_play | d_anim | d_save,
  'anim.clear': d_stage | d_play | d_anim | d_save,
}

export const anim_touch = new Set<keyof cmds_t>(['anim.set', 'anim.clear'])
