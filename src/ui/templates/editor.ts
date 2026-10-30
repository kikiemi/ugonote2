import { lang } from '../../lang'
import { ic } from '../../dom'
import { tool_def } from '../tool_defs'
import { tool_has_options } from '../tool_options'
import { mode_normal, t_pen, t_patbrush, t_eraser, t_fill, t_hand, t_eyedrop, t_pixel, t_text, t_select, t_lasso, t_line } from '../../h'
import { pen_quick_html } from '../pen_palette'
import { drawing_html } from './tools'

type dock_opts_t = { cls?: string, attrs?: string, popup?: string, hidden?: number }

// 右メニューのボタン。popup はそのボタンで開く画面 (開く画面があるボタンには ▾ が付く)。
// 5文字以上の名前は、ボタンの幅に収まるよう文字を小さくする。
function dock_button(id: string, icon: string, label: string, title: string, o: dock_opts_t = {}): string {
  const cls = o.cls ? 'dkb ' + o.cls : 'dkb'
  const popup = o.popup ? ` aria-haspopup="dialog" aria-controls="${o.popup}" aria-expanded="false"` : ''
  const long = [...label].length >= 5 ? ' class="long"' : ''
  return `<button class="${cls}" id="${id}" title="${title}"${o.attrs || ''}${popup}${o.hidden ? ' hidden' : ''}>${icon}<i${long}>${label}</i></button>`
}

// 道具のボタン。wide_tool は広い画面だけに出す道具。
function dock_tool(tool: number, cls = 'wide_tool'): string {
  const def = tool_def(tool)!
  const title = def.label + (def.key ? ' (' + def.key + ')' : '')
  return dock_button('dock_tool_' + tool, ic(def.icon), def.label, title, { cls, attrs: ` data-dock-tool="${tool}" aria-pressed="false"`, popup: tool_has_options(tool) ? 'pop_tool' : '' })
}

// 右メニューの見出し。広い画面だけに出して、用途ごとに区切る。
function dock_heading(label: string): string {
  return `<i class="dock_heading wide_tool" aria-hidden="true">${label}</i>`
}

function dock_html(): string {
  return [
    dock_heading('かく'),
    dock_tool(t_pen, ''),
    dock_tool(t_patbrush, ''),
    dock_tool(t_eraser, ''),
    dock_tool(t_fill, ''),
    dock_button('dock_shape', ic('line'), '図形', '図形', { cls: 'wide_tool', attrs: ` data-dock-shape="${t_line}" aria-pressed="false"`, popup: 'pop_tool' }),
    dock_tool(t_eyedrop),
    dock_tool(t_pixel),
    dock_tool(t_text),
    dock_heading('えらぶ'),
    dock_tool(t_select),
    dock_tool(t_lasso),
    dock_heading('いろ・設定'),
    dock_button('dock_color', '<span class="chip" id="dock_chip"></span>', '色', '色・紙のいろ', { popup: 'pop_color' }),
    dock_button('dock_settings', ic('gear'), '道具設定', '選んだ道具の設定', { popup: 'pop_tool' }),
    dock_heading('表示'),
    dock_tool(t_hand, 'wide_tool move_tool'),
    dock_button('fit_btn', ic('fit'), '全体', '全体表示 (0)'),
    dock_button('dock_grid', ic('grid'), 'マス目', '方眼', { cls: 'wide_tool desktop_tool', popup: 'rail' }),
    dock_button('onion_btn', ic('onion'), '前の絵', '前の絵・透かす枚数', { popup: 'rail' }),
    dock_heading('そのほか'),
    dock_button('dock_more', ic('tools'), '道具箱', '描く道具・絵の変形・表示・便利機能', { popup: 'rail' }),
    dock_button('dock_image', ic('image'), '画像', '画像を写真レイヤーへ追加', { cls: 'wide_tool' }),
  ].join('\n    ')
}

type bar_button_t = [id: string, icon: string, label: string, title: string, cls?: string]

// 範囲・変形のバーのボタン。
function bar_buttons(cls: string, list: bar_button_t[]): string {
  return list.map(([id, icon, label, title, extra]) => `<button class="${extra ? cls + ' ' + extra : cls}" id="${id}" title="${title}">${icon}<i>${label}</i></button>`).join('')
}

// えらんだ範囲の操作バー。
function selection_html(): string {
  return `<div id="sel_bar" role="toolbar" aria-label="えらんだ範囲の操作">
        <div class="sb_group">${bar_buttons('sb', [
          ['sb_t', ic('move'), 'へんけい', '動かす・回転・拡大縮小'],
          ['sb_c', ic('dup'), 'コピー', 'コピー (Ctrl+C)'],
          ['sb_x', ic('cut'), 'きりぬき', '切り取り (Ctrl+X)'],
          ['sb_del', ic('trash'), 'けす', '消す (Delete)'],
        ])}</div>
        <div class="sb_group">${bar_buttons('sb', [
          ['sb_fill', ic('fill'), 'ぬる', '今の色と「ぬる」のもようで塗る'],
          ['sb_paint_mode', ic('overwrite'), 'うわがき', 'うわがきペイント', 'sb_toggle'],
          ['sb_invert', ic('invert'), '色反転', '選択範囲の色を反転'],
        ])}</div>
        <div class="sb_group">${bar_buttons('sb', [
          ['sb_register_paint', ic('paintcustom'), 'もよう登録', 'もようの「？」に登録'],
          ['sb_mark', ic('mark'), 'マーク登録', 'マーク（スタンプ）に登録'],
        ])}</div>
        ${bar_buttons('sb', [['sb_q', ic('close'), '解除', '選択を解除 (Esc)', 'q']])}
      </div>`
}

// 選んだ絵・はりつけた絵を動かしているあいだの操作バー。
function transform_html(): string {
  return `<div id="flo_bar">
        <div id="flo_tools">${bar_buttons('fbb', [
          ['flo_rot_l', ic('rotl'), '左90°', '左に90°'],
          ['flo_rot_r', ic('rotr'), '右90°', '右に90°'],
          ['flo_flip_h', ic('fliph'), '左右', '左右反転'],
          ['flo_flip_v', ic('flipv'), '上下', '上下反転'],
          ['flo_reset', ic('reset'), 'リセット', '変形リセット'],
        ])}<span id="flo_info"></span></div>
        <div id="flo_actions">${bar_buttons('fbb', [
          ['flo_ok', ic('check'), '確定', '確定 (Enter)', 'ok'],
          ['flo_no', ic('close'), '取消', 'キャンセル (Esc)', 'no'],
        ])}</div>
      </div>`
}

export function editor_html(): string {
  return `
  <div id="main_row">
    <div id="stage_wrap"><div id="paper_fit" aria-hidden="true"></div>
      <div id="flip_wrap"><div id="stage_pan">
        <canvas id="stage"></canvas>
        <canvas id="onion_cv"></canvas>
        <canvas id="grid_cv"></canvas>
        <canvas id="ants_cv"></canvas>
        <canvas id="flo_cv"></canvas>
      </div></div>
      <div id="zoom_label"></div>
      ${selection_html()}
      ${transform_html()}
    </div>
    <aside id="layer_stack" aria-label="描くレイヤー"><span class="layer_caption">レイヤー</span><div id="live_layer_tabs" role="group" aria-label="描くレイヤー"></div><button id="layer_btn" class="live_layer" title="レイヤーの設定・追加" aria-label="レイヤーの設定・追加" aria-haspopup="dialog" aria-controls="pop_layer" aria-expanded="false">${ic('layers')}<small>レイヤー</small><b id="layer_tag" hidden></b></button><button id="paste_btn" class="live_layer" title="コピーした絵をはりつけ (Ctrl+V)" aria-label="はりつけ" hidden><canvas class="clip_thumb" width="36" height="22" aria-hidden="true"></canvas><small>はりつけ</small></button></aside>
  </div>
  <header id="hd" aria-label="取り消し・やり直し">
    <button class="hbtn" id="undo_btn" title="もどす・取り消し (Ctrl+Z)" aria-label="もどす・取り消し">${ic('prev')}<span class="hlab">${lang === 'en' ? 'Undo' : 'もどす'}</span></button>
    <button class="hbtn" id="redo_btn" title="すすむ・やり直し (Ctrl+Y)" aria-label="すすむ・やり直し">${ic('next')}<span class="hlab">${lang === 'en' ? 'Redo' : 'すすむ'}</span></button>
    <div hidden><input id="title" maxlength="40" autocomplete="off" spellcheck="false"><span id="mode_badge"></span><b id="app_brand">うごノート</b><span id="save_dot"></span><button id="tut_btn">${ic('help')}</button></div>
  </header>
  <nav id="layout_choices" aria-label="編集画面の表示"><button id="layout_simple" aria-pressed="false">シンプル</button><button id="layout_studio" aria-pressed="false">スタジオ</button></nav>
  <nav id="mobile_tools" aria-label="描くどうぐ"><div id="dock"><div id="dock_row">
    ${dock_html()}
  </div><section id="studio_quick" aria-label="色とふとさ"><div class="studio_label">色</div><div id="quick_colors"></div><div class="studio_label">ふとさ <output id="quick_size_value"></output></div><div id="quick_sizes">${pen_quick_html(mode_normal, t_pen)}</div></section></div></nav>
  ${drawing_html()}
  <div id="tl">
    <div id="frame_panel" aria-label="コマの操作"><div id="frame_operations"><div id="frame_commands">
      <button class="tb" id="dup_btn" title="コマを複製 (D)">${ic('dup')}<b>複製</b></button>
      <button class="tb warn" id="del_btn" title="いまのコマを削除">${ic('trash')}<b>消す</b></button>
      <button class="tb" id="tl_more_btn" title="コマ移動・まとめて追加・はやさ・表示時間" aria-haspopup="menu" aria-expanded="false">${ic('dots')}<b>コマ操作</b></button>
    </div><div id="view_commands">
      <button class="tb wide" id="fps_btn" title="はやさ">${ic('clock')}<span class="fps_text"><b id="fps_main">6</b><span id="fps_unit">コマ/秒</span></span><i id="fps_tag"></i></button>
      <button class="tb wide" id="hold_btn" title="このコマの表示時間">${ic('clock')}<b id="hold_label"></b></button>
      <button class="tb" id="loop_btn" title="ループ">${ic('loop')}<span id="loop_state">ループ オン</span></button><button class="tb" id="ab_btn" title="A-B区間ループ">${ic('ab')}<span>区間</span></button>
      <button class="tb" id="view_btn" title="写真・紙・下書き">${ic('onion')}<b>みえかた</b></button>
    </div></div><button class="popx" id="tl_close" title="コマ一覧を閉じる" aria-label="コマ一覧を閉じる">${ic('close')}</button></div>
    <div id="fs"></div>
    <div id="tl_bar">
      <div class="tl_group tl_tail">
        <button class="tb" id="menu_btn" title="メニュー">${ic('menu')}<span>メニュー</span></button>
        <button class="tb" id="tl_toggle" title="コマ一覧を開く">${ic('film')}<b>コマ一覧</b></button>
        <button class="tb" id="add_btn" title="コマを追加 (N)">${ic('plus')}<b>追加</b></button>
      </div>
      <button id="frame_no" title="番号を指定して移動"></button>
      <div class="tl_group tl_transport"><button class="tb" id="home_btn" title="さいしょのコマへ" aria-label="さいしょのコマへ">${ic('first')}</button><button class="tb" id="prev_btn" title="前のコマ">${ic('prev')}</button><button class="tb primary" id="play_btn" title="再生/停止 (Space)">${ic('play')}</button><button class="tb" id="next_btn" title="次のコマ">${ic('next')}</button><button class="tb" id="last_btn" title="さいごのコマへ" aria-label="さいごのコマへ">${ic('last')}</button></div>
    </div>
  </div>
`
}
