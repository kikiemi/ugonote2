import { report_warning } from './diagnostics'
import { esc, q, toast } from './dom'
import { D_ALL, D_SAVE, D_SOUND, D_TOOLS, L_DRAW_DEFAULT, L_P, MODE_NORMAL, reso_size } from './h'
import { file_pick } from './lib'
import { layer_name, mode_allows_layer_alpha } from './mode'
import { pref_theme_toggle, pref_uisfx_toggle } from './prefs'
import { snd_bgm_preview, snd_recording, snd_se_preview, snd_stop_all, sfx_play } from './snd'
import { dispatch } from './state/commands/index'
import { dirty, st } from './state/store'
import { region_add } from './sync'
import { file_open, file_save, modal_export, rec_kind, rec_toggle, recsync_toggle, recsync_stop } from './ui/export_ui'
import { flipnote_maker_pick } from './ui/flipnote_maker'
import { modal_animation_assist } from './ui/animation_assist'
import { modal_addmany, modal_close, modal_confirm, modal_goto, modal_is_open } from './ui/modal'
import { snd_assign_preset, snd_clear, snd_load_begin, snd_load_bytes, snd_vol_set } from './ui/sound_io'

export { modal_export } from './ui/export_ui'
export { modal_active, modal_addmany, modal_close, modal_confirm, modal_goto, modal_prompt_num, modal_text } from './ui/modal'

import { modal_mixer } from './ui/sound_panel'
export { modal_mixer } from './ui/sound_panel'
import { modal_slots, fixed_4_3_res, modal_new } from './ui/project_panel'
export { modal_slots, modal_new } from './ui/project_panel'
import { photo_import, video_import, file_open_any, flip_import_ui } from './ui/import_panel'
import { apply_canvas, transform_all } from './ui/canvas_panel'
import { zip_import } from './ui/zip_import'
import { op_layer_clear, op_layer_copy, modal_range } from './ui/frame_panel'
export { op_layer_clear, op_layer_copy, modal_range } from './ui/frame_panel'
import { modal_effect, modal_transition } from './ui/effect_panel'
export { modal_effect, modal_transition } from './ui/effect_panel'
import { modal_mode } from './ui/mode_panel'
export { modal_mode } from './ui/mode_panel'

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
  bind('newBtn', () => modal_new())
  bind('freeNewBtn', () => modal_new(true))
  bind('slotsBtn', modal_slots)
  bind('menuOpen', file_open_any)
  bind('openBtn', file_open)
  bind('openFlipBtn', flip_import_ui)
  bind('saveFileBtn', file_save)
  bind('exportBtn', () => modal_export())
  bind('photoBtn', photo_import)
  bind('photoQuickBtn', photo_import)
  bind('dockImage', photo_import)
  bind('photoLayerBtn', photo_import)
  bind('photoDraftBtn', () => {
    const g = st()
    if (!mode_allows_layer_alpha(g.doc.mode)) {
      toast('このモードでは写真の透明度を変えられないよ')
      return
    }
    if (!g.doc.lvis[L_P]) dispatch('layer.toggle_visible', L_P)
    const draft = g.doc.lalpha[L_P] >= 250
    dispatch('layer.set_alpha', { l: L_P, a255: draft ? Math.round(255 * 0.35) : 255 })
    toast(draft ? '写真を下書き表示にしました' : '写真を100%表示に戻しました')
    sfx_play('tap')
  })
  bind('photoClearBtn', () => {
    if (dispatch('layer.clear_at', L_P) < 0) {
      toast('このコマに写真はないよ')
      return
    }
    toast('写真レイヤーを消しました')
    sfx_play('del')
  })
  bind('videoBtn', video_import)
  bind('zipInBtn', zip_import)
  bind('flipInBtn', flip_import_ui)
  bind('mixerBtn', () => modal_mixer())
  bind('flipImageBtn', flipnote_maker_pick)
  bind('motionAssistBtn', modal_animation_assist)
  bind('effectBtn', modal_effect)
  bind('transBtn', modal_transition)
  bind('modeBtn', modal_mode)
  bind('syncRecBtn', recsync_toggle)
  bind('recordStop', recsync_stop)
  bind('sizeApply', apply_canvas)
  bind('rotLBtn', () => transform_all('rotl'))
  bind('rotRBtn', () => transform_all('rotr'))
  bind('flipHBtn', () => transform_all('fliph'))
  bind('flipVBtn', () => transform_all('flipv'))
  bind('mergeBtn', () => dispatch('layer.merge_down', null))
  bind('lclearBtn', op_layer_clear)
  bind('lcopyBtn', op_layer_copy)
  bind('laddBtn', () => dispatch('layer.add', null))
  bind('ldelBtn', () => {
    const layer = st().pen.layer
    if (st().doc.mode !== MODE_NORMAL || layer <= L_DRAW_DEFAULT) return
    modal_confirm('レイヤーを削除', 'レイヤー' + esc(layer_name(layer)) + 'を全コマから削除する？', '削除', () => dispatch('layer.delete', layer))
  })
  bind('addManyBtn', modal_addmany)
  bind('rangeBtn', modal_range)
  bind('gotoBtn', modal_goto)
  bind('themeBtn', () => {
    pref_theme_toggle()
    dirty(D_ALL)
    sfx_play('tap')
  })
  bind('uisfxTgl', () => {
    pref_uisfx_toggle()
    dirty(D_SAVE | D_TOOLS)
    sfx_play('tap')
  })
  q<HTMLInputElement>('paperIn').addEventListener('input', e => {
    dispatch('doc.set_paper', (e.target as HTMLInputElement).value)
  })
  q<HTMLInputElement>('paperCustom').addEventListener('input', e => dispatch('doc.set_paper', (e.target as HTMLInputElement).value))
  q('paperChoices').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-paper]')
    if (b?.dataset.paper) dispatch('doc.set_paper', b.dataset.paper)
  })
  q('paperSw').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('[data-paper]') as HTMLElement | null
    if (!b) return
    dispatch('doc.set_paper', b.dataset.paper as string)
    sfx_play('tap')
  })
  const ratioSel = q<HTMLSelectElement>('ratioSel')
  const resoSel = q<HTMLSelectElement>('resoSel')
  const size_update = () => {
    const s2 = reso_size(ratioSel.value, resoSel.value)
    q('sizeNow').textContent = '→ ' + s2.w + '×' + s2.h
  }
  ratioSel.addEventListener('change', () => {
    if (resoSel.value === 'free') resoSel.value = 'low'
    if (ratioSel.value !== '4:3' && fixed_4_3_res(resoSel.value)) resoSel.value = 'low'
    size_update()
  })
  resoSel.addEventListener('change', () => {
    if (ratioSel.value === 'free') ratioSel.value = '16:9'
    if (fixed_4_3_res(resoSel.value)) ratioSel.value = '4:3'
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
  q<HTMLInputElement>('bgmVol').addEventListener('input', e => snd_vol_set('bgm', Number((e.target as HTMLInputElement).value) / 100))
  q<HTMLInputElement>('seVol').addEventListener('input', e => snd_vol_set('se', Number((e.target as HTMLInputElement).value) / 100))
  region_add('sound_rec', D_SOUND, () => {
    const kinds = ['bgm0', 'bgm1', 'se0', 'se1', 'se2', 'se3']
    for (const k of kinds) q('srec_' + k).classList.toggle('rec', snd_recording() && rec_kind() === k ? true : false)
    q('syncRecBtn').classList.toggle('on', snd_recording() && (rec_kind() === 'bgm0' || rec_kind() === 'bgm1') ? true : false)
  })
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal_is_open()) {
      const back = q('modalRoot').firstElementChild
      if (back && !back.querySelector('.pfill')) modal_close()
    }
  })
}
