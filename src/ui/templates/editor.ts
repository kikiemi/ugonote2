import { LANG, tr } from '../../lang'
import { ic } from '../../dom'
import { TOOL_DEFS } from '../tool_defs'
import { T_EYEDROP, T_PIXEL, T_TEXT, T_SELECT, T_LASSO } from '../../h'
import { rail } from './tools'

function dock_tool(tool: number): string {
  const def = TOOL_DEFS.find(d => d.t === tool)!
  return `<button class="dkb wideTool" id="dockTool_${tool}" data-dock-tool="${tool}" title="${def.label}${def.key ? ' (' + def.key + ')' : ''}" aria-pressed="false" aria-haspopup="dialog" aria-controls="popTool" aria-expanded="false">${ic(def.icon)}<i>${def.label}</i></button>`
}

export function editor_html(): string {
  return `
  <div id="mainRow">
    <div id="stageWrap"><div id="paperFit" aria-hidden="true"></div>
      <div id="flipWrap"><div id="stagePan">
        <canvas id="stage"></canvas>
        <canvas id="onionCv"></canvas>
        <canvas id="gridCv"></canvas>
        <canvas id="antsCv"></canvas>
        <canvas id="floCv"></canvas>
      </div></div>
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
  <header id="hd" aria-label="取り消し・やり直し">
    <button class="hbtn" id="undoBtn" title="もどす・取り消し (Ctrl+Z)" aria-label="もどす・取り消し">${ic('prev')}<span class="hlab">${LANG === 'en' ? tr('もどす・取り消し') : 'もどす'}</span></button>
    <button class="hbtn" id="redoBtn" title="すすむ・やり直し (Ctrl+Y)" aria-label="すすむ・やり直し">${ic('next')}<span class="hlab">${LANG === 'en' ? tr('すすむ・やり直し') : 'すすむ'}</span></button>
    <div hidden><input id="title" maxlength="40" autocomplete="off" spellcheck="false"><span id="modeBadge"></span><b id="appBrand">うごノート</b><span id="saveDot"></span><button id="tutBtn">${ic('help')}</button></div>
  </header>
  <nav id="mobileTools" aria-label="描くどうぐ"><div id="dock"><div id="dockRow">
    <button class="dkb main hasopts" id="dockMain" title="ペン・もう一度押すと設定、開いているときは閉じる" aria-haspopup="dialog" aria-controls="popTool" aria-expanded="false">${ic('pen')}<i>ペン</i></button>
    <button class="dkb" id="dockEraser" title="けしごむ (E)" aria-haspopup="dialog" aria-controls="popTool" aria-expanded="false">${ic('eraser')}<i>${LANG === 'en' ? tr('けしごむ') : '消す'}</i></button>
    <button class="dkb" id="dockFill" title="ぬりつぶし (G)" aria-haspopup="dialog" aria-controls="popTool" aria-expanded="false">${ic('fill')}<i>ぬる</i></button>
    ${dock_tool(T_PIXEL)}${dock_tool(T_SELECT)}${dock_tool(T_LASSO)}${dock_tool(T_EYEDROP)}${dock_tool(T_TEXT)}
    <button class="dkb" id="dockColor" title="色" aria-haspopup="dialog" aria-controls="popColor" aria-expanded="false"><span class="chip" id="dockChip"></span><i>色</i></button>
    <button class="dkb" id="dockSize" title="線のふとさ" aria-haspopup="dialog" aria-controls="popTool" aria-expanded="false"><span class="dotwrap"><span class="dot" id="dockDot"></span></span><i>ふとさ</i></button>
    <button class="dkb" id="dockMore" title="道具・もう一度押すと閉じる" aria-haspopup="dialog" aria-controls="rail" aria-expanded="false">${ic('grid')}<i>道具</i></button>
    <button class="dkb wideTool" id="dockGrid" title="方眼とドットの粗さ" aria-haspopup="dialog" aria-controls="popTool" aria-expanded="false">${ic('pixel')}<i>マス目</i></button>
    <button class="dkb" id="onionBtn" title="前の絵・透かす枚数を選ぶ" aria-haspopup="dialog" aria-expanded="false" aria-controls="popOnion">${ic('layers')}<i>前の絵</i></button>
    <button class="dkb wideTool" id="dockPaper" title="紙のいろ" aria-haspopup="dialog" aria-controls="popPaper" aria-expanded="false">${ic('note')}<i>紙</i></button>
    <button class="dkb" id="fitBtn" title="全体表示 (0)">${ic('fit')}<i>全体</i></button>
    <button class="dkb wideTool" id="dockImage" title="画像を写真レイヤーへ追加">${ic('image')}<i>画像</i></button>
    <button class="dkb wideTool" id="dockFocus" title="集中モード">${ic('fit')}<i>集中</i></button>
  </div></div></nav>
  <aside id="layerStack" aria-label="描くレイヤー"><div id="liveLayerTabs"></div><button id="layerBtn" class="liveLayer" title="レイヤーの追加・写真・設定" aria-haspopup="dialog">${ic('plus')}<b id="layerTag" hidden></b></button></aside>
  <nav id="rail">${rail()}</nav>
  <div id="tl">
    <div id="framePanel" aria-label="コマの操作"><div id="frameOperations"><div id="frameCommands">
      <button class="tb" id="dupBtn" title="コマを複製 (D)">${ic('dup')}<b>コピー</b></button>
      <button class="tb warn" id="delBtn" title="いまのコマを削除">${ic('trash')}<b>消す</b></button>
      <button class="tb" id="tlMoreBtn" title="コマ移動・はやさ・表示時間">${ic('dots')}<b>コマ操作</b></button>
    </div><div id="viewCommands">
      <button class="tb wide" id="fpsBtn" title="はやさ">${ic('clock')}<b id="fpsMain">6</b><span id="fpsUnit">コマ/秒</span><i id="fpsTag"></i></button>
      <button class="tb wide" id="holdBtn" title="このコマの表示時間">${ic('clock')}<b id="holdLabel"></b></button>
      <button class="tb" id="loopBtn" title="ループ">${ic('loop')}<span id="loopState">オン</span></button><button class="tb" id="abBtn" title="A-B区間ループ">${ic('ab')}</button>
      <button class="qb" id="viewBtn" title="写真・紙・下書き">${ic('onion')}<i class="qlbl">みえかた</i></button>
    </div></div><button class="tb" id="tlClose" title="コマ一覧を閉じる" aria-label="コマ一覧を閉じる">${ic('close')}<span>とじる</span></button></div>
    <div id="fs"></div>
    <div id="tlBar">
      <div class="tlGroup tlTail">
        <button class="tb" id="menuBtn" title="メニュー">${ic('menu')}<span>メニュー</span></button>
        <button class="tb" id="tlToggle" title="コマ一覧を開く">${ic('grid')}<b>コマ一覧</b></button>
        <button class="tb" id="addBtn" title="コマを追加 (N)">${ic('plus')}<b>追加</b></button>
      </div>
      <button id="frameNo" title="番号を指定して移動"></button>
      <div class="tlGroup tlTransport"><button class="tb" id="homeBtn" title="さいしょのコマへ" aria-label="さいしょのコマへ">${ic('skipback')}<span>さいしょ</span></button><button class="tb" id="prevBtn" title="前のコマ">${ic('prev')}</button><button class="tb primary" id="playBtn" title="再生/停止 (Space)">${ic('play')}</button><button class="tb" id="nextBtn" title="次のコマ">${ic('next')}</button><button class="tb" id="lastBtn" title="さいごのコマへ" aria-label="さいごのコマへ">${ic('last')}<span>さいご</span></button></div>
    </div>
  </div>
`
}
