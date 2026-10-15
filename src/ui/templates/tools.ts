import { ic } from '../../dom'
import { t_line, t_text, pat_table, sizes, brush_defs, size_min, size_max, pxn_min, pxn_max } from '../../h'

import { pat_custom } from '../../paint'
import { tool_defs } from '../tool_defs'
import { tool_has_options } from '../tool_options'
import { native_pen_html } from '../pen_palette'
import { convenience_html } from './features'
import { toolbox_settings_html } from './toolbox'

const rail_sep_before = new Map<number, string>([[t_line, 'かたち'], [t_text, 'えらぶ・うごかす']])


export function rail(): string {
  let s = '<i class="rsep" aria-hidden="true">かく</i>'
  for (const d of tool_defs) {
    const sec = rail_sep_before.get(d.t)
    if (sec !== undefined) s += `<i class="rsep" aria-hidden="true">${sec}</i>`
    const options = tool_has_options(d.t)
    const hint = options ? '・選択中にもう一度押すと設定' : ''
    s += `<button class="rb${options ? ' hasopts' : ''}" id="tl_${d.t}" data-t="${d.t}" title="${d.label}${d.key ? ' (' + d.key + ')' : ''}${hint}"${options ? ' aria-haspopup="dialog"' : ''}>${ic(d.icon)}<i class="rlbl">${d.label}</i></button>`
  }
  s += `<button class="rb" id="tf_btn" title="うごかす（スライド・かいてん・かくだい）">${ic('zoomin')}<i class="rlbl">うごかす</i></button>`
  return `<div class="toolbox_head"><div class="tool_heading"><b>${ic('tools')}道具箱</b><small>描く道具・絵の変形・表示・便利機能</small></div><button id="toolbox_close" class="popx" title="編集パネルを閉じる">${ic('check')}<span>とじる</span></button></div><div class="toolbox_body">
    <section class="toolbox_page" data-toolbox-panel="features" hidden>${convenience_html()}</section>
    <section class="toolbox_page" data-toolbox-panel="transform" hidden>${toolbox_settings_html('transform')}</section>
    <section class="toolbox_page" data-toolbox-panel="view" hidden>${toolbox_settings_html('view')}</section>
    <section class="toolbox_page" data-toolbox-panel="tools"><p class="phint">道具を選んで描きます。種類・太さ・模様は「道具設定」から。</p><div class="rtools" id="rail_tools">${s}</div><div class="toolbox_actions">
      <button class="rb rswatch" id="color_btn" title="いろ"><span class="chip" id="color_chip"></span><i class="rlbl">いろ</i></button>
      <button class="rb" id="tool_settings_btn" title="選んだ道具の設定" aria-haspopup="dialog" aria-controls="pop_tool" aria-expanded="false">${ic('gear')}<i class="rlbl">道具設定</i></button>
      <button class="rb" id="mark_btn" title="マーク(スタンプ)">${ic('mark')}<i class="rlbl">マーク</i></button>
    </div></section></div><nav class="tool_page_tabs toolbox_tabs" aria-label="編集パネルの項目"><button data-toolbox-page="tools" aria-pressed="true">${ic('pen')}描く道具</button><button data-toolbox-page="transform" aria-pressed="false">${ic('rotr')}絵の変形</button><button data-toolbox-page="view" aria-pressed="false">${ic('eye')}表示</button><button data-toolbox-page="features" aria-pressed="false">${ic('spark')}便利機能</button></nav>`
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

function size_pop(): string {
  let s = ''
  for (const v of sizes) s += `<button class="szb" id="sz_${v}" data-sz="${v}" title="太さ ${v}"><span class="size_ink"><span class="dot" style="width:${Math.min(26, Math.max(4, v))}px;height:${Math.min(26, Math.max(4, v))}px"></span></span><small>${v}</small></button>`
  return s
}

function pat_pop(): string {
  let s = ''
  for (let i = 0; i < pat_table.length; i++) s += `<button class="patb" id="pat_${i}" data-pat="${i}" title="${pat_table[i].label}"><canvas width="28" height="28" data-patprev="${i}"></canvas><small>${pat_table[i].label}</small></button>`
  s += `<button class="patb custom_paint" id="pat_${pat_custom}" data-pat="${pat_custom}" title="登録したペイント" aria-label="ペイントの登録枠「？」">${ic('paintcustom')}<canvas width="28" height="28" id="custom_paint_preview" hidden></canvas><span class="paint_badge">?</span><small>登録</small></button>`
  return s
}

export function tool_pop(): string {
  return `
  <div class="pbk" id="blk_brush" data-options-page="brush"><div class="plab">ペンのしゅるい</div><div class="brushgrid" id="normal_pen_grid">${brush_pop()}</div>${native_pen_html()}</div>
  <div class="pbk" id="blk_size" data-options-page="size"><div class="plab">ふとさ</div><div class="szrow">${size_pop()}</div>
    <div class="prow"><input type="range" id="size_range" min="${size_min}" max="${size_max}" step="1"><input type="number" class="numin" id="size_num" min="${size_min}" max="${size_max}" step="1"><span class="plab">px</span></div>
  </div>
  <div class="pbk" id="blk_pat" data-options-page="pattern"><div class="plab">もよう</div><div id="paint_mode"><div class="paint_modes"><button class="tgl" id="paint_normal">${ic('paint')}<span>ふつうのペイント</span></button><button class="tgl" id="paint_over">${ic('layers')}うわがきペイント</button></div><div class="phint" id="paint_mode_hint"></div></div><div class="patgrid">${pat_pop()}</div><div class="phint" id="paint_tile_hint">範囲・なげなわで選んだ絵を「？」に登録できます</div></div>
  <div class="pbk" id="blk_stroke" data-options-page="detail">
    <div class="prow"><span class="plab">手ぶれ補正</span><input type="range" id="opt_smooth" min="0" max="4" step="1"><b id="opt_smooth_val">2</b></div>
    <div class="prow"><button class="tgl" id="opt_pressure">${ic('pen')}筆圧で太さ</button></div>
  </div>
  <div class="pbk" id="blk_sym" data-options-page="detail">
    <div class="prow tgl3">
      <button class="tgl" id="opt_sym_x">${ic('fliph')}左右対称</button>
      <button class="tgl" id="opt_sym_y">${ic('flipv')}上下対称</button>
    </div>
  </div>
  <div class="pbk" id="blk_alpha" data-options-page="detail"><div class="prow"><span class="plab">不透明度</span><input type="range" id="opt_alpha" min="10" max="100" step="5"><b id="opt_alpha_val">100</b></div></div>
  <div class="pbk" id="blk_outline" data-options-page="detail">
    <div class="prow"><button class="tgl" id="opt_outline">フチドリ</button><input type="color" id="opt_o_color" value="#FFFFFF" title="フチの色"><input type="range" id="opt_o_width" min="1" max="12" step="1"><b id="opt_o_width_val">3</b></div>
  </div>
  <div class="pbk" id="blk_fill" data-options-page="detail"><button class="tgl" id="opt_fill">中を塗りつぶす</button></div>
  <div class="pbk" id="blk_fill_tool" data-options-page="detail">
    <button class="tgl" id="opt_fill_all">${ic('fill')}はなれた同じ色もぜんぶ</button>
    <div class="phint">オンにすると、タップした色とおなじ色をレイヤー全体でまとめて塗りかえます</div>
  </div>
  <div class="pbk" id="blk_pxn" data-options-page="grid"><div class="adjust_heading"><b>ドットの粗さ</b><span id="pixel_size_val"></span></div><div class="adjust_choices" id="pixel_choices"><button data-pixel-count="8">8マス</button><button data-pixel-count="16">16マス</button><button data-pixel-count="32">32マス</button><button data-pixel-count="64">64マス</button></div><div class="adjust_scale"><span>粗い</span><span>細かい</span></div><div class="prow"><label class="plab" for="pxn_range">横のマス数</label><input type="range" id="pxn_range" min="${pxn_min}" max="${pxn_max}" step="1"><input type="number" class="numin" id="pxn_num" min="${pxn_min}" max="${pxn_max}" step="1"><span class="plab">マス</span></div><button class="pbtn" id="adjust_pixel">${ic('pixel')}ドットで描く</button></div>
  <div class="pbk" id="blk_sel" data-options-page="detail">
    <div class="prow tgl3">
      <button class="pbtn" id="sel_copy">${ic('dup')}コピー</button>
      <button class="pbtn" id="sel_cut">${ic('select')}切り取り</button>
      <button class="pbtn" id="sel_del">${ic('trash')}削除</button>
      <button class="pbtn" id="sel_invert">${ic('invert')}色反転</button>
      <button class="tgl" id="sel_paint_mode" aria-pressed="false">${ic('layers')}<span>ふつうのペイント</span></button>
      <button class="pbtn" id="sel_paint">${ic('fill')}ぬる</button>
      <button class="pbtn" id="sel_register_paint">${ic('paintcustom')}ペイントに登録</button>
    </div>
    <div class="phint">はんいの中をドラッグすると動かせます（回転・拡大も）</div>
  </div>
  <div class="pbk" id="blk_paste" data-options-page="detail"><div class="phint">キャンバスをタップして位置を決め、✓で確定</div></div>`
}

export function color_pop(): string {
  return `
  <div class="ink_sample"><span id="color_preview" aria-hidden="true"></span><div><b>いまのいろ</b><span id="color_preview_label"></span></div></div>
  <div class="paltabs">
    <button class="ptab" id="pal_tab_0">スタンダード</button>
    <button class="ptab" id="pal_tab_1">DSi</button>
    <button class="ptab" id="pal_tab_2">3DS</button>
  </div>
  <div class="palgrid" id="pal_grid"></div>
  <button class="pbtn paper_shortcut" id="paper_color_btn">${ic('note')}<span>紙のいろ</span><span id="paper_chip" aria-hidden="true"></span></button>
  <div id="custom_color_options"><div class="plab">じぶんの色 <span class="phint">(いまの色を＋でとうろく／長押しで削除)</span></div>
  <div class="palgrid" id="cust_grid"></div>
  <div class="prow"><input type="color" id="pick_in" title="いろをえらぶ"><input type="text" id="hex_in" maxlength="7" placeholder="#RRGGBB"><button class="pbtn" id="cust_add">＋とうろく</button></div></div>`
}

export function layer_pop(): string {
  return `<p class="phint">文字を押すと描くレイヤーを選べます。目のボタンで表示を切り替えます。</p><div id="layer_rows"></div>
  <div class="photo_tools">
    <div class="photo_tools_head">${ic('image')}<span><b>写真レイヤー</b><small>参考画像や下書きを置く</small></span></div>
    <div class="prow tgl3">
      <button class="pbtn primary" id="photo_layer_btn" title="画像を写真レイヤーへ追加">${ic('image')}画像を追加</button>
      <button class="pbtn" id="photo_draft_btn" title="写真レイヤーを下書き表示にする">${ic('eye')}<span>下書き35%</span></button>
      <button class="pbtn warn" id="photo_clear_btn" title="いまのコマの写真を消去">${ic('trash')}写真を消去</button>
    </div>
  </div>
  <div class="prow tgl3">
    <button class="pbtn" id="merge_btn" title="いまのレイヤーを下と結合">${ic('mergedown')}下と結合</button>
    <button class="pbtn" id="lclear_btn" title="いまのレイヤーを消去">${ic('trash')}消去</button>
    <button class="pbtn" id="lcopy_btn" title="いまのレイヤーを他へコピー">${ic('dup')}コピー先…</button>
  </div>
  <div class="prow tgl3">
    <button class="pbtn" id="ladd_btn" title="ノーマルモードでレイヤーを追加">${ic('plus')}追加</button>
    <button class="pbtn" id="ldel_btn" title="追加したレイヤーを削除">${ic('trash')}レイヤー削除</button>
  </div>
`
}


export function drawing_html(): string {
  return `<aside id="drawing_bay" aria-label="描くためのどうぐ"><nav id="rail" role="dialog" aria-label="道具箱">${rail()}</nav><div class="pop drawing_bench" id="pop_tool"><div class="pop_head"><div class="tool_heading"><b>${ic('pen')}<span id="tool_settings_name">ペンの設定</span></b><small id="tool_help"></small></div><button class="popx" title="描く画面にもどる">${ic('check')}<span>とじる</span></button></div><div class="stroke_sample"><div class="sample_caption"><b id="stroke_name"></b><span id="stroke_size"></span></div><canvas id="stroke_preview" width="640" height="100" aria-label="選んだペンの線の見本"></canvas></div><div class="pop_body" id="tool_options">${tool_pop()}</div><div class="tool_page_tabs" aria-label="道具設定の中を移動"><button data-tool-page="brush">${ic('pen')}ペン</button><button data-tool-page="size">${ic('adjust')}ふとさ</button><button data-tool-page="grid">${ic('pixel')}ドット</button><button data-tool-page="pattern">${ic('paint')}もよう</button><button data-tool-page="detail">${ic('gear')}<span id="tool_detail_name">線・効果</span></button></div></div>
        <div class="pop drawing_bench" id="pop_color"><div class="pop_head"><b>${ic('fill')}いろ</b><button class="popx" title="描く画面にもどる">${ic('check')}<span>とじる</span></button></div><div class="pop_body">${color_pop()}</div></div></aside>`
}
