import { close_html, ic } from '../../dom'
import { drawer } from './menu'

export function home_html(): string {
  return `<div id="drawer"><div id="drawer_head"><button id="menu_home_back" class="hbtn" title="メニューのホーム">${ic('prev')}<span>メニュー</span></button><div class="menu_location"><b id="menu_heading">ノートのメニュー</b></div>${close_html('とじる', ' id="drawer_close"')}</div>
<div id="menu_home">
  <div class="menu_notebook">
    <div class="note_album"><button id="menu_resume" class="note_preview" title="つづきをかく"><canvas id="note_preview_cv" width="480" height="270" aria-label="今の作品"></canvas></button><button id="menu_preview_play" title="作品を再生" aria-pressed="false">${ic('play')}</button></div>
    <div class="note_caption"><b id="note_preview_name" data-user-text></b><small id="note_preview_meta"></small></div>
    <div class="work_library"><button id="menu_open">${ic('folder')}ファイルを開く</button><button id="menu_new">${ic('plus')}新しい作品</button></div>
  </div>
  <div class="menu_choices" aria-label="作品のメニュー">
    <button class="menu_choice" id="menu_draw"><svg class="menu_art" viewBox="0 0 180 120" fill="none" stroke="var(--acc)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="rotate(-8 90 58)"><rect x="36" y="14" width="106" height="90" rx="5" fill="#e8eaf2" stroke="none" transform="translate(4 4)"/><rect x="36" y="14" width="106" height="90" rx="5" fill="var(--bg2)" stroke="var(--line2)" stroke-width="2"/><path d="M63 79c-11-20 3-33 16-29 4-16 27-14 27 2 22-2 23 21 8 26-12 5-40 9-51 1z" fill="#91d6c4" stroke="#46516b" stroke-width="2.5"/><path d="M78 62v4m18-4v4m-15 6q7 8 13 0" stroke="#46516b"/><path d="m120 89 16-11 3 4-16 11-7 2z" fill="var(--acc_soft)" stroke="var(--acc)"/><path d="m123 89 3 4"/></g></svg><span><b>つづきをかく</b></span></button>
    <button class="menu_choice" id="menu_frames"><svg class="menu_art" viewBox="0 0 180 120" fill="none" stroke="var(--acc)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="rotate(4 90 58)"><rect x="9" y="23" width="162" height="78" rx="2" fill="#30323d" stroke="#30323d"/><path d="M15 29h150M15 94h150" stroke="#fff" stroke-width="5" stroke-dasharray="5 4"/><path d="M17 36h42v50H17zM68 36h42v50H68zM120 36h42v50h-42z" fill="#fff" stroke="none"/><g stroke="#46516b" stroke-width="2"><circle cx="38" cy="57" r="10" fill="#91d6c4"/><path d="m32 55 4-5 4 5m-7 14 5-2 7 10"/><circle cx="89" cy="62" r="10" fill="#91d6c4"/><path d="m83 60 4-5 4 5m-7 13 5-2 7 4"/><circle cx="141" cy="53" r="10" fill="#91d6c4"/><path d="m135 51 4-5 4 5m-7 14 5-2 7 12"/></g></g></svg><span><b>コマをならべる</b></span></button>
    <button class="menu_choice" data-menu-group="sound"><svg class="menu_art" viewBox="0 0 180 120" fill="none" stroke="var(--acc)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="rotate(-4 90 58)"><rect x="24" y="20" width="131" height="81" rx="15" fill="#e8eaf2" stroke="none" transform="translate(2 3)"/><rect x="24" y="20" width="131" height="81" rx="15" fill="var(--bg2)" stroke="var(--line2)" stroke-width="2"/><path d="M66 51v14M77 41v33M89 35v47M101 42v32M112 50v16" stroke-width="5"/><path d="M48 58v10m0-10 9 3" stroke-width="2"/><circle cx="45" cy="69" r="3" fill="none" stroke-width="2"/></g></svg><span><span class="menu_choice_copy"><b>音をつける</b><small>メニューをひらく</small></span>${ic('next')}</span></button>
    <button class="menu_choice" data-menu-group="files"><svg class="menu_art" viewBox="0 0 180 120" fill="none" stroke="var(--acc)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="rotate(7 90 58)"><path d="M58 14h64q7 0 7 7v81H58q-9 0-9-9V24q0-10 9-10z" fill="#ffd4a7" stroke="var(--acc)" stroke-width="2"/><path d="M58 17h63q5 0 5 5v75H61q-8 0-8-8V22q0-5 5-5z" fill="var(--acc_soft)" stroke="#fff" stroke-width="3"/><path d="M59 85h57" stroke="#fff" stroke-width="2"/><path d="M86 44h10l4 4v13H85V44zm3 0v7h7v-7m-7 17v-7h7v7" stroke-width="2"/><path d="M57 20v62" stroke="#ffae71" stroke-width="3"/></g></svg><span><span class="menu_choice_copy"><b>ほぞん・ひらく</b><small>メニューをひらく</small></span>${ic('next')}</span></button>
  </div>
  <nav class="menu_home_foot" aria-label="作品の道具">
    <button data-menu-group="imports">${ic('image')}<span>とりこむ</span>${ic('next')}</button>
    <button data-menu-group="canvas">${ic('grid')}<span>紙をえらぶ</span>${ic('next')}</button>
    <button data-menu-group="frames">${ic('film')}<span>コマの操作</span>${ic('next')}</button>
    <button id="menu_details">${ic('file')}<span>さくひん設定</span>${ic('next')}</button>
    <button id="mode_btn">${ic('swap')}<span>描画モード<small id="mode_name">ノーマル</small></span>${ic('next')}</button>
    <button data-menu-group="settings">${ic('gear')}<span>せってい</span>${ic('next')}</button>
    <button id="menu_help">${ic('help')}<span>使い方</span></button>
  </nav>
</div><div id="drawer_body">${drawer()}</div></div>
`
}
