import { ic } from '../../dom'
import { ASPECTS, RESOS, SE_PRESETS, SE_LABELS } from '../../h'

function menu_action(id: string, icon: string, title: string, hint: string, extra = ''): string {
  return `<button class="menuAction ${extra}" id="${id}"><span class="actionGlyph">${ic(icon)}</span><span class="actionCopy"><b>${title}</b><small>${hint}</small></span></button>`
}

function snd_slot_row(kind: string, label: string, isSe: number): string {
  let presets = ''
  if (isSe) {
    for (const p of SE_PRESETS) presets += `<option value="${p}">${SE_LABELS[p]}</option>`
  }
  return `<div class="soundSlot" id="srow_${kind}">
    <div class="soundSlotHead">${ic(isSe ? 'sound' : 'music')}<b>${label}</b><span class="sndname" data-user-text id="sname_${kind}">--</span></div>
    <div class="soundButtons">
      <button class="sbtn" id="splay_${kind}" title="ためし聞き">${ic('play')}<span>再生</span></button>
      <button class="sbtn" id="sload_${kind}" title="音声ファイルを読み込む">${ic('folder')}<span>とりこむ</span></button>
      <button class="sbtn" id="srec_${kind}" title="マイク録音">${ic('mic')}<span>録音</span></button>
      <button class="sbtn" id="sclr_${kind}" title="この音を消す">${ic('close')}<span>消す</span></button>
    </div>
    ${isSe ? `<label class="soundPreset"><span>音の見本から選ぶ</span><select id="spre_${kind}"><option value="">えらんでね</option>${presets}</select></label><button class="soundAssignBtn" id="sassign_${kind}">${ic('film')}<span>鳴らすコマを選ぶ</span>${ic('next')}</button>` : ''}
  </div>`
}

export function drawer(): string {
  const ratios = '<option value="free" disabled>画面全体</option>' + ASPECTS.map(a => `<option value="${a.name}">${a.name}</option>`).join('')
  const resolutions = '<option value="free" disabled>フリーサイズ</option>' + RESOS.map(r => `<option value="${r.id}">${r.label}</option>`).join('')
  return `
  <section class="menuPage" data-menu-group="files">

    <div class="menuActions">
      ${menu_action('saveFileBtn', 'save', 'この作品を保存', 'あとで編集できるノートファイル', 'featured')}
      ${menu_action('exportBtn', 'film', '動画・うごメモにする', 'KWZ・PPM・GIF・動画・画像')}
    </div>
    <div class="pageRule"><span>作品をひらく</span></div>
    <div class="menuActions">
      ${menu_action('openBtn', 'folder', 'ノートをひらく', '保存した .ugn2 ファイル')}
      ${menu_action('openFlipBtn', 'film', 'うごメモをひらく', 'DSi の PPM・3DS の KWZ')}
      ${menu_action('slotsBtn', 'save', 'この端末の作品', '保存スロットを選ぶ')}
      ${menu_action('newBtn', 'plus', '新しくつくる', 'まっさらなノートから')}
    </div>

  </section>
  <section class="menuPage" data-menu-group="imports">

    <div class="menuActions">
      ${menu_action('photoBtn', 'image', '画像・写真', 'コマに使う画像を選ぶ')}
      ${menu_action('videoBtn', 'video', '動画からコマをつくる', 'うごきを連続した絵にする')}
      ${menu_action('zipInBtn', 'file', '連番画像のZIP', 'まとめたPNGをコマとして読み込む')}
      ${menu_action('flipInBtn', 'film', 'うごメモからとりこむ', 'PPM・KWZの絵を今のノートへ')}
    </div>
  </section>
  <section class="menuPage" data-menu-group="make" id="dsecMake">

    <div class="menuActions">
      ${menu_action('flipImageBtn', 'image', '画像からうごメモ', '実機で見られる絵に変換する')}
      ${menu_action('motionAssistBtn', 'spark', 'うごきアシスト', '手描きのゆらぎや動きをつける')}
      ${menu_action('effectBtn', 'effect', '絵のエフェクト', '色や見た目を変えてみる')}
      ${menu_action('transBtn', 'transition', 'コマをつなぐ', '絵の切り替わりに動きをつける')}
    </div>
  </section>
  <section class="menuPage" data-menu-group="sound">
    <div class="menuActions">${menu_action('mixerBtn', 'note', '音を鳴らすコマ', 'コマの絵を見ながら効果音をつける', 'featured')}</div>

    <div class="soundTracks">${snd_slot_row('bgm0', '曲 1', 0)}${snd_slot_row('bgm1', '曲 2', 0)}</div>
    <div class="pageRule"><span>効果音</span></div>
    <div class="soundTracks">${[0,1,2,3].map(i => snd_slot_row('se' + i, '音 ' + (i + 1), 1)).join('')}</div>
    <div class="volumeControls"><label><span>曲の音量</span><input type="range" id="bgmVol" min="0" max="100" step="5"></label><label><span>効果音の音量</span><input type="range" id="seVol" min="0" max="100" step="5"></label></div>
    <div class="menuActions">${menu_action('syncRecBtn', 'record', '再生に合わせて録音', '作品を動かしながら声を入れる')}</div>
  </section>
  <section class="menuPage" data-menu-group="canvas">

    <button class="pbtn" id="freeNewBtn">${ic('fit')}画面全体で新しく描く</button><div class="paperSettings" id="canvasSizeRow"><label>紙のかたち<select id="ratioSel">${ratios}</select></label><label>絵の大きさ<select id="resoSel">${resolutions}</select></label><button class="pbtn" id="sizeApply">この大きさにする</button><span class="phint" id="sizeNow"></span></div>
    <div class="pageRule"><span>紙の色</span></div>
    <div class="paperColors"><label id="paperCanvasCustom">じぶんの色<input type="color" id="paperIn"></label><span id="paperSw"></span><span class="phint">ぜんぶのコマに使います</span></div>
    <div class="pageRule"><span>絵の向き</span></div>
    <div class="paperTurns"><button class="pbtn" id="rotLBtn">${ic('rotl')}左に回す</button><button class="pbtn" id="rotRBtn">${ic('rotr')}右に回す</button><button class="pbtn" id="flipHBtn">${ic('fliph')}左右を反転</button><button class="pbtn" id="flipVBtn">${ic('flipv')}上下を反転</button></div>
  </section>
  <section class="menuPage" data-menu-group="frames">

    <div class="menuActions">${menu_action('addManyBtn', 'many', 'コマをまとめて追加', '枚数を決めて追加する')}${menu_action('rangeBtn', 'ab', 'まとめてコピー・変更', 'A-B区間を決めて操作する')}${menu_action('gotoBtn', 'goto', 'コマ番号へとぶ', '見たいコマを指定する')}</div>
  </section>
  <section class="menuPage" data-menu-group="project">
    <label class="noteNameLabel">作品のなまえ<input id="menuTitle" data-user-text maxlength="40" autocomplete="off" spellcheck="false"></label>
    <div class="menuActions"><button class="menuAction" data-menu-group="canvas"><span class="actionGlyph">${ic('grid')}</span><span class="actionCopy"><b>紙をえらぶ</b><small>紙のかたち・大きさ・色</small></span></button><button class="menuAction" id="projectMode"><span class="actionGlyph">${ic('swap')}</span><span class="actionCopy"><b>うごメモモード</b><small>ノーマル・DSi・3DS</small></span></button></div>
  </section>
  <section class="menuPage" data-menu-group="settings">

    <div class="settingsLines">
      <button class="settingSwitch" id="themeBtn">${ic('moon')}<span><b>暗い画面で描く</b><small id="themeState">オフ</small></span><i class="switchKnob" aria-hidden="true"></i></button>
      <button class="settingSwitch" id="uisfxTgl">${ic('sound')}<span><b>ボタンの音</b><small id="soundState">オン</small></span><i class="switchKnob" aria-hidden="true"></i></button>
    </div>
    <div class="menuActions">${menu_action('appSettingsBtn', 'pen', '描き方の設定', '筆箱・グリッド・オニオン・ことば')}${menu_action('tutBtn2', 'help', '使い方を見てみる', '実際の画面でひとつずつ')}</div>

  </section>`
}

