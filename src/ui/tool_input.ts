import { doc_frame_order } from '../doc'
import { q, toast } from '../dom'
import { k_paste, t_pen, t_text } from '../h'
import { file_pick } from '../lib'
import { mark_capture_from_file, mark_capture_from_selection, mark_delete, mark_place } from '../mark'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { storage_read_json } from '../storage'
import { tool_has_options, tool_page_show } from './tool_options'
import { tf_active, tf_begin, tf_cancel, tf_commit, tf_preview } from '../tool'
import { pop_close, pop_is_open, pop_open, pop_toggle } from './overlay'
import { tool_pick } from './stage_input'

export function rail_events(): void {
  q('rail_tools').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.rb') as HTMLElement | null
    if (!b) return
    const t = Number(b.dataset.t)
    if (st().pen.tool === t && tool_has_options(t)) {
      pop_toggle('pop_tool', b)
      return
    }
    tool_pick(t)
    if (pop_is_open() === 'pop_tool') pop_open('pop_tool', b)
  })
  q('color_btn').addEventListener('click', () => pop_toggle('pop_color', q('color_btn')))
  q('tool_settings_btn').addEventListener('click', () => { tool_page_show('tool'); pop_toggle('pop_tool', q('tool_settings_btn')) })
}

function hex_ok(s: string): number {
  return /^#[0-9a-fA-F]{6}$/.test(s) ? 1 : 0
}

export function custom_load(): void {
  const value = storage_read_json('ug2_pal')
  if (!Array.isArray(value)) return
  const colors: string[] = []
  for (let i = 0; i < value.length; i++) {
    const color = value[i]
    if (typeof color === 'string' && hex_ok(color)) colors.push(color)
  }
  dispatch('pen.custom_set', colors)
}

let cust_lp: ReturnType<typeof setTimeout> | 0 = 0

export function color_pop_events(): void {
  for (let t = 0; t < 3; t++) {
    q('pal_tab_' + t).addEventListener('click', () => {
      dispatch('pen.set_pal_mode', t)
      sfx_play('tap')
    })
  }
  const pick_c = (c: string) => {
    dispatch('pen.set_color', c)
    sfx_play('tap')
  }
  q('pal_grid').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.palc') as HTMLElement | null
    if (b && b.dataset.c) pick_c(b.dataset.c)
  })
  q('cust_grid').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.palc') as HTMLElement | null
    if (b && b.dataset.c) pick_c(b.dataset.c)
  })
  q('cust_grid').addEventListener('pointerdown', e => {
    const b = (e.target as HTMLElement).closest('.palc') as HTMLElement | null
    if (!b || b.dataset.ci === undefined) return
    if (cust_lp) clearTimeout(cust_lp)
    cust_lp = setTimeout(() => {
      cust_lp = 0
      dispatch('pen.custom_remove', Number(b.dataset.ci))
    }, 600)
  })
  const cust_up = () => {
    if (cust_lp) clearTimeout(cust_lp)
    cust_lp = 0
  }
  q('cust_grid').addEventListener('pointerup', cust_up)
  q('cust_grid').addEventListener('pointercancel', cust_up)
  q('cust_grid').addEventListener('pointerleave', cust_up)
  q('cust_add').addEventListener('click', () => {
    dispatch('pen.custom_add', st().pen.color)
  })
  q<HTMLInputElement>('pick_in').addEventListener('input', e => {
    dispatch('pen.set_color', (e.target as HTMLInputElement).value)
  })
  const apply_hex = () => {
    const v = q<HTMLInputElement>('hex_in').value.trim()
    if (!hex_ok(v)) {
      toast('#RRGGBB の形で入れてね')
      return
    }
    dispatch('pen.set_color', v)
    sfx_play('tap')
  }
  q('hex_in').addEventListener('keydown', e => {
    if ((e as KeyboardEvent).key === 'Enter') apply_hex()
  })
  q('hex_in').addEventListener('blur', apply_hex)
}

export function tool_pop_events(): void {
  q('pop_tool').addEventListener('click', e => {
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
  tgl('opt_pressure', () => {
    dispatch('pen.toggle_pressure', null)
    sfx_play('tap')
  })
  tgl('opt_sym_x', () => {
    dispatch('pen.toggle_sym', null)
    sfx_play('tap')
  })
  tgl('opt_sym_y', () => {
    dispatch('pen.toggle_symy', null)
    sfx_play('tap')
  })
  tgl('opt_outline', () => {
    dispatch('pen.toggle_outline', null)
    sfx_play('tap')
  })
  tgl('opt_fill', () => {
    dispatch('pen.toggle_fill', null)
    sfx_play('tap')
  })
  q<HTMLInputElement>('opt_smooth').addEventListener('input', e => {
    dispatch('pen.set_smooth', Number((e.target as HTMLInputElement).value))
  })
  q<HTMLInputElement>('opt_alpha').addEventListener('input', e => {
    dispatch('pen.set_alpha_pct', Number((e.target as HTMLInputElement).value))
  })
  q<HTMLInputElement>('opt_o_width').addEventListener('input', e => {
    dispatch('pen.set_owidth', Number((e.target as HTMLInputElement).value))
  })
  q<HTMLInputElement>('opt_o_color').addEventListener('input', e => {
    dispatch('pen.set_ocolor', (e.target as HTMLInputElement).value)
  })
  const pxn_set = (v: number) => {
    if (!Number.isFinite(v) || v <= 0) return
    dispatch('pen.set_pxn', v)
  }
  q<HTMLInputElement>('pxn_range').addEventListener('input', e => pxn_set(Number((e.target as HTMLInputElement).value)))
  q<HTMLInputElement>('pxn_num').addEventListener('input', e => pxn_set(Number((e.target as HTMLInputElement).value)))
  const size_set = (v: number) => {
    if (!Number.isFinite(v) || v <= 0) return
    dispatch('pen.set_size', v)
  }
  q<HTMLInputElement>('size_range').addEventListener('input', e => size_set(Number((e.target as HTMLInputElement).value)))
  q<HTMLInputElement>('size_num').addEventListener('input', e => size_set(Number((e.target as HTMLInputElement).value)))
  q('pop_tool').addEventListener('click', e => {
    const target = e.target as HTMLElement
    const native = target.closest<HTMLElement>('[data-native-tip]')
    if (native) { dispatch('pen.set_native_tip', Number(native.dataset.nativeTip)); sfx_play('tap'); return }
    if (target.closest('#native_pen_expand')) { dispatch('pen.toggle_native_expand', null); sfx_play('tap'); return }
    if (target.closest('#native_pen_font')) { tool_pick(t_text); return }
    const bb = (e.target as HTMLElement).closest('.brushb') as HTMLElement | null
    if (!bb) return
    dispatch('pen.set_brush', Number(bb.dataset.b))
    if (st().pen.tool !== t_pen) tool_pick(t_pen)
    sfx_play('tap')
  })
  q('opt_fill_all').addEventListener('click', () => {
    dispatch('pen.toggle_fill_all', null)
    sfx_play('tap')
  })
  q('paint_normal').addEventListener('click', () => dispatch('pen.set_paint_over', 0))
  q('paint_over').addEventListener('click', () => dispatch('pen.set_paint_over', 1))
  q('sel_invert').addEventListener('click', () => dispatch('sel.invert', null))
  q('sel_paint_mode').addEventListener('click', () => dispatch('pen.set_paint_over', st().pen.paint_over ? 0 : 1))
  q('sel_paint').addEventListener('click', () => dispatch('sel.paint', null))
  q('sel_register_paint').addEventListener('click', () => dispatch('sel.register_paint', null))
  q('sel_copy').addEventListener('click', () => dispatch('sel.copy', null))
  q('sel_cut').addEventListener('click', () => dispatch('sel.cut', null))
  q('sel_del').addEventListener('click', () => dispatch('sel.delete', null))
}

let tf_target = -1

export function tf_pop_events(): void {
  const r_scale = q<HTMLInputElement>('tf_scale')
  const r_dx = q<HTMLInputElement>('tf_dx')
  const r_dy = q<HTMLInputElement>('tf_dy')
  const r_rot = q<HTMLInputElement>('tf_rot')
  const cur = () => ({ f: Number(r_scale.value) / 100, dx: Number(r_dx.value), dy: Number(r_dy.value), deg: Number(r_rot.value) })
  const show = () => {
    q('tf_scale_v').textContent = r_scale.value + '%'
    q('tf_dx_v').textContent = r_dx.value
    q('tf_dy_v').textContent = r_dy.value
    q('tf_rot_v').textContent = r_rot.value + '°'
  }
  const reset_ui = () => {
    r_scale.value = '100'
    r_dx.value = '0'
    r_dy.value = '0'
    r_rot.value = '0'
    show()
  }
  const move = () => {
    if (!tf_active()) tf_begin(tf_target < 0 ? -1 : st().pen.layer)
    const v = cur()
    show()
    tf_preview(v.f, v.dx, v.dy, v.deg)
  }
  for (const r of [r_scale, r_dx, r_dy, r_rot]) r.addEventListener('input', move)
  q('tf_all').addEventListener('click', () => {
    tf_cancel()
    reset_ui()
    tf_target = -1
    q('tf_all').classList.add('on')
    q('tf_one').classList.remove('on')
  })
  q('tf_one').addEventListener('click', () => {
    tf_cancel()
    reset_ui()
    tf_target = 1
    q('tf_one').classList.add('on')
    q('tf_all').classList.remove('on')
  })
  q('tf_apply').addEventListener('click', () => {
    tf_commit()
    reset_ui()
    sfx_play('save')
    toast('絵をうごかしました')
  })
  q('tf_cancel').addEventListener('click', () => {
    tf_cancel()
    reset_ui()
    sfx_play('tap')
  })
}

export function layer_pop_events(): void {
  const rows = q('layer_rows')
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
        q('photo_layer_btn').click()
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

let mark_lp: ReturnType<typeof setTimeout> | 0 = 0

export function mark_events(): void {
  const g = st()
  q('mark_btn').addEventListener('click', () => pop_toggle('pop_mark', q('mark_btn')))
  q('mark_grid').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.mkb') as HTMLElement | null
    if (!b || !b.dataset.markid) return
    const id = b.dataset.markid
    mark_place(id, canvas => {
      if (!canvas) {
        toast('マークを読み込めなかった…')
        return
      }
      dispatch('flo.begin_image', { canvas, kind: k_paste, x: g.doc.w / 2, y: g.doc.h / 2, continuous: 1 })
      pop_close()
      toast('✓で確定→そのまま連続スタンプ！おわるときはEsc')
      sfx_play('tap')
    })
  })
  q('mark_grid').addEventListener('pointerdown', e => {
    const b = (e.target as HTMLElement).closest('.mkb') as HTMLElement | null
    if (!b || !b.dataset.markid) return
    const id = b.dataset.markid
    if (mark_lp) clearTimeout(mark_lp)
    mark_lp = setTimeout(() => {
      mark_lp = 0
      mark_delete(id)
      toast('マークを消しました')
    }, 600)
  })
  const m_up = () => {
    if (mark_lp) clearTimeout(mark_lp)
    mark_lp = 0
  }
  q('mark_grid').addEventListener('pointerup', m_up)
  q('mark_grid').addEventListener('pointercancel', m_up)
  q('mark_grid').addEventListener('pointerleave', m_up)
  q('mark_add_sel').addEventListener('click', () => {
    mark_capture_from_selection('マーク', ok => {
      toast(ok ? '選択範囲をマークに登録しました' : '登録できるものが見つからないよ（レイヤーがからっぽかも）')
      if (ok) sfx_play('save')
    })
  })
  q('mark_add_file').addEventListener('click', () => {
    file_pick('image/*', f => mark_capture_from_file(f, ok => {
      toast(ok ? '画像をマークに登録しました' : '画像を読めなかった…')
      if (ok) sfx_play('save')
    }))
  })
}

export function tool_input_interrupt(): void {
  if (cust_lp) clearTimeout(cust_lp)
  cust_lp = 0
  if (mark_lp) clearTimeout(mark_lp)
  mark_lp = 0
}
