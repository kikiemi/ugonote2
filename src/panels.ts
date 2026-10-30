import { report_warning } from './diagnostics'
import { lang_set, lang_saved } from './lang'
import { esc, q, toast } from './dom'
import { d_all, d_sound, l_draw_default, l_p, mode_normal, reso_size } from './h'
import { file_pick } from './lib'
import { layer_name, mode_allows_layer_alpha } from './mode'
import { pref_theme_toggle, pref_uisfx_toggle, pref_hide_controls_toggle } from './prefs'
import { snd_bgm_preview, snd_recording, snd_se_preview, snd_stop_all, sfx_play } from './snd'
import { dispatch } from './state/commands/index'
import { dirty, st } from './state/store'
import { region_add } from './sync'
import { file_save, modal_export } from './ui/export_ui'
import { rec_kind, rec_toggle, recsync_toggle, recsync_stop } from './ui/recording'
import { flipnote_maker_pick } from './ui/flipnote_maker'
import { modal_animation_assist } from './ui/animation_assist'
import { modal_addmany, modal_close, modal_confirm, modal_goto, modal_is_open } from './ui/modal'
import { snd_assign_preset, snd_clear, snd_load_begin, snd_load_bytes, snd_vol_set } from './ui/sound_io'

import { modal_mixer } from './ui/sound_panel'
import { modal_slots, fixed_4_3_res, modal_new } from './ui/project_panel'
import { photo_import, video_import, file_open_any, flip_import_ui } from './ui/import_panel'
import { apply_canvas } from './ui/canvas_panel'
import { zip_import } from './ui/zip_import'
import { op_layer_clear, op_layer_copy, modal_range } from './ui/frame_panel'
import { modal_effect, modal_transition } from './ui/effect_panel'
import { modal_mode } from './ui/mode_panel'
import { pop_close } from './ui/overlay'

function bind(id: string, fn: () => void): void {
  q(id).addEventListener('click', fn)
}

function sound_file_load(kind: string, label: string): void {
  file_pick('audio/*', file => {
    const ticket = snd_load_begin(kind)
    file.arrayBuffer().then(
      buffer => snd_load_bytes(kind, buffer, file.name.slice(0, 24), error => {
        if (error <= 0) toast(error === 0 ? label + 'を読み込みました' : '読めない形式みたい…')
      }, ticket),
      error => {
        report_warning('音声ファイルを読み出せませんでした', error)
        toast('読めない形式みたい…')
      }
    )
  })
}

export function panels_mount(): void {
  bind('new_btn', () => modal_new())
  bind('free_new_btn', () => modal_new(true))
  bind('slots_btn', modal_slots)
  bind('menu_open', file_open_any)
  bind('open_btn', file_open_any)
  bind('open_flip_btn', flip_import_ui)
  bind('save_file_btn', file_save)
  bind('export_btn', () => modal_export())
  bind('photo_btn', photo_import)
  bind('photo_quick_btn', photo_import)
  bind('dock_image', photo_import)
  bind('photo_layer_btn', photo_import)
  bind('photo_draft_btn', () => {
    const g = st()
    if (!mode_allows_layer_alpha(g.doc.mode)) {
      toast('このモードでは写真の透明度を変えられないよ')
      return
    }
    if (!g.doc.lvis[l_p]) dispatch('layer.toggle_visible', l_p)
    const draft = g.doc.lalpha[l_p] >= 250
    dispatch('layer.set_alpha', { l: l_p, a255: draft ? Math.round(255 * 0.35) : 255 })
    toast(draft ? '写真を下書き表示にしました' : '写真を100%表示に戻しました')
    sfx_play('tap')
  })
  bind('photo_clear_btn', () => {
    if (dispatch('layer.clear_at', l_p) < 0) {
      toast('このコマに写真はないよ')
      return
    }
    toast('写真レイヤーを消しました')
    sfx_play('del')
  })
  bind('video_btn', video_import)
  bind('zip_in_btn', zip_import)
  bind('flip_in_btn', flip_import_ui)
  bind('mixer_btn', () => modal_mixer())
  bind('flip_image_btn', flipnote_maker_pick)
  bind('motion_assist_btn', modal_animation_assist)
  bind('effect_btn', modal_effect)
  bind('trans_btn', modal_transition)
  bind('mode_btn', modal_mode)
  bind('sync_rec_btn', recsync_toggle)
  bind('record_stop', recsync_stop)
  bind('size_apply', apply_canvas)
  bind('merge_btn', () => dispatch('layer.merge_down', null))
  bind('lclear_btn', op_layer_clear)
  bind('penbox_normal', () => dispatch('doc.set_penbox', 0))
  bind('penbox_advanced', () => dispatch('doc.set_penbox', 1))
  bind('lcopy_btn', op_layer_copy)
  bind('ladd_btn', () => dispatch('layer.add', null))
  bind('ldel_btn', () => {
    const layer = st().pen.layer
    if (st().doc.mode !== mode_normal || layer <= l_draw_default) return
    modal_confirm('レイヤーを削除', 'レイヤー' + esc(layer_name(layer)) + 'を全コマから削除する？', '削除', () => dispatch('layer.delete', layer))
  })
  bind('add_many_btn', modal_addmany)
  bind('range_btn', modal_range)
  bind('goto_btn', modal_goto)
  bind('theme_btn', () => {
    pref_theme_toggle()
    dirty(d_all)
    sfx_play('tap')
  })
  bind('hide_controls_btn', () => {
    if (!pref_hide_controls_toggle()) document.body.classList.remove('canvas_writing')
    dirty(d_all)
    sfx_play('tap')
  })
  const language = q<HTMLSelectElement>('set_lang')
  language.value = lang_saved()
  language.addEventListener('change', () => lang_set(language.value))
  bind('uisfx_tgl', () => {
    pref_uisfx_toggle()
    dirty(d_sound)
    sfx_play('tap')
  })
  q<HTMLInputElement>('paper_in').addEventListener('input', e => {
    dispatch('doc.set_paper', (e.target as HTMLInputElement).value)
  })
  q<HTMLInputElement>('paper_custom').addEventListener('input', e => dispatch('doc.set_paper', (e.target as HTMLInputElement).value))
  // 紙の色をえらぶ。紙のいろの画面では、えらんでいる色をもう一度押したら閉じる。
  for (const id of ['paper_choices', 'paper_sw']) {
    q(id).addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-paper]')
      if (!b?.dataset.paper) return
      if (id === 'paper_choices' && b.getAttribute('aria-pressed') === 'true') pop_close()
      else dispatch('doc.set_paper', b.dataset.paper)
      sfx_play('tap')
    })
  }
  const ratio_sel = q<HTMLSelectElement>('ratio_sel')
  const reso_sel = q<HTMLSelectElement>('reso_sel')
  const size_update = () => {
    const s2 = reso_size(ratio_sel.value, reso_sel.value)
    q('size_now').textContent = '→ ' + s2.w + '×' + s2.h
  }
  ratio_sel.addEventListener('change', () => {
    if (reso_sel.value === 'free') reso_sel.value = 'low'
    if (ratio_sel.value !== '4:3' && fixed_4_3_res(reso_sel.value)) reso_sel.value = 'low'
    size_update()
  })
  reso_sel.addEventListener('change', () => {
    if (ratio_sel.value === 'free') ratio_sel.value = '16:9'
    if (fixed_4_3_res(reso_sel.value)) ratio_sel.value = '4:3'
    size_update()
  })
  for (let i = 0; i < 2; i++) {
    const kind = 'bgm' + i
    bind('sload_' + kind, () => sound_file_load(kind, 'BGM'))
    bind('srec_' + kind, () => rec_toggle(kind))
    bind('splay_' + kind, () => snd_bgm_preview(i, 1))
    bind('sclr_' + kind, () => {
      snd_clear(kind)
      snd_stop_all()
    })
  }
  for (let i = 0; i < 4; i++) {
    const kind = 'se' + i
    q<HTMLSelectElement>('spre_' + kind).addEventListener('change', e => {
      const v = (e.target as HTMLSelectElement).value
      if (!v) return
      snd_assign_preset(i, v)
      snd_se_preview(i)
    })
    bind('sload_' + kind, () => sound_file_load(kind, 'SE'))
    bind('srec_' + kind, () => rec_toggle(kind))
    bind('splay_' + kind, () => snd_se_preview(i))
    bind('sassign_' + kind, () => modal_mixer(i))
    bind('sclr_' + kind, () => snd_clear(kind))
  }
  q<HTMLInputElement>('bgm_vol').addEventListener('input', e => snd_vol_set('bgm', Number((e.target as HTMLInputElement).value) / 100))
  q<HTMLInputElement>('se_vol').addEventListener('input', e => snd_vol_set('se', Number((e.target as HTMLInputElement).value) / 100))
  region_add('sound_rec', d_sound, () => {
    const kinds = ['bgm0', 'bgm1', 'se0', 'se1', 'se2', 'se3']
    for (const k of kinds) q('srec_' + k).classList.toggle('rec', snd_recording() && rec_kind() === k ? true : false)
    q('sync_rec_btn').classList.toggle('on', snd_recording() && (rec_kind() === 'bgm0' || rec_kind() === 'bgm1') ? true : false)
  })
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal_is_open()) {
      const back = q('modal_root').firstElementChild
      if (back && !back.querySelector('.pfill')) modal_close()
    }
  })
}
