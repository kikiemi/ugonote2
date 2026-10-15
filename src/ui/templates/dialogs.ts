import { fps_speeds } from '../../h'
import { ic } from '../../dom'
import { layer_pop } from './tools'

export function dialogs_html(): string {
  return `<div id="scrim"></div><div id="record_bar" hidden role="status"><span class="record_light" aria-hidden="true"></span><span id="record_time">録音中 0:00</span><button id="record_stop">${ic('stop')}<span>録音を止める</span></button></div>
    <div id="pop_wrap"><div class="pop" id="pop_view"><div class="pop_head"><b>みえかた</b><button class="popx" title="とじる">${ic("check")}<span>かく</span></button></div><div class="pop_body"><div id="layer_shelf"><div class="plab">紙と下書き</div><div id="quick">
        <button class="qb pc_image_quick" id="photo_quick_btn" title="画像を写真レイヤーへ追加">${ic('image')}<i class="qlbl">画像</i></button>
        <button class="qb" id="view_onion_btn" title="前の絵・透かす枚数を選ぶ" aria-haspopup="dialog" aria-controls="rail" aria-expanded="false">${ic('layers')}<i class="qlbl">前の絵</i></button>
        <button class="qb" id="grid_btn" title="キャンバスの方眼">${ic('grid')}<i class="qlbl">グリッド</i></button>
        <button class="qb" id="vflip_btn" title="表示を左右反転(確認用)">${ic('swap')}<i class="qlbl">はんてん</i></button>
        <button class="qb" id="focus_btn" title="道具を隠して集中する" aria-pressed="false">${ic('focus')}<span>集中</span></button>
      </div></div></div></div>
        <div class="pop" id="pop_paper"><div class="pop_head"><b>紙のいろ</b><button class="popx" title="紙の色を閉じる">${ic('check')}<span>とじる</span></button></div><div class="pop_body"><div id="paper_choices" class="paper_choices"></div><label id="paper_custom_label">じぶんの色<input type="color" id="paper_custom"></label><p class="phint" id="paper_mode_hint"></p></div></div>
        <div class="pop" id="pop_layer"><div class="pop_head"><b>レイヤー</b><button class="popx" title="とじる">✕</button></div><div class="pop_body">${layer_pop()}</div></div>
        <div class="pop" id="pop_tf"><div class="pop_head"><b>うごかす</b><button class="popx" title="とじる">✕</button></div><div class="pop_body">
  <div class="prow">
    <span class="plab">対象</span>
    <button class="pbtn on" id="tf_all">ぜんぶ</button>
    <button class="pbtn" id="tf_one">いまのレイヤー</button>
  </div>
  <div class="prow"><span class="plab">よこ</span><input type="range" id="tf_dx" min="-100" max="100" value="0"><b id="tf_dx_v">0</b></div>
  <div class="prow"><span class="plab">たて</span><input type="range" id="tf_dy" min="-100" max="100" value="0"><b id="tf_dy_v">0</b></div>
  <div class="prow"><span class="plab">かいてん</span><input type="range" id="tf_rot" min="-180" max="180" value="0"><b id="tf_rot_v">0°</b></div>
  <div class="prow"><span class="plab">ばいりつ</span><input type="range" id="tf_scale" min="25" max="400" value="100"><b id="tf_scale_v">100%</b></div>
  <div class="prow tgl3">
    <button class="pbtn primary" id="tf_apply">かくてい</button>
    <button class="pbtn" id="tf_cancel">やめる</button>
  </div></div></div>
        <div class="pop" id="pop_fps"><div class="pop_head"><b>はやさ</b><button class="popx" title="とじる">✕</button></div><div class="pop_body"><div class="prow"><span class="plab">はやさ</span><input type="range" id="fps_range" min="0" max="${fps_speeds.length - 1}" step="1"><b id="fps_val"></b></div></div></div>
        <div class="pop" id="pop_hold"><div class="pop_head"><b>このコマをのばす</b><button class="popx" title="とじる">✕</button></div><div class="pop_body"><div class="prow"><span class="plab">このコマの表示</span><input type="range" id="hold_range" min="1" max="8" step="1"><b id="hold_val"></b></div><div class="phint">1コマぶん〜8コマぶん のばせます</div></div></div>
        <div class="pop" id="pop_mark"><div class="pop_head"><b>マイマーク</b><button class="popx" title="とじる">✕</button></div><div class="pop_body">
          <div class="plab">マイマーク <span class="phint">(タップで配置／長押しで削除)</span></div>
          <div class="mkgrid" id="mark_grid"></div>
          <div class="prow tgl3">
            <button class="pbtn" id="mark_add_sel">${ic('select')}選択範囲から登録</button>
            <button class="pbtn" id="mark_add_file">${ic('image')}画像から登録</button>
          </div>
          <div class="phint">えらんだマークはキャンバスに配置して、回転・拡大できます</div>
        </div></div>


      </div>
<div id="pop_scrim"></div>
<div id="ctx_menu" class="hide"></div>
<div id="modal_root"></div>
<div id="tut_root"></div>`
}
