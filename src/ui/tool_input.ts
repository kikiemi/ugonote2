import { doc_frame_order } from '../doc'
import { q, toast } from '../dom'
import { is_shape_tool, k_paste, t_pen, t_select, t_text } from '../h'
import { pen_tool } from '../penprofile'
import { file_pick } from '../lib'
import { mark_capture_from_file, mark_capture_from_selection, mark_delete, mark_place } from '../mark'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { storage_read_json } from '../storage'
import { tool_has_options, tool_page_show } from './tool_options'
import { shape_memory } from './tool_defs'
import { rail_shapes_render } from './rail_shapes'
import { mark_wait_start } from './selection_toolbar'
import { frame_move_commit, frame_move_reset, frame_move_start, frame_move_target, frame_move_turn } from './frame_move'
import { pop_close, pop_is_open, pop_open, pop_toggle } from './overlay'
import { sheet_bind } from './sheet'
import { tool_pick } from './stage_input'
import { anim_stop } from './playback'
import { flo_active } from '../sel'

// 道具箱の道具一覧。選んでいる道具をもう一度押すと、その設定を開け閉めする。
export function rail_events(): void {
  q('rail_tools').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('.rb[data-t]')
    if (!button) return
    const t = Number(button.dataset.t)
    if (st().pen.tool === t && tool_has_options(t)) {
      pop_toggle('pop_tool', button)
      return
    }
    tool_pick(t)
    if (pop_is_open() === 'pop_tool') pop_open('pop_tool', button)
  })
  // 道具箱の大きさが変わったら、図形の1行をならべなおす (つぎの描きなおしのときに。大きさを見ている最中に形を変えないように)。
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => requestAnimationFrame(rail_shapes_render)).observe(q('rail_tools'))
  // 「その他」: 図形の設定のページで、ほかの図形とマイマークから選ぶ。図形を持っていなければ、最後に使った図形を持つ。
  q('tl_shape_more').addEventListener('click', () => {
    const button = q('tl_shape_more')
    if (!is_shape_tool(st().pen.tool)) tool_pick(shape_memory.tool)
    tool_page_show('shape')
    pop_toggle('pop_tool', button)
  })
  q('color_btn').addEventListener('click', () => pop_toggle('pop_color', q('color_btn')))
  q('tool_settings_btn').addEventListener('click', () => {
    tool_page_show('tool')
    pop_toggle('pop_tool', q('tool_settings_btn'))
  })
  // 道具の設定から色へ飛び、色の画面の「設定」でもとの設定へもどる。
  q('tool_color_btn').addEventListener('click', () => pop_open('pop_color', q('tool_color_btn')))
  q('color_back').addEventListener('click', () => pop_open('pop_tool', q('dock_settings')))
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
  // 色をえらぶ。えらんでいる色をもう一度押したら、色の画面を閉じる。
  for (const id of ['pal_grid', 'cust_grid']) {
    q(id).addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.palc')
      if (!b?.dataset.c) return
      if (b.getAttribute('aria-pressed') === 'true') pop_close()
      else dispatch('pen.set_color', b.dataset.c)
      sfx_play('tap')
    })
  }
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

// 道具の設定。一覧から選ぶボタンは data-* でまとめて受け、切りかえと数値はそれぞれの部品で受ける。
export function tool_pop_events(): void {
  q('pop_tool').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-sz], [data-pat], [data-b], [data-native-tip], [data-native-eraser], [data-native-paint], [data-shape], [data-pixel-count], #native_pen_font')
    if (!button) return
    const d = button.dataset
    if (button.id === 'native_pen_font') {
      tool_pick(t_text)
      return
    }
    // 選んでいるものをもう一度押したら、設定を閉じて描く画面にもどる。
    if (button.classList.contains('on') || button.getAttribute('aria-pressed') === 'true') {
      pop_close()
      sfx_play('tap')
      return
    }
    if (d.sz) dispatch('pen.set_size', Number(d.sz))
    else if (d.pat) dispatch('pen.set_pat', Number(d.pat))
    else if (d.nativeTip) dispatch('pen.set_native_tip', Number(d.nativeTip))
    else if (d.nativeEraser) dispatch('pen.set_native_eraser', Number(d.nativeEraser))
    else if (d.nativePaint) dispatch('pen.set_native_paint', Number(d.nativePaint))
    else if (d.shape) dispatch('pen.set_tool', Number(d.shape))
    else if (d.pixelCount) dispatch('pen.set_pxn', Number(d.pixelCount))
    else if (d.b) {
      dispatch('pen.set_brush', Number(d.b))
      if (!pen_tool(st().pen.tool)) tool_pick(t_pen)
    }
    sfx_play('tap')
    // ペンは、選んだらすぐ描けるよう、1回で設定を閉じる。
    if (d.b || d.nativeTip) pop_close()
  })
  const toggles: [string, () => void][] = [
    ['opt_pressure', () => dispatch('pen.toggle_pressure', null)],
    ['opt_sym_x', () => dispatch('pen.toggle_sym', null)],
    ['opt_sym_y', () => dispatch('pen.toggle_symy', null)],
    ['opt_outline', () => dispatch('pen.toggle_outline', null)],
    ['opt_fill', () => dispatch('pen.toggle_fill', null)],
    ['opt_fill_all', () => dispatch('pen.toggle_fill_all', null)],
    ['native_pen_expand', () => dispatch('pen.toggle_native_expand', null)],
    ['native_eraser_expand', () => dispatch('pen.toggle_native_eraser_expand', null)],
    ['paint_normal', () => dispatch('pen.set_paint_over', 0)],
    ['paint_over', () => dispatch('pen.set_paint_over', 1)],
  ]
  for (const [id, fn] of toggles) {
    q(id).addEventListener('click', () => {
      fn()
      sfx_play('tap')
    })
  }
  // 数値の欄。打ちかけ (空や最小より小さい値) のあいだは反映しない。
  const numbers: [string, number, (v: number) => void][] = [
    ['opt_smooth', 0, v => dispatch('pen.set_smooth', v)],
    ['opt_alpha', 0, v => dispatch('pen.set_alpha_pct', v)],
    ['opt_o_width', 1, v => dispatch('pen.set_owidth', v)],
    ['size_range', 1, v => dispatch('pen.set_size', v)],
    ['size_num', 1, v => dispatch('pen.set_size', v)],
    ['pxn_range', 1, v => dispatch('pen.set_pxn', v)],
    ['pxn_num', 1, v => dispatch('pen.set_pxn', v)],
  ]
  for (const [id, min, fn] of numbers) {
    q<HTMLInputElement>(id).addEventListener('input', e => {
      const text = (e.target as HTMLInputElement).value.trim()
      const v = Number(text)
      if (text && Number.isFinite(v) && v >= min) fn(v)
    })
  }
  q<HTMLInputElement>('opt_o_color').addEventListener('input', e => dispatch('pen.set_ocolor', (e.target as HTMLInputElement).value))
}

let tf_target = -1

// 「うごかす」の画面。開くとコマ全体を紙の上で直接うごかせるようになる (frame_move.ts)。
export function tf_open(): void {
  pop_toggle('pop_tf', q('tf_btn'))
  if (pop_is_open() !== 'pop_tf') return
  anim_stop()
  if (flo_active()) dispatch('flo.confirm', null)
  dispatch('sel.clear', null)
  frame_move_start(tf_target < 0 ? -1 : st().pen.layer)
}

export function tf_pop_events(): void {
  const target = (all: number): void => {
    tf_target = all ? -1 : 1
    q('tf_all').setAttribute('aria-pressed', String(!!all))
    q('tf_one').setAttribute('aria-pressed', String(!all))
    frame_move_target(all ? -1 : st().pen.layer)
  }
  q('tf_all').addEventListener('click', () => target(1))
  q('tf_one').addEventListener('click', () => target(0))
  q('tf_rot_l').addEventListener('click', () => frame_move_turn(-90))
  q('tf_rot_r').addEventListener('click', () => frame_move_turn(90))
  q('tf_reset').addEventListener('click', frame_move_reset)
  q('tf_apply').addEventListener('click', () => {
    frame_move_commit()
    pop_close()
    sfx_play('save')
    toast('絵をうごかしました')
  })
}

export function layer_pop_events(): void {
  sheet_bind(q('pop_layer'))
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
      // 描いているレイヤーをもう一度押したら、レイヤーの画面を閉じる。
      if (layer === st().pen.layer) pop_close()
      else dispatch('pen.set_layer', layer)
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

// マークの一覧 (マイマークの画面と、図形のページ)。押すとスタンプ、長押しで削除。
function mark_grid_events(id: string): void {
  const g = st()
  q(id).addEventListener('click', e => {
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
  q(id).addEventListener('pointerdown', e => {
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
  q(id).addEventListener('pointerup', m_up)
  q(id).addEventListener('pointercancel', m_up)
  q(id).addEventListener('pointerleave', m_up)
}

export function mark_events(): void {
  q('mark_btn').addEventListener('click', () => pop_toggle('pop_mark', q('mark_btn')))
  q('shape_mark_manage').addEventListener('click', () => pop_open('pop_mark', q('mark_btn')))
  mark_grid_events('mark_grid')
  mark_grid_events('shape_mark_grid')
  // 範囲をえらんでいなければ、はんいの道具にして、えらんでから操作バーの「マーク登録」で登録してもらう。
  q('mark_add_sel').addEventListener('click', () => {
    if (!st().sel.has) {
      mark_wait_start(st().pen.tool)
      pop_close()
      tool_pick(t_select)
      toast('マークにしたい所をかこんで、「マーク登録」を押してね')
      return
    }
    mark_capture_from_selection('マーク', ok => {
      toast(ok ? 'マークに登録しました' : 'いまのレイヤーの、えらんだ所に絵がありません（レイヤーを切りかえてね）')
      if (ok) sfx_play('save')
    })
  })
  q('mark_add_file').addEventListener('click', () => {
    file_pick('image/*', f => mark_capture_from_file(f, ok => {
      toast(ok ? 'マークに登録しました' : '画像を読めませんでした')
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
