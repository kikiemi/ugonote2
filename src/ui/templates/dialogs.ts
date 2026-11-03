import { fps_speeds } from '../../h'
import { close_html, ic } from '../../dom'
import { action_tile } from './parts'
import { layer_pop } from './tools'

export function dialogs_html(): string {
  return `<div id="scrim"></div><div id="record_bar" hidden role="status"><span class="record_light" aria-hidden="true"></span><span id="record_time">録音中 0:00</span><button id="record_stop">${ic('stop')}<span>録音を止める</span></button></div>
    <div id="pop_wrap"><div class="pop" id="pop_paper"><div class="pop_head"><b>${ic('note')}紙の色</b>${close_html()}</div><div class="pop_body"><div id="paper_choices" class="paper_choices"></div><label id="paper_custom_label">じぶんの色<input type="color" id="paper_custom"></label></div></div>
        <div class="pop sheet" id="pop_layer">${layer_pop()}</div>
        <div class="pop bottom_bar" id="pop_tf"><div class="pop_head"><b>${ic('move')}うごかす</b><output id="tf_info">0°・100%</output>${close_html('やめる')}</div><div class="pop_body">
  <div class="seg"><button id="tf_all" aria-pressed="true">ぜんぶ</button><button id="tf_one" aria-pressed="false">いまのレイヤー</button></div>
  <div class="acts">${action_tile('tf_rot_l', 'rotl', '左に90°')}${action_tile('tf_rot_r', 'rotr', '右に90°')}${action_tile('tf_reset', 'reset', 'リセット')}${action_tile('tf_apply', 'check', 'かくてい', 'primary')}</div>
  </div></div>
        <div class="pop" id="pop_fps"><div class="pop_head"><b>${ic('clock')}はやさ</b>${close_html()}</div><div class="pop_body"><div class="opt_row"><label class="plab" for="fps_range">はやさ</label><input type="range" id="fps_range" min="0" max="${fps_speeds.length - 1}" step="1"><output id="fps_val"></output></div></div></div>
        <div class="pop" id="pop_hold"><div class="pop_head"><b>${ic('clock')}このコマをのばす</b>${close_html()}</div><div class="pop_body"><div class="opt_row"><label class="plab" for="hold_range">長さ</label><input type="range" id="hold_range" min="1" max="8" step="1"><output id="hold_val"></output></div></div></div>
        <div class="pop" id="pop_mark"><div class="pop_head"><b>${ic('mark')}マイマーク</b>${close_html()}</div><div class="pop_body">
          <div class="mkgrid" id="mark_grid" title="長押しで削除"></div>
          <div class="acts">${action_tile('mark_add_sel', 'select', '選択範囲から登録')}${action_tile('mark_add_file', 'image', '画像から登録')}</div>
        </div></div>


      </div>
<div id="pop_scrim"></div>
<div id="ctx_menu" class="hide"></div>
<div id="modal_root"></div>
<div id="tut_root"></div>`
}
