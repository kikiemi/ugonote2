import { ic } from '../../dom'

export function toolbox_settings_html(page: 'transform' | 'view'): string {
  if (page === 'transform') return `
  <div class="pbk" id="toolbox_turns">
    <div class="adjust_heading"><b>絵の変形</b></div>
    <label class="prow"><span class="plab">適用するコマ</span><select id="transform_scope" class="msel"><option value="current">いまのコマ</option><option value="all">全コマ</option></select></label>
    <p class="phint">全レイヤーに適用。「いまのコマ」は「もどす」が使えます。</p>
    <div class="transform_group"><b>回転</b><div class="toolbox_turns"><button class="pbtn" id="rot_l_btn">${ic('rotl')}左に90°</button><button class="pbtn" id="rot_r_btn">${ic('rotr')}右に90°</button></div><div class="prow"><label class="plab" for="rotation_angle">角度</label><input type="number" class="numin" id="rotation_angle" min="-360" max="360" step="0.1" value="90" required><span class="plab">°</span><button class="pbtn" id="rotate_apply">回転する</button></div><p class="phint">正の角度は右回転、負の角度は左回転。はみ出す絵は、切らずに全体を収めます。</p></div>
    <div class="transform_group"><b>拡大・縮小</b><div class="prow"><label class="plab" for="artwork_scale">倍率</label><input type="number" class="numin" id="artwork_scale" min="1" max="800" step="1" value="125" required><span class="plab">%</span><button class="pbtn" id="scale_apply">大きさを変える</button></div><p class="phint">100%が現在の大きさです。中心を基準に変形し、はみ出す部分は切り取ります。</p></div>
    <div class="transform_group"><b>反転</b><div class="toolbox_turns"><button class="pbtn" id="flip_h_btn">${ic('fliph')}左右を反転</button><button class="pbtn" id="flip_v_btn">${ic('flipv')}上下を反転</button></div></div>
  </div>
`
  return `
  <p class="phint">表示だけの設定です。保存する絵は変わりません。</p>
  <div class="pbk"><div class="adjust_heading"><b>画面の左右反転</b><button class="tgl" id="toolbox_mirror">${ic('eye')}表示だけ左右反転</button></div></div>
  <div class="pbk" id="blk_grid"><div class="adjust_heading"><b>キャンバスの方眼</b><button class="tgl" id="adjust_grid" aria-pressed="false">表示オフ</button></div><div class="adjust_choices" id="grid_choices"><button data-grid-size="8">8 px</button><button data-grid-size="16">16 px</button><button data-grid-size="32">32 px</button><button data-grid-size="64">64 px</button></div><div class="prow"><label class="plab" for="grid_step_num">間隔</label><input type="number" class="numin" id="grid_step_num" min="4" max="64" step="1" aria-label="方眼の間隔を入力"><span class="plab">px</span></div><div class="phint" id="grid_step_hint"></div></div>
  <div class="pbk" id="toolbox_onion"><div class="adjust_heading"><b>前後の絵を透かす</b></div><p class="phint">0枚でオフ。前後それぞれ10枚まで重ねられます。</p><div id="onion_choices" aria-label="透かす枚数"><button data-onion-count="0" aria-pressed="false">オフ</button><button data-onion-count="1" aria-pressed="false">1枚</button><button data-onion-count="2" aria-pressed="false">2枚</button><button data-onion-count="3" aria-pressed="false">3枚</button></div><div class="onion_directions"><button class="tgl" id="onion_prev" aria-pressed="true">前のコマ</button><button class="tgl" id="onion_next" aria-pressed="true">後のコマ</button></div><div class="onion_legend"><span>赤：前のコマ</span><span>青：後のコマ</span></div><div class="prow"><label class="plab" for="onion_count">枚数</label><input class="numin" type="number" id="onion_count" min="0" max="10" step="1" aria-label="透かす枚数・0枚でオフ"><span class="plab">枚</span></div></div>
`
}
