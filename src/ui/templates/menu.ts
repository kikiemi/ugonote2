import { ic } from '../../dom'
import { aspects, resos, se_presets, se_labels } from '../../h'
import { menu_action, switch_row } from './parts'

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
    ${is_se ? `<div class="opt_row"><label class="plab" for="spre_${kind}">見本の音</label><select id="spre_${kind}"><option value="">えらぶ</option>${presets}</select></div><button class="link_row" id="sassign_${kind}" title="鳴らすコマを選ぶ">${ic('film')}<span>鳴らすコマ</span>${ic('next')}</button>` : ''}
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
    <div class="page_rule"><span>保存する</span></div>
    <div class="menu_actions">
      ${menu_action('save_file_btn', 'save', 'この作品を保存', 'あとで続きが描けるノートファイル', 'featured')}
      ${menu_action('export_btn', 'film', '書き出す', '動画・画像・うごメモのファイル')}
    </div>
    <div class="page_rule"><span>ひらく・つくる</span></div>
    <div class="menu_actions">
      ${menu_action('open_btn', 'folder', 'ファイルを開く', 'ノート・うごメモ (PPM・KWZ)・動画')}
      ${menu_action('slots_btn', 'save', 'この端末の作品', '保存スロットから選ぶ')}
      ${menu_action('new_btn', 'plus', '新しくつくる', 'まっさらなノートから')}
    </div>
    <div class="page_rule"><span>いまのノートにとりこむ</span></div>
    <div class="menu_actions">
      ${menu_action('photo_btn', 'image', '画像・写真', 'コマに使う画像を選ぶ')}
      ${menu_action('zip_in_btn', 'file', '連番画像のZIP', 'まとめたPNGをコマとして読みこむ')}
    </div>
  </section>
  <section class="menu_page" data-menu-group="sound">
    <div class="menu_actions">${menu_action('mixer_btn', 'note', '音を鳴らすコマ', 'コマの絵を見ながら効果音をつける', 'featured')}</div>
    <div class="page_rule"><span>曲</span></div>
    <div class="sound_tracks">${snd_slot_row('bgm0', '曲 1', 0)}${snd_slot_row('bgm1', '曲 2', 0)}</div>
    <div class="page_rule"><span>効果音</span></div>
    <div class="sound_tracks">${sounds}</div>
    <div class="page_rule"><span>音量と録音</span></div>
    <div class="volume_controls"><label><span>曲の音量</span><input type="range" id="bgm_vol" min="0" max="100" step="5"></label><label><span>効果音の音量</span><input type="range" id="se_vol" min="0" max="100" step="5"></label></div>
    <div class="menu_actions">${menu_action('sync_rec_btn', 'record', '再生に合わせて録音', '作品を動かしながら声を入れる')}</div>
  </section>
  <section class="menu_page" data-menu-group="canvas">
    <div class="page_rule"><span>紙のかたちと大きさ</span><output id="size_now"></output></div>
    <section class="opt" id="canvas_size_row">
      <div class="opt_row"><label class="plab" for="ratio_sel">かたち</label><select id="ratio_sel">${ratios}</select></div>
      <div class="opt_row"><label class="plab" for="reso_sel">大きさ</label><select id="reso_sel">${resolutions}</select></div>
      <div class="opt_row"><button class="pbtn" id="size_apply">この大きさにする</button></div>
    </section>
    <div class="page_rule"><span>紙の色</span></div>
    <section class="opt">
      <div class="paper_choices" id="paper_sw"></div>
      <div class="opt_row" id="paper_canvas_custom"><label class="plab" for="paper_in">じぶんの色</label><input type="color" id="paper_in"></div>
    </section>
    <div class="menu_actions">${menu_action('free_new_btn', 'fit', '画面全体で新しく描く', '画面の大きさの紙で、新しいノートをつくる')}</div>
  </section>
  <section class="menu_page" data-menu-group="project">
    <div class="page_rule"><span>作品のなまえ</span></div>
    <section class="opt"><input id="menu_title" class="note_name_input" data-user-text maxlength="40" autocomplete="off" spellcheck="false" aria-label="作品のなまえ"></section>
    <div class="page_rule"><span>紙・モード・作者</span></div>
    <div class="menu_actions"><button class="menu_action" data-menu-group="canvas"><span class="action_glyph">${ic('grid')}</span><span class="action_copy"><b>紙をえらぶ</b><small>紙のかたち・大きさ・色</small></span></button><button class="menu_action" id="project_mode"><span class="action_glyph">${ic('swap')}</span><span class="action_copy"><b>描画モード</b><small id="project_mode_name">ノーマル</small></span></button>${menu_action('project_meta', 'file', '作者・作品の情報', 'うごメモに書きこむ名前とID')}</div>
  </section>
  <section class="menu_page" data-menu-group="settings">
    <div class="page_rule"><span>画面と音</span></div>
    <section class="opt">
      ${switch_row('theme_btn', 'moon', '暗い画面で描く')}
      ${switch_row('uisfx_tgl', 'sound', 'ボタンの音')}
      ${switch_row('hide_controls_btn', 'eye', '描画中にメニューを隠す')}
    </section>
    <div class="page_rule"><span>ことば / Language</span></div>
    <section class="opt">
      <select id="set_lang" class="msel"><option value="">じどう / Auto</option><option value="ja">日本語</option><option value="en">English</option></select>
    </section>

  </section>`
}

