import { lang, tr } from '../../lang'
import { ic } from '../../dom'
import { tool_def } from '../tool_defs'
import { tool_has_options } from '../tool_options'
import { mode_normal, t_pen, t_hand, t_eyedrop, t_pixel, t_text, t_select, t_lasso } from '../../h'
import { pen_quick_html } from '../pen_palette'
import { drawing_html } from './tools'

function dock_tool(tool: number, desktop_only = 0, move_only = 0): string {
  const def = tool_def(tool)!
  const options = !tool_has_options(tool) ? '' : ' aria-haspopup="dialog" aria-controls="pop_tool" aria-expanded="false"'
  return `<button class="dkb wide_tool${desktop_only ? ' desktop_tool' : ''}${move_only ? ' move_tool' : ''}" id="dock_tool_${tool}" data-dock-tool="${tool}" title="${def.label}${def.key ? ' (' + def.key + ')' : ''}" aria-pressed="false"${options}>${ic(def.icon)}<i>${def.label}</i></button>`
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
      <div id="flo_bar">
        <div id="flo_tools">
        <button class="fbb" id="flo_rot_l" title="左に90°">${ic('rotl')}<small>左90°</small></button>
        <button class="fbb" id="flo_rot_r" title="右に90°">${ic('rotr')}<small>右90°</small></button>
        <button class="fbb" id="flo_flip_h" title="左右反転">${ic('fliph')}<small>左右</small></button>
        <button class="fbb" id="flo_flip_v" title="上下反転">${ic('flipv')}<small>上下</small></button>
        <button class="fbb" id="flo_reset" title="変形リセット">${ic('reset')}<small>リセット</small></button>
        <span id="flo_info"></span>
        </div><div id="flo_actions">
        <button class="fbb ok" id="flo_ok" title="確定 (Enter)">${ic('check')}<small>確定</small></button>
        <button class="fbb no" id="flo_no" title="キャンセル (Esc)">${ic('close')}<small>取消</small></button>
        </div>
      </div>
    </div>
    <aside id="layer_stack" aria-label="描くレイヤー"><span class="layer_caption">レイヤー</span><div id="live_layer_tabs" role="group" aria-label="描くレイヤー"></div><button id="layer_btn" class="live_layer" title="レイヤーの設定・追加" aria-label="レイヤーの設定・追加" aria-haspopup="dialog" aria-controls="pop_layer" aria-expanded="false">${ic('layers')}<small>レイヤー</small><b id="layer_tag" hidden></b></button></aside>
  </div>
  <header id="hd" aria-label="取り消し・やり直し">
    <button class="hbtn" id="undo_btn" title="もどす・取り消し (Ctrl+Z)" aria-label="もどす・取り消し">${ic('prev')}<span class="hlab">${lang === 'en' ? 'Undo' : 'もどす'}</span></button>
    <button class="hbtn" id="redo_btn" title="すすむ・やり直し (Ctrl+Y)" aria-label="すすむ・やり直し">${ic('next')}<span class="hlab">${lang === 'en' ? 'Redo' : 'すすむ'}</span></button>
    <div hidden><input id="title" maxlength="40" autocomplete="off" spellcheck="false"><span id="mode_badge"></span><b id="app_brand">うごノート</b><span id="save_dot"></span><button id="tut_btn">${ic('help')}</button></div>
  </header>
  <nav id="layout_choices" aria-label="編集画面の表示"><button id="layout_simple" aria-pressed="false">シンプル</button><button id="layout_studio" aria-pressed="false">スタジオ</button></nav>
  <nav id="mobile_tools" aria-label="描くどうぐ"><div id="dock"><div id="dock_row">
    <button class="dkb main hasopts" id="dock_main" title="ペン・もう一度押すと設定、開いているときは閉じる" aria-haspopup="dialog" aria-controls="pop_tool" aria-expanded="false">${ic('pen')}<i>ペン</i></button>
    <button class="dkb" id="dock_eraser" title="けしごむ (E)" aria-haspopup="dialog" aria-controls="pop_tool" aria-expanded="false">${ic('eraser')}<i>${lang === 'en' ? tr('けしごむ') : '消す'}</i></button>
    <button class="dkb" id="dock_fill" title="ぬりつぶし (G)" aria-haspopup="dialog" aria-controls="pop_tool" aria-expanded="false">${ic('fill')}<i>ぬる</i></button>
    ${dock_tool(t_pixel)}${dock_tool(t_select)}${dock_tool(t_lasso)}${dock_tool(t_eyedrop, 1)}${dock_tool(t_text, 1)}
    <button class="dkb" id="dock_color" title="色" aria-haspopup="dialog" aria-controls="pop_color" aria-expanded="false"><span class="chip" id="dock_chip"></span><i>色</i></button>
    <button class="dkb" id="dock_settings" title="選んだ道具の設定" aria-haspopup="dialog" aria-controls="pop_tool" aria-expanded="false">${ic('gear')}<i>道具設定</i></button>
    <button class="dkb" id="dock_features" title="うごき・エフェクトなどの便利機能" aria-haspopup="dialog" aria-controls="rail" aria-expanded="false">${ic('spark')}<i>便利機能</i></button>
    <button class="dkb" id="dock_more" title="描く道具・回転・拡大縮小・方眼・透かし" aria-haspopup="dialog" aria-controls="rail" aria-expanded="false">${ic('tools')}<i>道具箱</i></button>
    <button class="dkb wide_tool desktop_tool" id="dock_grid" title="方眼とドットの粗さ" aria-haspopup="dialog" aria-controls="rail" aria-expanded="false">${ic('pixel')}<i>マス目</i></button>
    <button class="dkb wide_tool" id="dock_pattern" title="もよう・うわがきペイント" aria-haspopup="dialog" aria-controls="pop_tool" aria-expanded="false">${ic('paint')}<i>もよう</i></button>
    <button class="dkb" id="onion_btn" title="前の絵・透かす枚数を選ぶ" aria-haspopup="dialog" aria-expanded="false" aria-controls="rail">${ic('layers')}<i>前の絵</i></button>
    ${dock_tool(t_hand, 0, 1)}
    <button class="dkb wide_tool desktop_tool" id="dock_paper" title="紙のいろ" aria-haspopup="dialog" aria-controls="pop_paper" aria-expanded="false">${ic('note')}<i>紙</i></button>
    <button class="dkb" id="fit_btn" title="全体表示 (0)">${ic('fit')}<i>全体</i></button>
    <button class="dkb wide_tool" id="dock_image" title="画像を写真レイヤーへ追加">${ic('image')}<i>画像</i></button>
    <button class="dkb" id="dock_paste" title="コピーした絵を貼り付け" hidden>${ic('paste')}<i>はりつけ</i></button>
    <button class="dkb wide_tool desktop_tool" id="dock_focus" title="集中モード">${ic('focus')}<i>集中</i></button>
  </div><section id="studio_quick" aria-label="色とふとさ"><div class="studio_label">色</div><div id="quick_colors"></div><div class="studio_label">ふとさ <output id="quick_size_value"></output></div><div id="quick_sizes">${pen_quick_html(mode_normal,t_pen)}</div></section></div></nav>
  ${drawing_html()}
  <div id="tl">
    <div id="frame_panel" aria-label="コマの操作"><div id="frame_operations"><div id="frame_commands">
      <button class="tb" id="dup_btn" title="コマを複製 (D)">${ic('dup')}<b>コピー</b></button>
      <button class="tb warn" id="del_btn" title="いまのコマを削除">${ic('trash')}<b>消す</b></button>
      <button class="tb" id="tl_more_btn" title="コマ移動・まとめて追加・はやさ・表示時間" aria-haspopup="menu" aria-expanded="false">${ic('dots')}<b>コマ操作</b></button>
    </div><div id="view_commands">
      <button class="tb wide" id="fps_btn" title="はやさ">${ic('clock')}<b id="fps_main">6</b><span id="fps_unit">コマ/秒</span><i id="fps_tag"></i></button>
      <button class="tb wide" id="hold_btn" title="このコマの表示時間">${ic('clock')}<b id="hold_label"></b></button>
      <button class="tb" id="loop_btn" title="ループ">${ic('loop')}<span id="loop_state">ループ オン</span></button><button class="tb" id="ab_btn" title="A-B区間ループ">${ic('ab')}<span>区間</span></button>
      <button class="qb" id="view_btn" title="写真・紙・下書き">${ic('onion')}<i class="qlbl">みえかた</i></button>
    </div></div><button class="tb" id="tl_close" title="コマ一覧を閉じる" aria-label="コマ一覧を閉じる">${ic('close')}<span>とじる</span></button></div>
    <div id="fs"></div>
    <div id="tl_bar">
      <div class="tl_group tl_tail">
        <button class="tb" id="menu_btn" title="メニュー">${ic('menu')}<span>メニュー</span></button>
        <button class="tb" id="tl_toggle" title="コマ一覧を開く">${ic('film')}<b>コマ一覧</b></button>
        <button class="tb" id="add_btn" title="コマを追加 (N)">${ic('plus')}<b>追加</b></button>
      </div>
      <button id="frame_no" title="番号を指定して移動"></button>
      <div class="tl_group tl_transport"><button class="tb" id="home_btn" title="さいしょのコマへ" aria-label="さいしょのコマへ">${ic('skipback')}<span>さいしょ</span></button><button class="tb" id="prev_btn" title="前のコマ">${ic('prev')}</button><button class="tb primary" id="play_btn" title="再生/停止 (Space)">${ic('play')}</button><button class="tb" id="next_btn" title="次のコマ">${ic('next')}</button><button class="tb" id="last_btn" title="さいごのコマへ" aria-label="さいごのコマへ">${ic('last')}<span>さいご</span></button></div>
    </div>
  </div>
`
}

function selection_html(): string {
  return `<div id="sel_bar">
      <button class="sb" id="sb_t">${ic('move')}<i>へんけい</i></button>
      <button class="sb" id="sb_c">${ic('dup')}<i>コピー</i></button>
      <button class="sb" id="sb_p" hidden>${ic('paste')}<i>はりつけ</i></button>
      <button class="sb" id="sb_x">${ic('cut')}<i>きりぬき</i></button>
      <button class="sb" id="sb_paint_mode" aria-pressed="false">${ic('layers')}<i>ふつう</i></button>
      <button class="sb" id="sb_fill" title="選択範囲を今の色ともようで塗る">${ic('fill')}<i>ぬる</i></button>
      <button class="sb" id="sb_invert" title="選択範囲の塗りと透明を入れ替える">${ic('invert')}<i>色反転</i></button>
      <button class="sb" id="sb_register_paint" title="選んだ絵をペイントの「？」に登録">${ic('paintcustom')}<i>ペイント登録</i></button>
      <button class="sb q" id="sb_q">${ic('close')}</button>
    </div>`
}
