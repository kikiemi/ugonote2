import { esc, ic, q, query } from './dom'
import { tr_html } from './lang'
import { storage_get, storage_set } from './storage'
import { modal_confirm } from './ui/modal'
import { drawer_set, pop_close, rail_sheet } from './ui/overlay'
import { dispatch } from './state/commands/index'
import { st } from './state/store'
import { home_group_show } from './ui/home'
import { workspace_focus_set } from './ui/workspace_input'

type Step = { id: string, drawer?: number, title: string, body: string }

const STEPS: Step[] = [
  { id: 'stageWrap', title: '描くところ', body: 'ふちの内側が作品の用紙です。指・ペン・マウスで描けます。2本指で拡大・移動、全体で元の表示に戻せます。' },
  { id: 'railTools', title: 'どうぐをえらぶ', body: 'PC・タブレットはペン・範囲・投げ縄・ドットを右の道具から直接選べます。「画像」で写真も取り込めます。スマホは「道具」にまとまっています。' },
  { id: 'sizeBtn', title: 'ペンの設定', body: 'ペンをもう一度押すと、種類・太さ・もようが選べます。太さは丸い見本か数字で変更。描き始めると設定が閉じます。' },
  { id: 'colorBtn', title: 'いろと紙', body: '色見本を押して描く色を選びます。「紙のいろ」は用紙の色。「＋とうろく」で自分の色を残せます。' },
  { id: 'layerBtn', title: '重ねて描く', body: 'A・Bなどのレイヤーを押して描く紙を切り替えます。＋で写真・透かし具合・追加を設定。うごメモモードでは実機の枚数になります。' },
  { id: 'onionBtn', title: '前の絵を透かす', body: '「前の絵」で前後それぞれ10枚まで透かせます。前だけ・後だけの表示や、直前・直後を省く設定も選べます。' },
  { id: 'fs', title: 'コマ一覧', body: 'コマを押して切り替え、長押しでつかんで並べ替えます。コピー・消すは上のボタンから。右端の「とじる」で一覧を閉じます。' },
  { id: 'addBtn', title: '次の絵をつくる', body: '「追加」で新しいコマ、「コピー」で今の絵を複製します。下の矢印で前後へ、端の矢印で最初・最後のコマへ移れます。' },
  { id: 'playBtn', title: 'うごかしてみる', body: '▶で再生・停止。PCはスペースキーでも操作できます。はやさ・表示時間・ループはコマ一覧から設定します。' },
  { id: 'mixerBtn', drawer: 1, title: '音をつける', body: '「音をつける」で曲や効果音を取り込みます。「音を鳴らすコマ」でタイミングを選び、再生に合わせた録音もできます。' },
  { id: 'exportBtn', drawer: 1, title: '保存と書き出し', body: '「この作品を保存」で続きが描けるノートに。動画・画像・KWZ・PPMへは「動画・うごメモにする」から書き出します。' },
  { id: 'menuBtn', title: 'いつでもここから', body: '新しい作品・ファイルを開く・さくひん設定はメニューにあります。ガイドは「せってい」→「使い方を見てみる」からもう一度見られます。' },
]

let cur = -1
let timelineRestore = 0
let focusRestore = false

function tut_root(): HTMLElement {
  return q('tutRoot')
}

const MOBILE_ALT: Record<string, string> = { railTools: 'dockMore', sizeBtn: 'dockSize', colorBtn: 'dockColor', onionBtn: 'onionBtn' }

function step_target_id(id: string): string {
  const candidates = id === 'railTools' ? ['mobileTools', 'dockMore'] : id === 'onionBtn' ? ['onionBtn'] : [id, MOBILE_ALT[id]]
  for (const candidate of candidates) {
    const element = candidate ? document.getElementById(candidate) : null
    if (element && getComputedStyle(element).visibility !== 'hidden' && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0) return candidate
  }
  return 'menuBtn'
}

function place(): void {
  const s = STEPS[cur]
  const root = tut_root()
  const spot = root.querySelector('.tspot') as HTMLElement
  const card = root.querySelector('.tcard') as HTMLElement
  const target = document.getElementById(step_target_id(s.id))
  const r = target ? target.getBoundingClientRect() : { left: innerWidth / 2 - 40, top: innerHeight / 2 - 40, width: 80, height: 80 }
  const pad = 8
  spot.style.left = r.left - pad + 'px'
  spot.style.top = r.top - pad + 'px'
  spot.style.width = r.width + pad * 2 + 'px'
  spot.style.height = r.height + pad * 2 + 'px'
  if (innerWidth <= 720) {
    card.style.width = innerWidth - 20 + 'px'
    card.style.left = '10px'
    const cardH = card.offsetHeight || 170
    const bottomTop = innerHeight - cardH - 12
    if (r.top + r.height > bottomTop - 8) {
      card.style.top = '12px'
    } else {
      card.style.top = bottomTop + 'px'
    }
    return
  }
  const cw = Math.min(340, innerWidth - 24)
  card.style.width = cw + 'px'
  const below = r.top + r.height + 16
  const cardH = card.offsetHeight || 150
  let top = below
  if (below + cardH > innerHeight - 12) top = Math.max(12, r.top - cardH - 16)
  top = Math.max(12, Math.min(top, innerHeight - cardH - 12))
  let left = r.left + r.width / 2 - cw / 2
  left = Math.max(12, Math.min(left, innerWidth - cw - 12))
  card.style.left = left + 'px'
  card.style.top = top + 'px'
}

function drawer_for(step: Step): void {
  const on = step.drawer ? true : false
  if (q('drawer').classList.contains('on') !== on) drawer_set(on ? 1 : 0)
  if (on) home_group_show(step.id === 'mixerBtn' ? 'sound' : 'files')
  if (step.id === 'fs' && !st().view.tlopen) dispatch('view.set_timeline_open', 1)
  const target = document.getElementById(step_target_id(step.id))
  if (target?.closest('#rail')) target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  q('scrim').classList.remove('on')
}

function render(): void {
  const s = STEPS[cur]
  drawer_for(s)
  const root = tut_root()
  root.innerHTML = tr_html(
    '<div class="tdim"></div>' +
    '<div class="tspot"></div>' +
    '<div class="tcard">' +
    '<div class="tstep">' + (cur + 1) + ' / ' + STEPS.length + '</div>' +
    '<div class="tttl">' + ic('spark') + '<span>' + esc(s.title) + '</span></div>' +
    '<p class="tbody">' + esc(s.body) + '</p>' +
    '<div class="trow">' +
    '<button class="mbtn sm" id="tEnd">おわる</button><span class="tspacer"></span>' +
    (cur > 0 ? '<button class="mbtn sm" id="tPrev">まえへ</button>' : '') +
    '<button class="mbtn sm primary" id="tNext">' + (cur === STEPS.length - 1 ? 'はじめる！' : 'つぎへ') + '</button>' +
    '</div></div>')
  query(root, '#tEnd').addEventListener('click', tut_end)
  const prev = root.querySelector('#tPrev') as HTMLElement | null
  if (prev) prev.addEventListener('click', () => go(cur - 1))
  query(root, '#tNext').addEventListener('click', () => {
    if (cur === STEPS.length - 1) tut_end()
    else go(cur + 1)
  })
  query<HTMLElement>(root, '.tdim').style.zIndex = '80'
  query<HTMLElement>(root, '.tspot').style.zIndex = '81'
  query<HTMLElement>(root, '.tcard').style.zIndex = '82'
  requestAnimationFrame(place)
  requestAnimationFrame(() => requestAnimationFrame(place))
}

function go(i: number): void {
  cur = Math.max(0, Math.min(STEPS.length - 1, i))
  render()
}

function tut_end(): void {
  cur = -1
  tut_root().innerHTML = ''
  drawer_set(0)
  dispatch('view.set_timeline_open', timelineRestore)
  if (focusRestore) workspace_focus_set(true)
  storage_set('ug2_tut', '1')
  window.removeEventListener('resize', place)
}

export function tut_start(): void {
  if (cur < 0) {
    timelineRestore = st().view.tlopen
    focusRestore = document.body.dataset.focus === '1'
  }
  if (focusRestore) workspace_focus_set(false)
  pop_close()
  rail_sheet(0)
  window.addEventListener('resize', place)
  go(0)
}

export function tut_mount(): void {
  q('tutBtn').addEventListener('click', tut_start)
  q('tutBtn2').addEventListener('click', tut_start)
}

export function tut_offer(): void {
  if (storage_get('ug2_tut')) return
  storage_set('ug2_tut', '1')
  modal_confirm('はじめまして！', '作品ができました。<br>今の画面で「つかいかた」を見る？<br>あとからメニューの「せってい」でも見られます。', '見る！', tut_start)
}
