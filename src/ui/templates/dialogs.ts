import { FPS_SPEEDS } from '../../h'
import { ic } from '../../dom'
import { tool_pop, color_pop, layer_pop } from './tools'

export function dialogs_html(): string {
  return `<div id="scrim"></div><div id="recordBar" hidden role="status"><span class="recordLight" aria-hidden="true"></span><span id="recordTime">録音中 0:00</span><button id="recordStop">${ic('stop')}<span>録音を止める</span></button></div>
      <div id="selBar">
      <button class="sb" id="sbT">${ic('move')}<i>へんけい</i></button>
      <button class="sb" id="sbC">${ic('dup')}<i>コピー</i></button>
      <button class="sb" id="sbX">${ic('cut')}<i>きりぬき</i></button>
      <button class="sb q" id="sbQ">${ic('close')}</button>
    </div>
    <div id="popWrap"><div class="pop" id="popView"><div class="popHead"><b>みえかた</b><button class="popx" title="とじる">${ic("check")}<span>かく</span></button></div><div id="layerShelf"><div class="plab">紙と下書き</div><div id="quick">
        <button class="qb pcImageQuick" id="photoQuickBtn" title="画像を写真レイヤーへ追加">${ic('image')}<i class="qlbl">画像</i></button>

        <button class="qb" id="gridBtn" title="グリッド">${ic('grid')}<i class="qlbl">グリッド</i></button>
        <button class="qb" id="vflipBtn" title="表示を左右反転(確認用)">${ic('swap')}<i class="qlbl">はんてん</i></button>
        <button class="qb" id="focusBtn" title="道具を隠して集中する" aria-pressed="false">${ic('fit')}<span>集中</span></button>
      </div></div></div>
        <div class="pop drawingBench" id="popTool"><div class="popHead"><b>${ic('pen')}<span id="toolSettingsName">ペン</span></b><button class="popx" title="描く画面にもどる">${ic('check')}<span>とじる</span></button></div><div class="strokeSample"><div class="sampleCaption"><b id="strokeName"></b><span id="strokeSize"></span></div><canvas id="strokePreview" width="640" height="100" aria-label="選んだペンの線の見本"></canvas></div><div class="popBody" id="toolOptions">${tool_pop()}</div><div class="toolPageTabs" aria-label="筆箱の中を移動"><button data-tool-page="brush">${ic('pen')}ペン</button><button data-tool-page="size">${ic('adjust')}ふとさ</button><button data-tool-page="grid">${ic('pixel')}マス目</button><button data-tool-page="pattern">${ic('grid')}もよう</button><button data-tool-page="detail">${ic('gear')}その他</button></div></div>
        <div class="pop drawingBench" id="popColor"><div class="popHead"><b>${ic('fill')}いろ</b><button class="popx" title="描く画面にもどる">${ic('check')}<span>とじる</span></button></div>${color_pop()}</div>
        <div class="pop" id="popPaper"><div class="popHead"><b>紙のいろ</b><button class="popx" title="紙の色を閉じる">${ic('check')}<span>とじる</span></button></div><div id="paperChoices" class="paperChoices"></div><label id="paperCustomLabel">じぶんの色<input type="color" id="paperCustom"></label><p class="phint" id="paperModeHint"></p></div>
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
        <div class="pop" id="popFps"><div class="popHead"><b>はやさ</b><button class="popx" title="とじる">✕</button></div><div class="prow"><span class="plab">はやさ</span><input type="range" id="fpsRange" min="0" max="${FPS_SPEEDS.length - 1}" step="1"><b id="fpsVal"></b></div></div>
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
        <div class="pop" id="popOnion"><div class="popHead"><b>前の絵を透かす</b><button class="popx" title="描く画面にもどる">${ic("check")}<span>とじる</span></button></div><p class="phint">前後それぞれ、何枚重ねて見る？</p><div id="onionChoices" aria-label="透かす枚数"><button data-onion-count="0" aria-pressed="false">オフ</button><button data-onion-count="1" aria-pressed="false">1枚</button><button data-onion-count="2" aria-pressed="false">2枚</button><button data-onion-count="3" aria-pressed="false">3枚</button><button data-onion-count="5" aria-pressed="false">5枚</button><button data-onion-count="10" aria-pressed="false">10枚</button></div><div class="onionDirections"><button class="tgl" id="onionPrev" aria-pressed="true">前のコマを表示</button><button class="tgl" id="onionNext" aria-pressed="true">後のコマを表示</button><button class="tgl" id="onionSkip" aria-pressed="false">直前・直後を省く</button></div><div class="onionLegend"><span>赤：前のコマ</span><span>青：後のコマ</span></div><div class="prow"><label class="plab" for="onionCount">枚数</label><input type="range" id="onionCount" min="0" max="10" step="1"><b id="onionCountVal"></b></div></div>
        <div class="pop" id="popSettings"><div class="popHead"><b class="popTitleIcon">${ic('gear')}設定</b><button class="popx" title="とじる">✕</button></div>
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
            <div class="prow"><input type="range" id="setOnion" min="0" max="10" step="1"><b id="setOnionV">1</b></div>
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
