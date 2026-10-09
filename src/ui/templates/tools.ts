import { ic } from '../../dom'
import { T_PEN, T_FILL, T_ERASER, T_PIXEL, T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART, T_TEXT, T_SELECT, T_LASSO, PAT_TABLE, SIZES, BRUSH_DEFS, SIZE_MIN, SIZE_MAX, PXN_MIN, PXN_MAX } from '../../h'

import { TOOL_DEFS } from '../tool_defs'

const RAIL_SEP_BEFORE = new Map<number, string>([[T_LINE, 'かたち'], [T_TEXT, 'えらぶ・うごかす']])
const OPTION_TOOLS = new Set([T_PEN, T_ERASER, T_FILL, T_PIXEL, T_LINE, T_RECT, T_CIRCLE, T_STAR, T_HEART, T_SELECT, T_LASSO])

export function rail(): string {
  let s = '<i class="rsep" aria-hidden="true">かく</i>'
  for (const d of TOOL_DEFS) {
    const sec = RAIL_SEP_BEFORE.get(d.t)
    if (sec !== undefined) s += `<i class="rsep" aria-hidden="true">${sec}</i>`
    const options = OPTION_TOOLS.has(d.t)
    const hint = options ? '・選択中にもう一度押すと設定' : ''
    s += `<button class="rb${options ? ' hasopts' : ''}" id="tl_${d.t}" data-t="${d.t}" title="${d.label}${d.key ? ' (' + d.key + ')' : ''}${hint}"${options ? ' aria-haspopup="dialog"' : ''}>${ic(d.icon)}<i class="rlbl">${d.label}</i></button>`
  }
  s += `<button class="rb" id="tfBtn" title="うごかす（スライド・かいてん・かくだい）">${ic('zoomin')}<i class="rlbl">うごかす</i></button>`
  return `<div class="toolboxHead"><b>${ic('pen')}どうぐばこ</b><button id="toolboxClose" class="popx" title="どうぐを閉じる">${ic('check')}<span>かく</span></button></div><div class="toolboxBody"><div class="rtools" id="railTools">${s}</div></div>
  <div class="rfix">
    <button class="rb" id="optBtn" title="アプリの設定">${ic('gear')}<i class="rlbl">せってい</i></button>
    <button class="rb rswatch" id="colorBtn" title="いろ"><span class="chip" id="colorChip"></span><i class="rlbl">いろ</i></button>
    <button class="rb" id="sizeBtn" title="ふとさ"><span class="dotwrap"><span class="dot" id="sizeDot"></span></span><i class="rlbl">ふとさ</i></button>
    <button class="rb" id="markBtn" title="マーク(スタンプ)">${ic('mark')}<i class="rlbl">マーク</i></button>
  </div>`
}

function brush_pop(): string {
  let s = ''
  for (const b of BRUSH_DEFS) s += `<button class="brushb" id="brush_${b.id}" data-b="${b.id}" title="${b.label}"><span class="penHandle" aria-hidden="true">${pen_illustration(b.id)}</span><canvas width="64" height="28" data-brushprev="${b.id}"></canvas><span>${b.label}</span></button>`
  return s
}
function pen_illustration(id: number): string {
  const tips = [
    '<path d="m18 57 6 13 6-13Z" fill="var(--acc)"/><path d="M18 48h12v9H18Z"/>',
    '<path d="M16 49h16v12l-16 7Z" fill="var(--acc)"/>',
    '<path d="m18 54 6 17 6-17Z" fill="#ffd89c"/><path d="m21 63 3 8 3-8Z" fill="var(--tx)"/><path d="M24 10v44"/>',
    '<path d="M17 49h14v6H17Z"/><path d="M17 55c0 10 6 6 7 16 9-5 7-11 7-16Z" fill="var(--acc)"/>',
    '<path d="M17 47h14v14H17Z"/><path d="M24 4V0m-7 3-3-3m17 3 3-3"/>',
    '<path d="M17 51h14l-7 18Z" fill="var(--acc)"/><path d="M16 24h16v18H16Z" fill="var(--acc-soft)"/>',
    '<path d="m17 50 7 20 7-20-7-7Z" fill="var(--acc-soft)"/><path d="M24 50v20m-3-18h6"/>',
    '<circle cx="18" cy="59" r="2"/><circle cx="28" cy="63" r="2"/><circle cx="23" cy="69" r="1.5"/>',
    '<path d="M17 49h14v7H17Z"/><path d="M17 56c1 6 5 10 7 14 2-4 6-8 7-14Z" fill="var(--acc)"/>',
    '<path d="M18 49h12v17H18Z" fill="var(--acc-soft)"/><path d="M24 53v10" stroke="#fff" stroke-width="3"/>',
    '<path d="M16 48h16v17H16Z" fill="var(--acc-soft)"/><path d="m17 65 5 1 3-2 6 1"/>',
    '<path d="M17 50h14v8H17Z"/><path d="m16 65 4-3m12 1-3-2m-5 6v4"/>',
    '<path d="M18 48h12v9H18Z"/><path d="M24 57c-15 8 16 6 0 15" stroke="var(--acc)" stroke-width="5"/>',
  ]
  return `<svg viewBox="0 0 48 76" fill="none" stroke="var(--acc-d)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 48V12a7 7 0 0 1 14 0v36" fill="var(--bg2)"/><path d="M17 15h14M17 43h14M28 16v15"/>${tips[id] || tips[0]}</svg>`
}

function size_pop(): string {
  let s = ''
  for (const v of SIZES) s += `<button class="szb" id="sz_${v}" data-sz="${v}" title="太さ ${v}"><span class="sizeInk"><span class="dot" style="width:${Math.min(26, Math.max(4, v))}px;height:${Math.min(26, Math.max(4, v))}px"></span></span><small>${v}</small></button>`
  return s
}

function pat_pop(): string {
  let s = ''
  for (let i = 0; i < PAT_TABLE.length; i++) s += `<button class="patb" id="pat_${i}" data-pat="${i}" title="${PAT_TABLE[i].label}"><canvas width="28" height="28" data-patprev="${i}"></canvas></button>`
  return s
}

export function tool_pop(): string {
  return `
  <div class="pbk" id="blkBrush"><div class="plab">ペンのしゅるい</div><div class="brushgrid">${brush_pop()}</div></div>
  <div class="pbk" id="blkSize"><div class="plab">ふとさ</div><div class="szrow">${size_pop()}</div>
    <div class="prow"><input type="range" id="sizeRange" min="${SIZE_MIN}" max="${SIZE_MAX}" step="1"><input type="number" class="numin" id="sizeNum" min="${SIZE_MIN}" max="${SIZE_MAX}" step="1"><span class="plab">px</span></div>
  </div>
  <div class="pbk" id="blkPat"><div class="plab">もよう</div><div class="patgrid">${pat_pop()}</div></div>
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
  <div class="pbk" id="blkOutline">
    <div class="prow"><button class="tgl" id="optOutline">フチドリ</button><input type="color" id="optOColor" value="#FFFFFF" title="フチの色"><input type="range" id="optOWidth" min="1" max="12" step="1"><b id="optOWidthVal">3</b></div>
  </div>
  <div class="pbk" id="blkFill"><button class="tgl" id="optFill">中を塗りつぶす</button></div>
  <div class="pbk" id="blkFillTool">
    <button class="tgl" id="optFillAll">${ic('fill')}はなれた同じ色もぜんぶ</button>
    <div class="phint">オンにすると、タップした色とおなじ色をレイヤー全体でまとめて塗りかえます</div>
  </div>
  <div class="pbk" id="blkGrid"><div class="adjustHeading"><b>方眼の間隔</b><button class="tgl" id="adjustGrid" aria-pressed="true">表示オン</button></div><div class="adjustChoices" id="gridChoices"><button data-grid-size="8">8 px</button><button data-grid-size="16">16 px</button><button data-grid-size="32">32 px</button><button data-grid-size="64">64 px</button></div><div class="prow"><input type="range" id="gridStepRange" min="4" max="64" step="1" aria-label="方眼の間隔"><input type="number" class="numin" id="gridStepNum" min="4" max="64" step="1" aria-label="方眼の間隔を入力"><span class="plab">px</span></div><div class="phint" id="gridStepHint"></div></div>
  <div class="pbk" id="blkPxn"><div class="adjustHeading"><b>ドットの粗さ</b><span id="pixelSizeVal"></span></div><div class="adjustChoices" id="pixelChoices"><button data-pixel-count="8">8マス</button><button data-pixel-count="16">16マス</button><button data-pixel-count="32">32マス</button><button data-pixel-count="64">64マス</button></div><div class="adjustScale"><span>粗い</span><span>細かい</span></div><div class="prow"><label class="plab" for="pxnRange">横のマス数</label><input type="range" id="pxnRange" min="${PXN_MIN}" max="${PXN_MAX}" step="1"><input type="number" class="numin" id="pxnNum" min="${PXN_MIN}" max="${PXN_MAX}" step="1"><span class="plab">マス</span></div><button class="pbtn" id="adjustPixel">${ic('pixel')}ドットで描く</button></div>
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

export function color_pop(): string {
  return `
  <div class="inkSample"><span id="colorPreview" aria-hidden="true"></span><div><b>いまのいろ</b><span id="colorPreviewLabel"></span></div></div>
  <div class="paltabs">
    <button class="ptab" id="palTab_0">スタンダード</button>
    <button class="ptab" id="palTab_1">DSi</button>
    <button class="ptab" id="palTab_2">3DS</button>
  </div>
  <div class="palgrid" id="palGrid"></div>
  <button class="pbtn paperShortcut" id="paperColorBtn">${ic('note')}<span>紙のいろ</span><span id="paperChip" aria-hidden="true"></span></button>
  <div class="plab">じぶんの色 <span class="phint">(いまの色を＋でとうろく／長押しで削除)</span></div>
  <div class="palgrid" id="custGrid"></div>
  <div class="prow"><input type="color" id="pickIn" title="いろをえらぶ"><input type="text" id="hexIn" maxlength="7" placeholder="#RRGGBB"><button class="pbtn" id="custAdd">＋とうろく</button></div>`
}

export function layer_pop(): string {
  return `<div id="layerRows"></div>
  <div class="photoTools">
    <div class="photoToolsHead">${ic('image')}<span><b>写真レイヤー</b><small>参考画像や下書きを置く</small></span></div>
    <div class="prow tgl3">
      <button class="pbtn primary" id="photoLayerBtn" title="画像を写真レイヤーへ追加">${ic('image')}画像を追加</button>
      <button class="pbtn" id="photoDraftBtn" title="写真レイヤーを下書き表示にする">${ic('eye')}<span>下書き35%</span></button>
      <button class="pbtn warn" id="photoClearBtn" title="いまのコマの写真を消去">${ic('trash')}写真を消去</button>
    </div>
  </div>
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

