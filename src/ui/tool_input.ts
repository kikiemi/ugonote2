import { doc_frame_order } from '../doc'
import { q, toast } from '../dom'
import { D_ALL, D_PEN, D_SAVE, D_TOOLS, K_PASTE, T_PEN } from '../h'
import { lang_set, lang_saved } from '../lang'
import { file_pick } from '../lib'
import { mark_capture_from_file, mark_capture_from_selection, mark_delete, mark_place } from '../mark'
import { pref_theme_toggle, pref_uisfx_toggle, pref_kit_set } from '../prefs'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { dirty, st } from '../state/store'
import { storage_read_json } from '../storage'
import { tool_has_options } from '../sync'
import { tf_active, tf_begin, tf_cancel, tf_commit, tf_preview } from '../tool'
import { pop_close, pop_is_open, pop_open, pop_toggle, tool_page_show } from './overlay'
import { tool_pick } from './stage_input'

function pref_kit_apply(v: number): void {
  pref_kit_set(v)
  dirty(D_TOOLS | D_PEN)
}

export function rail_events(): void {
  q('railTools').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.rb') as HTMLElement | null
    if (!b) return
    const t = Number(b.dataset.t)
    if (st().pen.tool === t && tool_has_options(t)) {
      pop_toggle('popTool', b)
      return
    }
    tool_pick(t)
    if (pop_is_open() === 'popTool') pop_open('popTool', b)
  })
  q('colorBtn').addEventListener('click', () => pop_toggle('popColor', q('colorBtn')))
  q('sizeBtn').addEventListener('click', () => { tool_page_show('size'); pop_toggle('popTool', q('sizeBtn')) })
  q('optBtn').addEventListener('click', () => pop_toggle('popSettings', q('optBtn')))
}

function hex_ok(s: string): number {
  return /^#[0-9a-fA-F]{6}$/.test(s) ? 1 : 0
}

export function custom_load(): void {
  const value = storage_read_json('ug2_pal')
  if (!Array.isArray(value)) return
  dispatch('pen.custom_set', value.filter((color: unknown): color is string => typeof color === 'string' && hex_ok(color) !== 0))
}

let custLp: ReturnType<typeof setTimeout> | 0 = 0

export function color_pop_events(): void {
  for (let t = 0; t < 3; t++) {
    q('palTab_' + t).addEventListener('click', () => {
      dispatch('pen.set_pal_mode', t)
      sfx_play('tap')
    })
  }
  const pickC = (c: string) => {
    dispatch('pen.set_color', c)
    sfx_play('tap')
  }
  q('palGrid').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.palc') as HTMLElement | null
    if (b && b.dataset.c) pickC(b.dataset.c)
  })
  q('custGrid').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.palc') as HTMLElement | null
    if (b && b.dataset.c) pickC(b.dataset.c)
  })
  q('custGrid').addEventListener('pointerdown', e => {
    const b = (e.target as HTMLElement).closest('.palc') as HTMLElement | null
    if (!b || b.dataset.ci === undefined) return
    if (custLp) clearTimeout(custLp)
    custLp = setTimeout(() => {
      custLp = 0
      dispatch('pen.custom_remove', Number(b.dataset.ci))
    }, 600)
  })
  const custUp = () => {
    if (custLp) clearTimeout(custLp)
    custLp = 0
  }
  q('custGrid').addEventListener('pointerup', custUp)
  q('custGrid').addEventListener('pointercancel', custUp)
  q('custGrid').addEventListener('pointerleave', custUp)
  q('custAdd').addEventListener('click', () => {
    dispatch('pen.custom_add', st().pen.color)
  })
  q<HTMLInputElement>('pickIn').addEventListener('input', e => {
    dispatch('pen.set_color', (e.target as HTMLInputElement).value)
  })
  const applyHex = () => {
    const v = q<HTMLInputElement>('hexIn').value.trim()
    if (!hex_ok(v)) {
      toast('#RRGGBB の形で入れてね')
      return
    }
    dispatch('pen.set_color', v)
    sfx_play('tap')
  }
  q('hexIn').addEventListener('keydown', e => {
    if ((e as KeyboardEvent).key === 'Enter') applyHex()
  })
  q('hexIn').addEventListener('blur', applyHex)
}

export function tool_pop_events(): void {
  q('popTool').addEventListener('click', e => {
    const sz = (e.target as HTMLElement).closest('.szb') as HTMLElement | null
    if (sz) {
      dispatch('pen.set_size', Number(sz.dataset.sz))
      sfx_play('tap')
      return
    }
    const pb = (e.target as HTMLElement).closest('.patb') as HTMLElement | null
    if (pb) {
      dispatch('pen.set_pat', Number(pb.dataset.pat))
      sfx_play('tap')
      return
    }
  })
  const tgl = (id: string, fn: () => void) => q(id).addEventListener('click', fn)
  tgl('optPressure', () => {
    dispatch('pen.toggle_pressure', null)
    sfx_play('tap')
  })
  tgl('optSymX', () => {
    dispatch('pen.toggle_sym', null)
    sfx_play('tap')
  })
  tgl('optSymY', () => {
    dispatch('pen.toggle_symy', null)
    sfx_play('tap')
  })
  tgl('optOutline', () => {
    dispatch('pen.toggle_outline', null)
    sfx_play('tap')
  })
  tgl('optFill', () => {
    dispatch('pen.toggle_fill', null)
    sfx_play('tap')
  })
  q<HTMLInputElement>('optSmooth').addEventListener('input', e => {
    dispatch('pen.set_smooth', Number((e.target as HTMLInputElement).value))
  })
  q<HTMLInputElement>('optAlpha').addEventListener('input', e => {
    dispatch('pen.set_alpha_pct', Number((e.target as HTMLInputElement).value))
  })
  q<HTMLInputElement>('optOWidth').addEventListener('input', e => {
    dispatch('pen.set_owidth', Number((e.target as HTMLInputElement).value))
  })
  q<HTMLInputElement>('optOColor').addEventListener('input', e => {
    dispatch('pen.set_ocolor', (e.target as HTMLInputElement).value)
  })
  const pxnSet = (v: number) => {
    if (!Number.isFinite(v) || v <= 0) return
    dispatch('pen.set_pxn', v)
  }
  q<HTMLInputElement>('pxnRange').addEventListener('input', e => pxnSet(Number((e.target as HTMLInputElement).value)))
  q<HTMLInputElement>('pxnNum').addEventListener('input', e => pxnSet(Number((e.target as HTMLInputElement).value)))
  const sizeSet = (v: number) => {
    if (!Number.isFinite(v) || v <= 0) return
    dispatch('pen.set_size', v)
  }
  q<HTMLInputElement>('sizeRange').addEventListener('input', e => sizeSet(Number((e.target as HTMLInputElement).value)))
  q<HTMLInputElement>('sizeNum').addEventListener('input', e => sizeSet(Number((e.target as HTMLInputElement).value)))
  q('popTool').addEventListener('click', e => {
    const bb = (e.target as HTMLElement).closest('.brushb') as HTMLElement | null
    if (!bb) return
    dispatch('pen.set_brush', Number(bb.dataset.b))
    if (st().pen.tool !== T_PEN) tool_pick(T_PEN)
    sfx_play('tap')
  })
  q('optFillAll').addEventListener('click', () => {
    dispatch('pen.toggle_fill_all', null)
    sfx_play('tap')
  })
  q('selCopy').addEventListener('click', () => dispatch('sel.copy', null))
  q('selCut').addEventListener('click', () => dispatch('sel.cut', null))
  q('selDel').addEventListener('click', () => dispatch('sel.delete', null))
}

let tfTarget = -1

export function tf_pop_events(): void {
  const rScale = q<HTMLInputElement>('tfScale')
  const rDx = q<HTMLInputElement>('tfDx')
  const rDy = q<HTMLInputElement>('tfDy')
  const rRot = q<HTMLInputElement>('tfRot')
  const cur = () => ({ f: Number(rScale.value) / 100, dx: Number(rDx.value), dy: Number(rDy.value), deg: Number(rRot.value) })
  const show = () => {
    q('tfScaleV').textContent = rScale.value + '%'
    q('tfDxV').textContent = rDx.value
    q('tfDyV').textContent = rDy.value
    q('tfRotV').textContent = rRot.value + '°'
  }
  const reset_ui = () => {
    rScale.value = '100'
    rDx.value = '0'
    rDy.value = '0'
    rRot.value = '0'
    show()
  }
  const move = () => {
    if (!tf_active()) tf_begin(tfTarget < 0 ? -1 : st().pen.layer)
    const v = cur()
    show()
    tf_preview(v.f, v.dx, v.dy, v.deg)
  }
  for (const r of [rScale, rDx, rDy, rRot]) r.addEventListener('input', move)
  q('tfAll').addEventListener('click', () => {
    tf_cancel()
    reset_ui()
    tfTarget = -1
    q('tfAll').classList.add('on')
    q('tfOne').classList.remove('on')
  })
  q('tfOne').addEventListener('click', () => {
    tf_cancel()
    reset_ui()
    tfTarget = 1
    q('tfOne').classList.add('on')
    q('tfAll').classList.remove('on')
  })
  q('tfApply').addEventListener('click', () => {
    tf_commit()
    reset_ui()
    sfx_play('save')
    toast('絵をうごかしました')
  })
  q('tfCancel').addEventListener('click', () => {
    tf_cancel()
    reset_ui()
    sfx_play('tap')
  })
}

export function layer_pop_events(): void {
  const rows = q('layerRows')
  rows.addEventListener('click', e => {
    const eye = (e.target as HTMLElement).closest('.leye') as HTMLElement | null
    if (eye) {
      dispatch('layer.toggle_visible', Number(eye.dataset.l))
      sfx_play('tap')
      return
    }
    const up = (e.target as HTMLElement).closest('.lup') as HTMLElement | null
    const dn = (e.target as HTMLElement).closest('.ldn') as HTMLElement | null
    if (up || dn) {
      const button = (up || dn) as HTMLElement
      if (button.classList.contains('off')) return
      const l = Number(button.dataset.l)
      const active = doc_frame_order(st().doc.cur)
      const i = active.indexOf(l)
      const j = up ? i - 1 : i + 1
      if (i < 0 || j < 0 || j >= active.length) return
      if (dispatch('layer.reorder_swap', { i, j }) === 0) sfx_play('move')
      return
    }
    const pick = (e.target as HTMLElement).closest('.lpick') as HTMLElement | null
    if (pick) {
      const layer = Number(pick.dataset.l)
      if (layer === 0) {
        q('photoLayerBtn').click()
        return
      }
      dispatch('pen.set_layer', layer)
      sfx_play('tap')
    }
  })
  rows.addEventListener('input', e => {
    const al = (e.target as HTMLElement).closest('.lal') as HTMLInputElement | null
    if (!al) return
    dispatch('layer.set_alpha', { l: Number(al.dataset.l), a255: (Number(al.value) / 100) * 255 })
  })
}

let markLp: ReturnType<typeof setTimeout> | 0 = 0

export function mark_events(): void {
  const g = st()
  q('markBtn').addEventListener('click', () => pop_toggle('popMark', q('markBtn')))
  q('markGrid').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.mkb') as HTMLElement | null
    if (!b || !b.dataset.markid) return
    const id = b.dataset.markid
    mark_place(id, canvas => {
      if (!canvas) {
        toast('マークを読み込めなかった…')
        return
      }
      dispatch('flo.begin_image', { canvas, kind: K_PASTE, x: g.doc.w / 2, y: g.doc.h / 2, continuous: 1 })
      pop_close()
      toast('✓で確定→そのまま連続スタンプ！おわるときはEsc')
      sfx_play('tap')
    })
  })
  q('markGrid').addEventListener('pointerdown', e => {
    const b = (e.target as HTMLElement).closest('.mkb') as HTMLElement | null
    if (!b || !b.dataset.markid) return
    const id = b.dataset.markid
    if (markLp) clearTimeout(markLp)
    markLp = setTimeout(() => {
      markLp = 0
      mark_delete(id)
      toast('マークを消しました')
    }, 600)
  })
  const mUp = () => {
    if (markLp) clearTimeout(markLp)
    markLp = 0
  }
  q('markGrid').addEventListener('pointerup', mUp)
  q('markGrid').addEventListener('pointercancel', mUp)
  q('markGrid').addEventListener('pointerleave', mUp)
  q('markAddSel').addEventListener('click', () => {
    mark_capture_from_selection('マーク', ok => {
      toast(ok ? '選択範囲をマークに登録しました' : '登録できるものが見つからないよ（レイヤーがからっぽかも）')
      if (ok) sfx_play('save')
    })
  })
  q('markAddFile').addEventListener('click', () => {
    file_pick('image/*', f => mark_capture_from_file(f, ok => {
      toast(ok ? '画像をマークに登録しました' : '画像を読めなかった…')
      if (ok) sfx_play('save')
    }))
  })
}

export function settings_events(): void {
  const gs = (v: number) => {
    if (!Number.isFinite(v)) return
    dispatch('view.set_grid_size', v)
  }
  q<HTMLInputElement>('setGsize').addEventListener('input', e => gs(Number((e.target as HTMLInputElement).value)))
  q<HTMLInputElement>('setGsizeN').addEventListener('input', e => gs(Number((e.target as HTMLInputElement).value)))
  q<HTMLInputElement>('setOnion').addEventListener('input', e => {
    dispatch('view.set_onion_count', Number((e.target as HTMLInputElement).value))
  })
  q('setTheme').addEventListener('click', () => {
    pref_theme_toggle()
    dirty(D_ALL)
    sfx_play('tap')
  })
  q('setUisfx').addEventListener('click', () => {
    pref_uisfx_toggle()
    dirty(D_SAVE | D_TOOLS)
    sfx_play('tap')
  })
  q('setVflip').addEventListener('click', () => {
    dispatch('view.toggle_flip', null)
    sfx_play('tap')
  })
  const langSel = q<HTMLSelectElement>('setLang')
  langSel.value = lang_saved()
  langSel.addEventListener('change', () => lang_set(langSel.value))
  const kit = (v: number) => {
    pref_kit_apply(v)
    toast(v ? '初級筆箱にしたよ（7つのどうぐ）' : '上級筆箱にしたよ（ぜんぶのどうぐ）')
    sfx_play('tap')
  }
  q('kitAdv').addEventListener('click', () => kit(0))
  q('kitBasic').addEventListener('click', () => kit(1))
}

export function tool_input_interrupt(): void {
  if (custLp) clearTimeout(custLp)
  custLp = 0
  if (markLp) clearTimeout(markLp)
  markLp = 0
}
