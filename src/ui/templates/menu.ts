import { ic } from '../../dom'
import { aspects, resos, se_presets, se_labels } from '../../h'

function menu_action(id: string, icon: string, title: string, hint: string, extra = ''): string {
  return `<button class="menu_action ${extra}" id="${id}"><span class="action_glyph">${ic(icon)}</span><span class="action_copy"><b>${title}</b><small>${hint}</small></span></button>`
}

function snd_slot_row(kind: string, label: string, is_se: number): string {
  let presets = ''
  if (is_se) {
    for (const p of se_presets) presets += `<option value="${p}">${se_labels[p]}</option>`
  }
  return `<div class="sound_slot" id="srow_${kind}">
    <div class="sound_slot_head">${ic(is_se ? 'sound' : 'music')}<b>${label}</b><span class="sndname" data-user-text id="sname_${kind}">--</span></div>
    <div class="sound_buttons">
      <button class="sbtn" id="splay_${kind}" title="ためし聞き" aria-label="ためし聞き">${ic('play')}</button>
      <button class="sbtn" id="sload_${kind}" title="音声ファイルを読み込む">${ic('folder')}<span>とりこむ</span></button>
      <button class="sbtn" id="srec_${kind}" title="マイク録音">${ic('mic')}<span>録音</span></button>
      <button class="sbtn" id="sclr_${kind}" title="この音を消す">${ic('close')}<span>消す</span></button>
    </div>
    ${is_se ? `<label class="sound_preset"><span>音の見本から選ぶ</span><select id="spre_${kind}"><option value="">えらんでね</option>${presets}</select></label><button class="sound_assign_btn" id="sassign_${kind}">${ic('film')}<span>鳴らすコマを選ぶ</span>${ic('next')}</button>` : ''}
  </div>`
}

export function drawer(): string {
  let ratios = '<option value="free" disabled>画面全体</option>'
  for (let i = 0; i < aspects.length; i++) ratios += `<option value="${aspects[i].name}">${aspects[i].name}</option>`
  let resolutions = '<option value="free" disabled>フリーサイズ</option>'
  for (let i = 0; i < resos.length; i++) resolutions += `<option value="${resos[i].id}">${resos[i].label}</option>`
  let sounds = ''
  for (let i = 0; i < 4; i++) sounds += snd_slot_row('se' + i, '音 ' + (i + 1), 1)
  return `
  <section class="menu_page" data-menu-group="files">

    <div class="menu_actions">
      ${menu_action('save_file_btn', 'save', 'この作品を保存', 'あとで編集できるノートファイル', 'featured')}
      ${menu_action('export_btn', 'film', '書き出す', '動画・画像・うごメモのファイル')}
    </div>
    <div class="page_rule"><span>作品をひらく</span></div>
    <div class="menu_actions">
      ${menu_action('open_btn', 'folder', 'ファイルを開く', 'ノート・うごメモ・動画')}
      ${menu_action('video_btn', 'video', '動画を取り込む', '映像をコマに分け、音声も読み込む')}
      ${menu_action('open_flip_btn', 'film', 'うごメモをひらく', 'DSi の PPM・3DS の KWZ')}
      ${menu_action('slots_btn', 'save', 'この端末の作品', '保存スロットを選ぶ')}
      ${menu_action('new_btn', 'plus', '新しくつくる', 'まっさらなノートから')}
    </div>

  </section>
  <section class="menu_page" data-menu-group="imports">

    <div class="menu_actions">
      ${menu_action('photo_btn', 'image', '画像・写真', 'コマに使う画像を選ぶ')}
      ${menu_action('zip_in_btn', 'file', '連番画像のZIP', 'まとめたPNGをコマとして読み込む')}
      ${menu_action('flip_in_btn', 'film', 'うごメモからとりこむ', 'PPM・KWZの絵を今のノートへ')}
    </div>
  </section>
  <section class="menu_page" data-menu-group="sound">
    <div class="menu_actions">${menu_action('mixer_btn', 'note', '音を鳴らすコマ', 'コマの絵を見ながら効果音をつける', 'featured')}</div>

    <div class="sound_tracks">${snd_slot_row('bgm0', '曲 1', 0)}${snd_slot_row('bgm1', '曲 2', 0)}</div>
    <div class="page_rule"><span>効果音</span></div>
    <div class="sound_tracks">${sounds}</div>
    <div class="volume_controls"><label><span>曲の音量</span><input type="range" id="bgm_vol" min="0" max="100" step="5"></label><label><span>効果音の音量</span><input type="range" id="se_vol" min="0" max="100" step="5"></label></div>
    <div class="menu_actions">${menu_action('sync_rec_btn', 'record', '再生に合わせて録音', '作品を動かしながら声を入れる')}</div>
  </section>
  <section class="menu_page" data-menu-group="canvas">

    <button class="pbtn" id="free_new_btn">${ic('fit')}画面全体で新しく描く</button><div class="paper_settings" id="canvas_size_row"><label>紙のかたち<select id="ratio_sel">${ratios}</select></label><label>絵の大きさ<select id="reso_sel">${resolutions}</select></label><button class="pbtn" id="size_apply">この大きさにする</button><span class="phint" id="size_now"></span></div>
    <div class="page_rule"><span>紙の色</span></div>
    <div class="paper_colors"><label id="paper_canvas_custom">じぶんの色<input type="color" id="paper_in"></label><span id="paper_sw"></span><span class="phint">ぜんぶのコマに使います</span></div>

  </section>
  <section class="menu_page" data-menu-group="frames">

    <div class="menu_actions">${menu_action('add_many_btn', 'many', 'コマをまとめて追加', '枚数を決めて追加する')}${menu_action('range_btn', 'ab', 'まとめてコピー・変更', 'A-B区間を決めて操作する')}${menu_action('goto_btn', 'goto', 'コマ番号へとぶ', '見たいコマを指定する')}</div>
  </section>
  <section class="menu_page" data-menu-group="project">
    <label class="note_name_label">作品のなまえ<input id="menu_title" data-user-text maxlength="40" autocomplete="off" spellcheck="false"></label>
    <div class="menu_actions"><button class="menu_action" data-menu-group="canvas"><span class="action_glyph">${ic('grid')}</span><span class="action_copy"><b>紙をえらぶ</b><small>紙のかたち・大きさ・色</small></span></button><button class="menu_action" id="project_mode"><span class="action_glyph">${ic('swap')}</span><span class="action_copy"><b>描画モード</b><small id="project_mode_name">ノーマル</small></span></button></div>
  </section>
  <section class="menu_page" data-menu-group="settings">
    <div class="page_rule"><span>いまの描画モード</span></div>
    <div class="menu_actions settings_mode"><button class="menu_action" id="settings_mode_btn"><span class="action_glyph">${ic('swap')}</span><span class="action_copy"><b id="settings_mode_name">ノーマル</b><small>描画モードを変更する</small></span><span class="menu_choice_arrow" aria-hidden="true">${ic('next')}</span></button></div>
    <div class="page_rule"><span>画面と操作</span></div>
    <div class="settings_lines">
      <button class="setting_toggle" id="theme_btn">${ic('moon')}<span><b>暗い画面で描く</b><small id="theme_state">オフ</small></span><i class="toggle_knob" aria-hidden="true"></i></button>
      <button class="setting_toggle" id="uisfx_tgl">${ic('sound')}<span><b>ボタンの音</b><small id="sound_state">オン</small></span><i class="toggle_knob" aria-hidden="true"></i></button>
      <button class="setting_toggle" id="hide_controls_btn" aria-pressed="true">${ic('eye')}<span><b>描画中にメニューを隠す</b><small id="hide_controls_state">オン</small></span><i class="toggle_knob" aria-hidden="true"></i></button>
    </div><p class="phint">小さい画面のシンプル表示で、絵に重なるメニューを描画中だけ隠します。スタジオ表示と横幅が広い画面では、オンでも表示を保ちます。</p>
    <div class="page_rule"><span>言語</span></div>
    <label class="setting_language"><span>ことば / Language</span><select id="set_lang" class="msel"><option value="">じどう / Auto</option><option value="ja">日本語</option><option value="en">English</option></select></label>
    <div class="menu_actions">${menu_action('tut_btn2', 'help', '使い方を見てみる', '実際の画面でひとつずつ')}</div>

  </section>`
}

