import { action_tile, choices, switch_row } from './parts'

export function toolbox_settings_html(page: 'transform' | 'view'): string {
  if (page === 'transform') return `
  <section class="opt">${action_tile('tf_hand_btn', 'move', 'コマ全体を手でうごかす')}</section>
  <section class="opt" id="toolbox_turns">
    <div class="opt_head"><b>かえるコマ</b></div>
    ${choices('transform_scope', 'scope', [['current', 'いまのコマ'], ['all', '全部のコマ']])}
  </section>
  <section class="opt">
    <div class="opt_head"><b>回転・反転</b></div>
    <div class="acts">${action_tile('rot_l_btn', 'rotl', '左に90°')}${action_tile('rot_r_btn', 'rotr', '右に90°')}${action_tile('flip_h_btn', 'fliph', '左右反転')}${action_tile('flip_v_btn', 'flipv', '上下反転')}</div>
  </section>
  <section class="opt">
    <div class="opt_head"><b>数字で変える</b></div>
    <div class="opt_row"><label class="plab" for="rotation_angle">角度</label><input type="number" class="numin" id="rotation_angle" min="-360" max="360" step="0.1" value="90" required title="正で右回転・負で左回転"><span class="unit">°</span><button class="pbtn" id="rotate_apply">回転する</button></div>
    <div class="opt_row"><label class="plab" for="artwork_scale">倍率</label><input type="number" class="numin" id="artwork_scale" min="1" max="800" step="1" value="125" required title="中心を基準に変形し、はみ出す部分は切り取ります"><span class="unit">%</span><button class="pbtn" id="scale_apply">大きさを変える</button></div>
  </section>
`
  return `
  <section class="opt">${switch_row('toolbox_mirror', 'fliph', '画面を左右反転')}</section>
  <section class="opt" id="blk_grid">
    ${switch_row('adjust_grid', 'grid', '方眼')}
    ${choices('grid_choices', 'grid-size', [['8', '8px'], ['16', '16px'], ['32', '32px'], ['64', '64px']])}
    <div class="opt_row"><label class="plab" for="grid_step_num">間隔</label><input type="range" id="grid_step_num" min="4" max="64" step="1"><output id="grid_step_val"></output></div>
  </section>
  <section class="opt" id="toolbox_onion">
    <div class="opt_head"><b>前後のコマを透かす</b></div>
    ${choices('onion_choices', 'onion-count', [['0', 'オフ'], ['1', '1枚'], ['2', '2枚'], ['3', '3枚']])}
    <div id="onion_more">
    <div class="opt_row"><label class="plab" for="onion_count">枚数</label><input type="range" id="onion_count" min="0" max="10" step="1"><output id="onion_count_val"></output></div>
    <div class="seg onion_directions"><button id="onion_prev" aria-pressed="true"><i class="onion_dot" aria-hidden="true"></i>前のコマ</button><button id="onion_next" aria-pressed="true"><i class="onion_dot" aria-hidden="true"></i>後のコマ</button></div>
    </div>
  </section>
`
}
