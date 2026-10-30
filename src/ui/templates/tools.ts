import { close_html, ic } from '../../dom'
import { t_line, t_select, pat_table, sizes, brush_defs, size_min, size_max, pxn_min, pxn_max, shape_index, shape_tool_list } from '../../h'
import { pat_custom } from '../../paint'
import { shape_row, shape_tools, tool_def, tool_defs } from '../tool_defs'
import { tool_has_options } from '../tool_options'
import { native_eraser_html, native_paint_html, native_pen_html, size_buttons } from '../pen_palette'
import { convenience_html } from './features'
import { action_tile, switch_row } from './parts'
import { sheet_html } from './sheet'
import { toolbox_settings_html } from './toolbox'

// 道具箱の道具一覧で、この道具の前に入れる見出し。
const rail_sep_before = new Map<number, string>([[t_line, 'かたち'], [t_select, 'えらぶ・うごかす']])

// 図形は1行だけならべ、のこりは「その他」(図形の設定のページ) から選ぶ。何こならべるかは、道具箱の列の数で
// rail_shapes.ts が決める (はじめは shape_row こ)。のこりの図形のボタンも、選んだ道具の表示をそろえるために作っておく。
function shape_class(t: number): string {
  return shape_index(t) >= shape_row ? ' rshape_more' : ''
}

export function rail(): string {
  let s = '<i class="rsep" aria-hidden="true">かく</i>'
  for (const d of tool_defs) {
    const sec = rail_sep_before.get(d.t)
    if (sec !== undefined) s += `<i class="rsep" aria-hidden="true">${sec}</i>`
    const options = tool_has_options(d.t)
    s += `<button class="rb${options ? ' hasopts' : ''}${shape_class(d.t)}" id="tl_${d.t}" data-t="${d.t}" title="${d.label}${d.key ? ' (' + d.key + ')' : ''}"${options ? ' aria-haspopup="dialog"' : ''}>${ic(d.icon)}<i class="rlbl">${d.label}</i></button>`
    if (d.t === shape_tool_list[shape_tool_list.length - 1]) s += `<button class="rb hasopts" id="tl_shape_more" title="ほかの図形・マイマーク" aria-haspopup="dialog" aria-pressed="false">${ic('dots')}<i class="rlbl">その他</i></button>`
  }
  s += `<button class="rb" id="tf_btn" title="うごかす（スライド・かいてん・かくだい）">${ic('move')}<i class="rlbl">うごかす</i></button>`
  return `<div class="toolbox_head">
      <div class="tool_heading"><b>${ic('tools')}道具箱</b></div>
      ${close_html('とじる', ' id="toolbox_close"')}
    </div>
    <div class="toolbox_body">
      <section class="toolbox_page" data-toolbox-panel="features" hidden>${convenience_html()}</section>
      <section class="toolbox_page" data-toolbox-panel="transform" hidden>${toolbox_settings_html('transform')}</section>
      <section class="toolbox_page" data-toolbox-panel="view" hidden>${toolbox_settings_html('view')}</section>
      <section class="toolbox_page" data-toolbox-panel="tools">
        <div class="rtools" id="rail_tools">${s}</div>
        <div class="toolbox_actions">
          <button class="rb rswatch" id="color_btn" title="いろ"><span class="chip" id="color_chip"></span><i class="rlbl">いろ</i></button>
          <button class="rb" id="tool_settings_btn" title="選んだ道具の設定" aria-haspopup="dialog" aria-controls="pop_tool" aria-expanded="false">${ic('gear')}<i class="rlbl">道具設定</i></button>
          <button class="rb" id="mark_btn" title="マーク(スタンプ)">${ic('mark')}<i class="rlbl">マーク</i></button>
        </div>
      </section>
    </div>
    <nav class="tool_page_tabs toolbox_tabs" aria-label="編集パネルの項目">
      <button data-toolbox-page="tools" aria-pressed="true">${ic('pen')}描く道具</button>
      <button data-toolbox-page="transform" aria-pressed="false">${ic('rotr')}絵の変形</button>
      <button data-toolbox-page="view" aria-pressed="false">${ic('eye')}表示</button>
      <button data-toolbox-page="features" aria-pressed="false">${ic('spark')}便利機能</button>
    </nav>`
}

function brush_pop(): string {
  let s = ''
  for (const b of brush_defs) s += `<button class="brushb" id="brush_${b.id}" data-b="${b.id}" title="${b.label}"><span class="pen_handle" aria-hidden="true">${pen_illustration(b.id)}</span><canvas width="64" height="28" data-brushprev="${b.id}"></canvas><span>${b.label}</span></button>`
  return s
}

function pen_illustration(id: number): string {
  const tips = [
    '<path d="m18 57 6 13 6-13Z" fill="var(--acc)"/><path d="M18 48h12v9H18Z"/>',
    '<path d="M16 49h16v12l-16 7Z" fill="var(--acc)"/>',
    '<path d="m18 54 6 17 6-17Z" fill="#ffd89c"/><path d="m21 63 3 8 3-8Z" fill="var(--tx)"/><path d="M24 10v44"/>',
    '<path d="M17 49h14v6H17Z"/><path d="M17 55c0 10 6 6 7 16 9-5 7-11 7-16Z" fill="var(--acc)"/>',
    '<path d="M17 47h14v14H17Z"/><path d="M24 4V0m-7 3-3-3m17 3 3-3"/>',
    '<path d="M17 51h14l-7 18Z" fill="var(--acc)"/><path d="M16 24h16v18H16Z" fill="var(--acc_soft)"/>',
    '<path d="m17 50 7 20 7-20-7-7Z" fill="var(--acc_soft)"/><path d="M24 50v20m-3-18h6"/>',
    '<circle cx="18" cy="59" r="2"/><circle cx="28" cy="63" r="2"/><circle cx="23" cy="69" r="1.5"/>',
    '<path d="M17 49h14v7H17Z"/><path d="M17 56c1 6 5 10 7 14 2-4 6-8 7-14Z" fill="var(--acc)"/>',
    '<path d="M18 49h12v17H18Z" fill="var(--acc_soft)"/><path d="M24 53v10" stroke="#fff" stroke-width="3"/>',
    '<path d="M16 48h16v17H16Z" fill="var(--acc_soft)"/><path d="m17 65 5 1 3-2 6 1"/>',
    '<path d="M17 50h14v8H17Z"/><path d="m16 65 4-3m12 1-3-2m-5 6v4"/>',
    '<path d="M18 48h12v9H18Z"/><path d="M24 57c-15 8 16 6 0 15" stroke="var(--acc)" stroke-width="5"/>',
  ]
  return `<svg viewBox="0 0 48 76" fill="none" stroke="var(--acc_d)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 48V12a7 7 0 0 1 14 0v36" fill="var(--bg2)"/><path d="M17 15h14M17 43h14M28 16v15"/>${tips[id] || tips[0]}</svg>`
}

function pat_pop(): string {
  let s = ''
  for (let i = 0; i < pat_table.length; i++) s += `<button class="patb" id="pat_${i}" data-pat="${i}" title="${pat_table[i].label}"><canvas width="28" height="28" data-patprev="${i}"></canvas><small>${pat_table[i].label}</small></button>`
  s += `<button class="patb custom_paint" id="pat_${pat_custom}" data-pat="${pat_custom}" title="登録したもよう" aria-label="もようの登録枠「？」">${ic('paintcustom')}<canvas width="28" height="28" id="custom_paint_preview" hidden></canvas><span class="paint_badge">?</span><small>登録</small></button>`
  return s
}

function shape_pop(): string {
  let s = ''
  for (const t of shape_tools) {
    const def = tool_def(t)!
    s += `<button class="act" id="shape_${t}" data-shape="${t}" title="${def.label}${def.key ? ' (' + def.key + ')' : ''}" aria-pressed="false">${ic(def.icon)}<span>${def.label}</span></button>`
  }
  return s
}

// 道具の設定のまとまり。data-options-page が下のタブのページ。
export function tool_pop(): string {
  return `
  <div class="pbk" id="blk_shape" data-options-page="shape">
    <div class="opt_head"><b>かたち</b></div>
    <div class="acts" id="shape_choices">${shape_pop()}</div>
    <div id="shape_marks">
      <div class="opt_head"><b>マイマーク</b><button class="pbtn" id="shape_mark_manage" title="マイマークの登録・削除">${ic('plus')}とうろく</button></div>
      <div class="mkgrid" id="shape_mark_grid" title="長押しで削除"></div>
    </div>
  </div>
  <div class="pbk" id="blk_brush" data-options-page="brush">
    <div class="plab">ペンのしゅるい</div>
    <div class="brushgrid" id="normal_pen_grid">${brush_pop()}</div>
    ${native_pen_html()}
  </div>
  <div class="pbk" id="blk_native_eraser" data-options-page="size">${native_eraser_html()}</div>
  <div class="pbk" id="blk_native_paint" data-options-page="pattern">${native_paint_html()}</div>
  <div class="pbk" id="blk_size" data-options-page="size">
    <div class="plab">ふとさ</div>
    <div class="szrow" id="size_row">${size_buttons(sizes)}</div>
    <div class="prow" id="size_free"><input type="range" id="size_range" min="${size_min}" max="${size_max}" step="1"><input type="number" class="numin" id="size_num" min="${size_min}" max="${size_max}" step="1"><span class="plab">px</span></div>
  </div>
  <div class="pbk" id="blk_pat" data-options-page="pattern">
    <div class="plab">もよう</div>
    <div class="seg" id="paint_mode"><button id="paint_normal" aria-pressed="false">ふつうのペイント</button><button id="paint_over" aria-pressed="false">うわがきペイント</button></div>
    <div class="patgrid">${pat_pop()}</div>
  </div>
  <div class="pbk" id="blk_stroke" data-options-page="detail">
    <div class="opt_row"><label class="plab" for="opt_smooth">手ぶれ補正</label><input type="range" id="opt_smooth" min="0" max="4" step="1"><output id="opt_smooth_val">2</output></div>
    ${switch_row('opt_pressure', 'pen', '筆圧で太さ')}
  </div>
  <div class="pbk" id="blk_sym" data-options-page="detail">
    ${switch_row('opt_sym_x', 'fliph', '左右対称')}
    ${switch_row('opt_sym_y', 'flipv', '上下対称')}
  </div>
  <div class="pbk" id="blk_alpha" data-options-page="detail">
    <div class="opt_row"><label class="plab" id="opt_alpha_label" for="opt_alpha">不透明度</label><input type="range" id="opt_alpha" min="10" max="100" step="5"><output id="opt_alpha_val">100</output></div>
  </div>
  <div class="pbk" id="blk_outline" data-options-page="detail">
    ${switch_row('opt_outline', 'outline', 'フチドリ')}
    <div class="opt_row"><label class="plab" for="opt_o_width">フチの太さ</label><input type="range" id="opt_o_width" min="1" max="12" step="1"><output id="opt_o_width_val">3</output><input type="color" id="opt_o_color" value="#FFFFFF" title="フチの色"></div>
  </div>
  <div class="pbk" id="blk_fill" data-options-page="detail">${switch_row('opt_fill', 'fill', '中を塗りつぶす')}</div>
  <div class="pbk" id="blk_fill_tool" data-options-page="detail">${switch_row('opt_fill_all', 'fill', 'はなれた同じ色もぜんぶ')}</div>
  <div class="pbk" id="blk_pxn" data-options-page="grid">
    <div class="opt_head"><b>ドットの粗さ</b><output id="pixel_size_val"></output></div>
    <div class="seg" id="pixel_choices"><button data-pixel-count="8">8マス</button><button data-pixel-count="16">16マス</button><button data-pixel-count="32">32マス</button><button data-pixel-count="64">64マス</button></div>
    <div class="opt_row"><label class="plab" for="pxn_range">横のマス数</label><input type="range" id="pxn_range" min="${pxn_min}" max="${pxn_max}" step="1"><input type="number" class="numin" id="pxn_num" min="${pxn_min}" max="${pxn_max}" step="1"></div>
  </div>`
}

export function color_pop(): string {
  return `
  <div class="ink_sample"><span id="color_preview" aria-hidden="true"></span><div><b>いまのいろ</b><span id="color_preview_label"></span></div></div>
  <section class="opt">
    <div class="seg" id="pal_tabs"><button id="pal_tab_0" aria-pressed="false">スタンダード</button><button id="pal_tab_1" aria-pressed="false">DSi</button><button id="pal_tab_2" aria-pressed="false">3DS</button></div>
    <div class="palgrid" id="pal_grid"></div>
  </section>
  <section class="opt" id="custom_color_options">
    <div class="opt_head"><b>じぶんの色</b></div>
    <div class="palgrid" id="cust_grid" title="長押しで削除"></div>
    <div class="opt_row"><input type="color" id="pick_in" title="いろをえらぶ"><input type="text" class="mtxt" id="hex_in" maxlength="7" placeholder="#RRGGBB"><button class="pbtn" id="cust_add" title="いまの色をとうろく">${ic('plus')}とうろく</button></div>
  </section>
  <section class="opt"><button class="link_row" id="paper_color_btn">${ic('note')}<span>紙のいろ</span><span id="paper_chip" aria-hidden="true"></span>${ic('next')}</button></section>`
}

// レイヤーのパネル。レイヤーの一覧と操作、写真レイヤーの2ページ。
export function layer_pop(): string {
  return sheet_html({
    icon: 'layers',
    title: 'レイヤー',
    pages: [
      {
        id: 'layers',
        icon: 'layers',
        label: 'レイヤー',
        body: `<section class="opt" id="penbox_row">
          <div class="opt_head"><b>ふでばこ</b></div>
          <div class="seg"><button id="penbox_normal" aria-pressed="false">普通・1枚の紙</button><button id="penbox_advanced" aria-pressed="false">上級・3枚</button></div>
        </section>
        <section class="opt">
          <div id="layer_rows"></div>
          <div class="acts" id="layer_edit">${action_tile('ladd_btn', 'plus', 'レイヤー追加')}${action_tile('ldel_btn', 'trash', 'レイヤー削除')}</div>
        </section>
        <section class="opt">
          <div class="opt_head"><b>いまのレイヤー</b></div>
          <div class="acts">${action_tile('merge_btn', 'mergedown', '下と結合')}${action_tile('lclear_btn', 'trash', '消去')}${action_tile('lcopy_btn', 'dup', 'コピー先…')}</div>
        </section>`,
      },
      {
        id: 'photo',
        icon: 'image',
        label: '写真',
        body: `<section class="opt">
          <div class="opt_head"><b>写真レイヤー</b></div>
          <div class="acts">${action_tile('photo_layer_btn', 'image', '画像を追加')}${action_tile('photo_draft_btn', 'eye', '下書き35%')}${action_tile('photo_clear_btn', 'trash', '写真を消去')}</div>
        </section>`,
      },
    ],
  })
}

// 道具の設定と色の画面。設定の右上の「色」で色の画面へ、色の画面の「設定」で設定へもどる。
export function drawing_html(): string {
  return `<aside id="drawing_bay" aria-label="描くためのどうぐ">
    <nav id="rail" role="dialog" aria-label="道具箱">${rail()}</nav>
    <div class="pop drawing_bench sheet" id="pop_tool">
      <div class="pop_head">
        <div class="tool_heading"><b>${ic('pen')}<span id="tool_settings_name">ペンの設定</span></b></div>
        <button class="pop_color_jump" id="tool_color_btn" title="この道具の色をえらぶ" aria-haspopup="dialog" aria-controls="pop_color"><span class="chip" id="tool_color_chip"></span><span>色</span></button>
        ${close_html()}
      </div>
      <div class="stroke_sample">
        <div class="sample_caption"><b id="stroke_name"></b><span id="stroke_size"></span></div>
        <canvas id="stroke_preview" width="640" height="100" aria-label="選んだペンの線の見本"></canvas>
      </div>
      <div class="pop_body" id="tool_options">${tool_pop()}</div>
      <div class="tool_page_tabs" aria-label="道具設定の中を移動">
        <button data-tool-page="shape">${ic('rect')}かたち</button>
        <button data-tool-page="brush">${ic('pen')}ペン</button>
        <button data-tool-page="size">${ic('adjust')}ふとさ</button>
        <button data-tool-page="grid">${ic('pixel')}ドット</button>
        <button data-tool-page="pattern">${ic('paint')}もよう</button>
        <button data-tool-page="detail">${ic('gear')}<span id="tool_detail_name">線・効果</span></button>
      </div>
    </div>
    <div class="pop drawing_bench sheet" id="pop_color">
      <div class="pop_head">
        <button class="pop_back" id="color_back" title="道具の設定にもどる" hidden>${ic('prev')}<span>設定</span></button>
        <b>${ic('fill')}いろ</b>
        ${close_html()}
      </div>
      <div class="pop_body">${color_pop()}</div>
    </div>
  </aside>`
}
