import { ic } from './dom'
import { T_PEN, T_FILL, T_ERASER, T_EYEDROP, T_PIXEL, T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART, T_TEXT, T_SELECT, T_LASSO, T_PASTE, T_HAND, PAT_TABLE, SIZES, ASPECTS, RESOS, SE_PRESETS, SE_LABELS, APP_NAME, BRUSH_DEFS, SIZE_MIN, SIZE_MAX, PXN_MIN, PXN_MAX } from './h'
import { tr } from './lang'

export const TOOL_DEFS: { t: number, icon: string, label: string, key: string }[] = [
  { t: T_PEN, icon: 'pen', label: tr('ペン'), key: 'B' },
  { t: T_ERASER, icon: 'eraser', label: tr('けしごむ'), key: 'E' },
  { t: T_FILL, icon: 'fill', label: tr('ぬりつぶし'), key: 'G' },
  { t: T_EYEDROP, icon: 'eyedrop', label: tr('スポイト'), key: 'I' },
  { t: T_PIXEL, icon: 'pixel', label: tr('ドット'), key: 'P' },
  { t: T_LINE, icon: 'line', label: tr('直線'), key: 'L' },
  { t: T_RECT, icon: 'rect', label: tr('四角'), key: 'U' },
  { t: T_CIRCLE, icon: 'circle', label: tr('まる'), key: 'O' },
  { t: T_STAR, icon: 'star', label: tr('ほし'), key: '' },
  { t: T_HEART, icon: 'heart', label: tr('ハート'), key: '' },
  { t: T_TEXT, icon: 'text', label: tr('もじ'), key: 'T' },
  { t: T_SELECT, icon: 'select', label: tr('はんい'), key: 'M' },
  { t: T_LASSO, icon: 'lasso', label: tr('なげなわ'), key: '' },
  { t: T_PASTE, icon: 'paste', label: tr('はりつけ'), key: 'V' },
  { t: T_HAND, icon: 'hand', label: tr('移動'), key: 'H' },
]

const RAIL_SEP_BEFORE = new Map<number, string>([[T_LINE, 'ずけい'], [T_TEXT, 'もじ'], [T_SELECT, 'はんい'], [T_HAND, 'いどう']])

function rail(): string {
  let s = '<i class="rsep" aria-hidden="true">かく</i>'
  for (const d of TOOL_DEFS) {
    const sec = RAIL_SEP_BEFORE.get(d.t)
    if (sec !== undefined) s += `<i class="rsep" aria-hidden="true">${sec}</i>`
    s += `<button class="rb" id="tl_${d.t}" data-t="${d.t}" title="${d.label}${d.key ? ' (' + d.key + ')' : ''}">${ic(d.icon)}<i class="rlbl">${d.label}</i></button>`
  }
  s += `<button class="rb" id="tfBtn" title="うごかす（スライド・かいてん・かくだい）">${ic('zoomin')}<i class="rlbl">うごかす</i></button>`
  return `<div class="rtools" id="railTools">${s}</div>
  <div class="rgap"></div>
  <div class="rfix">
    <button class="rb" id="optBtn" title="アプリの設定">${ic('gear')}<i class="rlbl">せってい</i></button>
    <button class="rb rswatch" id="colorBtn" title="いろ"><span class="chip" id="colorChip"></span><i class="rlbl">いろ</i></button>
    <button class="rb" id="sizeBtn" title="ふとさ"><span class="dotwrap"><span class="dot" id="sizeDot"></span></span><i class="rlbl">ふとさ</i></button>
    <button class="rb" id="markBtn" title="マーク(スタンプ)">${ic('mark')}<i class="rlbl">マーク</i></button>
  </div>`
}

function brush_pop(): string {
  let s = ''
  for (const b of BRUSH_DEFS) s += `<button class="brushb" id="brush_${b.id}" data-b="${b.id}" title="${b.label}">${ic(b.icon)}<span>${b.label}</span></button>`
  return s
}

function size_pop(): string {
  let s = ''
  for (const v of SIZES) s += `<button class="szb" id="sz_${v}" data-sz="${v}" title="太さ ${v}"><span class="dot" style="width:${Math.min(26, Math.max(4, v))}px;height:${Math.min(26, Math.max(4, v))}px"></span></button>`
  return s
}

function pat_pop(): string {
  let s = ''
  for (let i = 0; i < PAT_TABLE.length; i++) s += `<button class="patb" id="pat_${i}" data-pat="${i}" title="${PAT_TABLE[i].label}"><canvas width="28" height="28" data-patprev="${i}"></canvas></button>`
  return s
}

function tool_pop(): string {
  return `
  <div class="pbk" id="blkBrush"><div class="plab">ペンのしゅるい</div><div class="brushgrid">${brush_pop()}</div></div>
  <div class="pbk" id="blkSize"><div class="plab">ふとさ</div><div class="szrow">${size_pop()}</div>
    <div class="prow"><input type="range" id="sizeRange" min="${SIZE_MIN}" max="${SIZE_MAX}" step="1"><input type="number" class="numin" id="sizeNum" min="${SIZE_MIN}" max="${SIZE_MAX}" step="1"><span class="plab">px</span></div>
  </div>
  <div class="pbk" id="blkStroke">
    <div class="prow"><span class="plab">手ぶれ補正</span><input type="range" id="optSmooth" min="0" max="4" step="1"><b id="optSmoothVal">2</b></div>
    <div class="prow"><button class="tgl" id="optPressure">${ic('pen')}筆圧で太さ</button></div>
  </div>
  <div class="pbk" id="blkSym">
    <div class="prow tgl3">
      <button class="tgl" id="optSymX">${ic('fliph')}左右対称</button>
      <button class="tgl" id="optSymY">${ic('flipv')}上下対称</button>
    </div>
  </div>
  <div class="pbk" id="blkAlpha"><div class="prow"><span class="plab">不透明度</span><input type="range" id="optAlpha" min="10" max="100" step="5"><b id="optAlphaVal">100</b></div></div>
  <div class="pbk" id="blkPat"><div class="plab">もよう</div><div class="patgrid">${pat_pop()}</div></div>
  <div class="pbk" id="blkOutline">
    <div class="prow"><button class="tgl" id="optOutline">フチドリ</button><input type="color" id="optOColor" value="#FFFFFF" title="フチの色"><input type="range" id="optOWidth" min="1" max="12" step="1"><b id="optOWidthVal">3</b></div>
  </div>
  <div class="pbk" id="blkFill"><button class="tgl" id="optFill">中を塗りつぶす</button></div>
  <div class="pbk" id="blkFillTool">
    <button class="tgl" id="optFillAll">${ic('fill')}はなれた同じ色もぜんぶ</button>
    <div class="phint">オンにすると、タップした色とおなじ色をレイヤー全体でまとめて塗りかえます</div>
  </div>
  <div class="pbk" id="blkPxn"><div class="prow"><span class="plab">マス目</span><input type="range" id="pxnRange" min="${PXN_MIN}" max="${PXN_MAX}" step="1"><input type="number" class="numin" id="pxnNum" min="${PXN_MIN}" max="${PXN_MAX}" step="1"><span class="plab">マス</span></div></div>
  <div class="pbk" id="blkSel">
    <div class="prow tgl3">
      <button class="pbtn" id="selCopy">${ic('dup')}コピー</button>
      <button class="pbtn" id="selCut">${ic('select')}切り取り</button>
      <button class="pbtn" id="selDel">${ic('trash')}削除</button>
    </div>
    <div class="phint">はんいの中をドラッグすると動かせます（回転・拡大も）</div>
  </div>
  <div class="pbk" id="blkPaste"><div class="phint">キャンバスをタップして位置を決め、✓で確定</div></div>`
}

function color_pop(): string {
  return `
  <div class="paltabs">
    <button class="ptab" id="palTab_0">スタンダード</button>
    <button class="ptab" id="palTab_1">DSi</button>
    <button class="ptab" id="palTab_2">3DS</button>
  </div>
  <div class="palgrid" id="palGrid"></div>
  <div class="plab">じぶんの色 <span class="phint">(いまの色を＋でとうろく／長押しで削除)</span></div>
  <div class="palgrid" id="custGrid"></div>
  <div class="prow"><input type="color" id="pickIn" title="いろをえらぶ"><input type="text" id="hexIn" maxlength="7" placeholder="#RRGGBB"><button class="pbtn" id="custAdd">＋とうろく</button></div>`
}

function layer_pop(): string {
  return `<div id="layerRows"></div>
  <div class="prow tgl3">
    <button class="pbtn" id="mergeBtn" title="いまのレイヤーを下と結合">${ic('mergedown')}下と結合</button>
    <button class="pbtn" id="lclearBtn" title="いまのレイヤーを消去">${ic('trash')}消去</button>
    <button class="pbtn" id="lcopyBtn" title="いまのレイヤーを他へコピー">${ic('dup')}コピー先…</button>
  </div>
  <div class="prow tgl3">
    <button class="pbtn" id="laddBtn" title="ノーマルモードでレイヤーを追加">${ic('plus')}追加</button>
    <button class="pbtn" id="ldelBtn" title="追加したレイヤーを削除">${ic('trash')}レイヤー削除</button>
  </div>
`
}

function snd_slot_row(kind: string, label: string, isSe: number): string {
  let pre = ''
  if (isSe) {
    let o = '<option value="">プリセット…</option>'
    for (const p of SE_PRESETS) o += `<option value="${p}">${SE_LABELS[p]}</option>`
    pre = `<select id="spre_${kind}" class="ssel">${o}</select>`
  }
  return `<div class="sndrow" id="srow_${kind}">
    <span class="sndlab">${label}</span>
    <span class="sndname" id="sname_${kind}">--</span>
    <button class="sbtn" id="splay_${kind}" title="ためし聞き">${ic('play')}</button>
    <button class="sbtn" id="sload_${kind}" title="ファイル">${ic('folder')}</button>
    <button class="sbtn" id="srec_${kind}" title="マイク録音">${ic('mic')}</button>
    ${pre}
    <button class="sbtn" id="sclr_${kind}" title="クリア">${ic('close')}</button>
  </div>`
}

function drawer(): string {
  let ratioOpts = ''
  for (const a of ASPECTS) ratioOpts += `<option value="${a.name}">${a.name}</option>`
  let resoOpts = ''
  for (const r of RESOS) resoOpts += `<option value="${r.id}">${r.label}</option>`
  return `
  <div class="dsec">
    <div class="dhead">${ic('swap')}モード</div>
    <div class="dgrid">
      <button class="mbtn" id="modeBtn">${ic('swap')}<span id="modeName">ノーマル</span></button>
    </div>
  </div>
  <div class="dsec">
    <div class="dhead">${ic('file')}ノート</div>
    <div class="dgrid">
      <button class="mbtn" id="newBtn">${ic('plus')}<span>新規</span></button>
      <button class="mbtn" id="openBtn">${ic('folder')}<span>開く(.ugn2)</span></button>
      <button class="mbtn" id="openFlipBtn">${ic('film')}<span>開く(kwz/ppm)</span></button>
      <button class="mbtn" id="saveFileBtn">${ic('download')}<span>ファイルに保存</span></button>
      <button class="mbtn" id="slotsBtn">${ic('save')}<span>スロット</span></button>
    </div>
  </div>
  <div class="dsec">
    <div class="dhead">${ic('upload')}取り込み</div>
    <div class="dgrid">
      <button class="mbtn" id="photoBtn">${ic('image')}<span>写真</span></button>
      <button class="mbtn" id="videoBtn">${ic('video')}<span>動画→コマ</span></button>
      <button class="mbtn" id="zipInBtn">${ic('file')}<span>PNG連番ZIP</span></button>
      <button class="mbtn" id="flipInBtn">${ic('film')}<span>うごメモ取り込み</span></button>
    </div>
    <div class="phint">.kwz / .ppm を読み込んで、コマとして取り込みます</div>
  </div>
  <div class="dsec">
    <div class="dhead">${ic('download')}書き出し</div>
    <div class="dgrid">
      <button class="mbtn" id="exportBtn">${ic('film')}<span>書き出しハブ…</span></button>
    </div>
  </div>
  <div class="dsec" id="dsecMake">
    <div class="dhead">${ic('effect')}つくる</div>
    <div class="dgrid">
      <button class="mbtn" id="flipImageBtn">${ic('image')}<span>画像からうごメモ</span></button>
      <button class="mbtn" id="motionAssistBtn">${ic('spark')}<span>うごきアシスト</span></button>
      <button class="mbtn" id="effectBtn">${ic('effect')}<span>エフェクト…</span></button>
      <button class="mbtn" id="transBtn">${ic('transition')}<span>トランジション</span></button>
    </div>
    <div class="phint">画像の実機変換、手描きゆらぎ、端末内の動作支援をまとめています</div>
  </div>
  <div class="dsec">
    <div class="dhead">${ic('sound')}おと</div>
    ${snd_slot_row('bgm0', 'BGM1', 0)}
    ${snd_slot_row('bgm1', 'BGM2', 0)}
    ${snd_slot_row('se0', 'SE1', 1)}
    ${snd_slot_row('se1', 'SE2', 1)}
    ${snd_slot_row('se2', 'SE3', 1)}
    ${snd_slot_row('se3', 'SE4', 1)}
    <div class="prow"><span class="plab">BGM音量</span><input type="range" id="bgmVol" min="0" max="100" step="5"></div>
    <div class="prow"><span class="plab">SE音量</span><input type="range" id="seVol" min="0" max="100" step="5"></div>
    <div class="dgrid">
      <button class="mbtn" id="mixerBtn">${ic('note')}<span>SEミキサー</span></button>
      <button class="mbtn" id="syncRecBtn">${ic('record')}<span>アテレコ録音</span></button>
    </div>
  </div>
  <div class="dsec">
    <div class="dhead">${ic('grid')}キャンバス</div>
    <div class="prow" id="canvasSizeRow"><span class="plab">比率</span><select id="ratioSel">${ratioOpts}</select><span class="plab">画質</span><select id="resoSel">${resoOpts}</select></div>
    <div class="prow"><button class="pbtn" id="sizeApply">サイズを変更する</button><span class="phint" id="sizeNow"></span></div>
    <div class="prow tgl3">
      <button class="pbtn" id="rotLBtn">${ic('rotl')}左回転</button>
      <button class="pbtn" id="rotRBtn">${ic('rotr')}右回転</button>
      <button class="pbtn" id="flipHBtn">${ic('fliph')}左右反転</button>
      <button class="pbtn" id="flipVBtn">${ic('flipv')}上下反転</button>
    </div>
    <div class="prow" id="paperRow"><span class="plab">紙の色</span><input type="color" id="paperIn"><span id="paperSw"></span><span class="phint">全コマ共通</span></div>
  </div>
  <div class="dsec">
    <div class="dhead">${ic('film')}コマ</div>
    <div class="dgrid">
      <button class="mbtn" id="addManyBtn">${ic('many')}<span>まとめて追加</span></button>
      <button class="mbtn" id="rangeBtn">${ic('ab')}<span>範囲操作…</span></button>
      <button class="mbtn" id="gotoBtn">${ic('goto')}<span>番号ジャンプ</span></button>
    </div>
  </div>
  <div class="dsec">
    <div class="dhead">${ic('gear')}設定</div>
    <div class="dgrid">
      <button class="mbtn" id="themeBtn">${ic('moon')}<span>テーマ切替</span></button>
      <button class="mbtn" id="uisfxTgl">${ic('sound')}<span>UI効果音</span></button>
      <button class="mbtn" id="tutBtn2">${ic('spark')}<span>チュートリアル</span></button>
    </div>
    <div class="phint">${APP_NAME} — ぜんぶブラウザの中だけで動きます</div>
  </div>`
}

export function shell_build(root: HTMLElement): void {
  root.innerHTML = `
  <header id="hd">
    <button class="hbtn mOnly" id="hdLayerBtn" title="レイヤー"><span class="lcThumb"><canvas id="lcThumbCv" width="34" height="26"></canvas></span></button>
    <button class="hbtn" id="menuBtn" title="メニュー">${ic('menu')}<span class="hlab">メニュー</span></button>
    <button class="hbtn" id="undoBtn" title="もどす (Ctrl+Z)">${ic('undo')}<span class="hlab">もどす</span></button>
    <button class="hbtn" id="redoBtn" title="やりなおす (Ctrl+Y)">${ic('redo')}<span class="hlab">すすむ</span></button>
    <span id="modeBadge" title="いまのモード(メニュー→モードで変更)"></span>
    <input id="title" maxlength="40" autocomplete="off" spellcheck="false">
    <span id="saveDot" title="自動保存"></span>
    <button class="hbtn mOnly" id="hdSettings" title="せってい">${ic('gear')}</button>
    <button class="hbtn" id="tutBtn" title="つかいかた">${ic('help')}</button>
  </header>
  <div id="mainRow">
    <div id="modePill" class="mOnly">
    <button class="mp" id="mp_draw">${ic('pen')}<i>かく</i></button>
    <button class="mp" id="mp_fill">${ic('fill')}<i>ぬる</i></button>
    <button class="mp" id="mp_shape">${ic('rect')}<i>図形</i></button>
    <button class="mp" id="mp_text">${ic('text')}<i>もじ</i></button>
  </div>
  <div id="dock" class="mOnly">
    <div id="dockRow">
      <button class="dkb" id="dockMore" title="ほかのどうぐ">${ic('menu')}</button>
      <button class="dkb" id="dockEraser" title="けしごむ">${ic('eraser')}</button>
      <button class="dkb main" id="dockMain" title="いまのどうぐ">${ic('pen')}</button>
      <button class="dkb" id="dockColor" title="いろ"><span class="chip" id="dockChip"></span></button>
      <button class="dkb" id="dockSize" title="ふとさ"><span class="dotwrap"><span class="dot" id="dockDot"></span></span></button>
    </div>
    <div id="dockColors"></div>
  </div>
  <nav id="rail">${rail()}</nav>
    <div id="stageWrap">
      <div id="flipWrap"><div id="stagePan">
        <canvas id="stage"></canvas>
        <canvas id="onionCv"></canvas>
        <canvas id="gridCv"></canvas>
        <canvas id="antsCv"></canvas>
        <canvas id="floCv"></canvas>
      </div></div>
      <div id="quick">
        <button class="qb" id="layerBtn" title="レイヤー">${ic('layers')}<i class="qlbl">レイヤー</i><b id="layerTag">A</b></button>
        <button class="qb" id="onionBtn" title="オニオンスキン">${ic('onion')}<i class="qlbl">オニオン</i></button>
        <button class="qb" id="gridBtn" title="グリッド">${ic('grid')}<i class="qlbl">グリッド</i></button>
        <button class="qb" id="vflipBtn" title="表示を左右反転(確認用)">${ic('swap')}<i class="qlbl">はんてん</i></button>
        <button class="qb" id="fitBtn" title="全体表示 (0)">${ic('fit')}<i class="qlbl">ぜんたい</i></button>
      </div>
      <div id="zoomLabel"></div>
      <div id="floBar">
        <button class="fbb" id="floRotL" title="左に90°">${ic('rotl')}</button>
        <button class="fbb" id="floRotR" title="右に90°">${ic('rotr')}</button>
        <button class="fbb" id="floFlipH" title="左右反転">${ic('fliph')}</button>
        <button class="fbb" id="floFlipV" title="上下反転">${ic('flipv')}</button>
        <button class="fbb" id="floReset" title="変形リセット">${ic('reset')}</button>
        <span id="floInfo"></span>
        <button class="fbb ok" id="floOk" title="確定 (Enter)">${ic('check')}</button>
        <button class="fbb no" id="floNo" title="キャンセル (Esc)">${ic('close')}</button>
      </div>
    </div>
  </div>
  <div id="tl">
    <div id="tlBar">
      <div class="tlGroup tlTransport">
        <button class="tb" id="homeBtn" title="さいしょのコマへ">${ic('skipback')}</button>
        <button class="tb" id="prevBtn" title="前のコマ">${ic('prev')}</button>
        <button class="tb primary" id="playBtn" title="再生/停止 (Space)">${ic('play')}</button>
        <button class="tb" id="nextBtn" title="次のコマ">${ic('next')}</button>
      </div>
      <div class="tlGroup tlLoop">
        <button class="tb" id="loopBtn" title="ループ">${ic('loop')}</button>
        <button class="tb" id="abBtn" title="A-B区間ループ">${ic('ab')}</button>
      </div>
      <button id="frameNo" title="番号を指定して移動"></button>
      <div class="tlGroup tlTiming">
        <button class="tb wide" id="fpsBtn" title="はやさ">${ic('clock')}<b id="fpsMain">6fps</b><i id="fpsTag"></i></button>
        <button class="tb wide" id="holdBtn" title="このコマの表示時間">${ic('clock')}<b id="holdLabel"></b></button>
      </div>
      <span class="tgap"></span>
      <div class="tlGroup tlFrames">
        <button class="tb tlabel" id="dupBtn" title="コマを複製 (D)">${ic('dup')}<b>複製</b></button>
        <button class="tb tlabel warn" id="delBtn" title="いまのコマを削除">${ic('trash')}<b>削除</b></button>
        <button class="tb tlabel accent" id="addBtn" title="コマを追加 (N)">${ic('plus')}<b>追加</b></button>
      </div>
      <div class="tlGroup tlTail">
        <button class="tb" id="tlToggle" title="タイムラインをたたむ">${ic('down')}</button>
        <button class="tb" id="tlMoreBtn" title="コマ操作">${ic('dots')}</button>
      </div>
    </div>
    <div id="fs"></div>
  </div>
<div id="drawer"><div id="drawerHead"><b>${APP_NAME}</b><button class="hbtn" id="drawerClose">${ic('close')}</button></div><div id="drawerBody">${drawer()}</div></div>
<div id="scrim"></div>
      <div id="selBar">
      <button class="sb" id="sbT">${ic('move')}<i>へんけい</i></button>
      <button class="sb" id="sbC">${ic('dup')}<i>コピー</i></button>
      <button class="sb" id="sbX">${ic('cut')}<i>きりぬき</i></button>
      <button class="sb q" id="sbQ">${ic('close')}</button>
    </div>
    <div id="popWrap">
        <div class="pop" id="popTool"><div class="popHead"><b>ツールのせってい</b><button class="popx" title="とじる">✕</button></div>${tool_pop()}</div>
        <div class="pop" id="popColor"><div class="popHead"><b>いろ</b><button class="popx" title="とじる">✕</button></div>${color_pop()}</div>
        <div class="pop" id="popLayer"><div class="popHead"><b>レイヤー</b><button class="popx" title="とじる">✕</button></div>${layer_pop()}</div>
        <div class="pop" id="popTf"><div class="popHead"><b>うごかす</b><button class="popx" title="とじる">✕</button></div>
  <div class="prow">
    <span class="plab">対象</span>
    <button class="pbtn on" id="tfAll">ぜんぶ</button>
    <button class="pbtn" id="tfOne">いまのレイヤー</button>
  </div>
  <div class="prow"><span class="plab">よこ</span><input type="range" id="tfDx" min="-100" max="100" value="0"><b id="tfDxV">0</b></div>
  <div class="prow"><span class="plab">たて</span><input type="range" id="tfDy" min="-100" max="100" value="0"><b id="tfDyV">0</b></div>
  <div class="prow"><span class="plab">かいてん</span><input type="range" id="tfRot" min="-180" max="180" value="0"><b id="tfRotV">0°</b></div>
  <div class="prow"><span class="plab">ばいりつ</span><input type="range" id="tfScale" min="25" max="400" value="100"><b id="tfScaleV">100%</b></div>
  <div class="prow tgl3">
    <button class="pbtn primary" id="tfApply">かくてい</button>
    <button class="pbtn" id="tfCancel">やめる</button>
  </div></div>
        <div class="pop" id="popFps"><div class="popHead"><b>はやさ</b><button class="popx" title="とじる">✕</button></div><div class="prow"><span class="plab">はやさ</span><input type="range" id="fpsRange" min="0" max="7" step="1"><b id="fpsVal"></b></div></div>
        <div class="pop" id="popHold"><div class="popHead"><b>このコマをのばす</b><button class="popx" title="とじる">✕</button></div><div class="prow"><span class="plab">このコマの表示</span><input type="range" id="holdRange" min="1" max="8" step="1"><b id="holdVal"></b></div><div class="phint">1コマぶん〜8コマぶん のばせます</div></div>
        <div class="pop" id="popMark"><div class="popHead"><b>マイマーク</b><button class="popx" title="とじる">✕</button></div>
          <div class="plab">マイマーク <span class="phint">(タップで配置／長押しで削除)</span></div>
          <div class="mkgrid" id="markGrid"></div>
          <div class="prow tgl3">
            <button class="pbtn" id="markAddSel">${ic('select')}選択範囲から登録</button>
            <button class="pbtn" id="markAddFile">${ic('image')}画像から登録</button>
          </div>
          <div class="phint">えらんだマークはキャンバスに配置して、回転・拡大できます</div>
        </div>
        <div class="pop" id="popOnion"><div class="popHead"><b>オニオンスキン</b><button class="popx" title="とじる">✕</button></div><div class="prow"><span class="plab">まえ後の枚数</span><input type="range" id="onionCount" min="0" max="3" step="1"><b id="onionCountVal"></b></div></div>
        <div class="pop" id="popSettings"><div class="popHead"><b>せってい</b><button class="popx" title="とじる">✕</button></div>
          <div class="pbk"><div class="plab">筆箱（つかえるどうぐ）</div>
            <div class="prow tgl3">
              <button class="tgl" id="kitAdv">上級筆箱</button>
              <button class="tgl" id="kitBasic">初級筆箱</button>
            </div>
            <div class="phint">初級はよく使う7つだけ。あとからいつでも切りかえOK</div>
          </div>
          <div class="pbk"><div class="plab">グリッドの大きさ</div>
            <div class="prow"><input type="range" id="setGsize" min="4" max="64" step="1"><input type="number" class="numin" id="setGsizeN" min="4" max="64" step="1"><span class="plab">px</span></div>
          </div>
          <div class="pbk"><div class="plab">オニオンスキンの枚数</div>
            <div class="prow"><input type="range" id="setOnion" min="0" max="3" step="1"><b id="setOnionV">1</b></div>
          </div>
          <div class="pbk"><div class="plab">表示</div>
            <div class="prow tgl3">
              <button class="tgl" id="setTheme">ダークテーマ</button>
              <button class="tgl" id="setUisfx">UI効果音</button>
              <button class="tgl" id="setVflip">左右反転で確認</button>
            </div>
          </div>
          <div class="pbk"><div class="plab">ことば / Language</div>
            <div class="prow"><select id="setLang" class="msel">
              <option value="">じどう / Auto</option>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select></div>
          </div>
        </div>
      </div>
<div id="popScrim"></div>
<div id="ctxMenu" class="hide"></div>
<div id="modalRoot"></div>
<div id="tutRoot"></div>`
}
