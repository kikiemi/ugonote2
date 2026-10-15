import { esc, ic, q, query } from './dom'
import { tr_html } from './lang'
import { storage_get, storage_set } from './storage'
import { modal_confirm } from './ui/modal'
import { drawer_set, pop_close, rail_sheet } from './ui/overlay'
import { dispatch } from './state/commands/index'
import { st } from './state/store'
import { home_group_show } from './ui/home'
import { workspace_focus_set } from './ui/workspace_input'

type step_t = { id: string, drawer?: number, title: string, body: string }

const steps: step_t[] = [
  { id: 'layout_choices', title: '編集画面をえらぶ', body: 'シンプルは用紙を広く、スタジオはPC・タブレットで色・太さとコマ一覧を直接操作できます。作品は同じまま、いつでも切り替えられます。' },
  { id: 'stage_wrap', title: '描くところ', body: 'ふちの内側が作品の用紙です。指・ペン・マウスで描けます。2本指で拡大・移動、全体で元の表示に戻せます。' },
  { id: 'rail_tools', title: 'どうぐをえらぶ', body: 'ペン・範囲・投げ縄・ドットは道具一覧から選べます。「画像」で写真も取り込めます。「道具箱」の「絵の変形」に反転・回転・拡大縮小、「表示」に方眼・透かし、「便利機能」にうごきアシストなどがあります。' },
  { id: 'tool_settings_btn', title: 'ペンの設定', body: '選択中の道具をもう一度押すか、道具箱の「道具設定」で種類・太さ・もようを選びます。「線・効果」に縁取りがあります。小さい画面で描画中に操作を隠す設定は「せってい」で変更できます。' },
  { id: 'color_btn', title: 'いろと紙', body: '色見本を押して描く色を選びます。「紙のいろ」は用紙の色。「＋とうろく」で自分の色を残せます。' },
  { id: 'layer_btn', title: '重ねて描く', body: 'A・Bなどのレイヤーを押して描く紙を切り替えます。「レイヤー」で写真・透かし具合・追加を設定。うごメモモードでは実機の枚数になります。' },
  { id: 'onion_btn', title: '前の絵を透かす', body: 'コマ一覧の「みえかた」で前後の絵を透かせます。スマホ縦向きでは「前の絵」からも開けます。' },
  { id: 'fs', title: 'コマ一覧', body: 'コマを押して切り替え、長押しでつかんで並べ替えます。コピー・消すは上のボタンから。右端の「とじる」で一覧を閉じます。' },
  { id: 'add_btn', title: '次の絵をつくる', body: '「追加」で新しいコマ、「コピー」で今の絵を複製します。下の矢印で前後へ、端の矢印で最初・最後のコマへ移れます。' },
  { id: 'play_btn', title: 'うごかしてみる', body: '▶で再生・停止。PCはスペースキーでも操作できます。はやさ・表示時間・ループはコマ一覧から設定します。' },
  { id: 'mixer_btn', drawer: 1, title: '音をつける', body: '「音をつける」で曲や効果音を取り込みます。「音を鳴らすコマ」でタイミングを選び、再生に合わせた録音もできます。' },
  { id: 'export_btn', drawer: 1, title: '保存と書き出し', body: '「この作品を保存」で続きが描けるノートに。動画・画像・KWZ・PPMへは「書き出す」から進みます。「動画を取り込む」では映像と音声を一緒に読み込めます。' },
  { id: 'menu_btn', title: 'いつでもここから', body: '新しい作品・ファイルを開く・さくひん設定はメニューにあります。メニューの「使い方」から、このガイドをもう一度見られます。' },
]

let cur = -1
let timeline_restore = 0
let focus_restore = false

function tut_root(): HTMLElement {
  return q('tut_root')
}

const mobile_alt: Record<string, string> = { rail_tools: 'dock_more', tool_settings_btn: 'dock_settings', color_btn: 'dock_color', onion_btn: 'onion_btn' }

function step_target_id(id: string): string {
  const candidates = id === 'rail_tools' ? ['mobile_tools', 'dock_more'] : id === 'onion_btn' ? ['onion_btn', 'view_btn'] : [id, mobile_alt[id]]
  for (const candidate of candidates) {
    const element = candidate ? document.getElementById(candidate) : null
    if (element && getComputedStyle(element).visibility !== 'hidden' && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0) return candidate
  }
  return 'menu_btn'
}

function place(): void {
  const s = steps[cur]
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
    const card_h = card.offsetHeight || 170
    const bottom_top = innerHeight - card_h - 12
    if (r.top + r.height > bottom_top - 8) {
      card.style.top = '12px'
    } else {
      card.style.top = bottom_top + 'px'
    }
    return
  }
  const cw = Math.min(340, innerWidth - 24)
  card.style.width = cw + 'px'
  const below = r.top + r.height + 16
  const card_h = card.offsetHeight || 150
  let top = below
  if (below + card_h > innerHeight - 12) top = Math.max(12, r.top - card_h - 16)
  top = Math.max(12, Math.min(top, innerHeight - card_h - 12))
  let left = r.left + r.width / 2 - cw / 2
  left = Math.max(12, Math.min(left, innerWidth - cw - 12))
  card.style.left = left + 'px'
  card.style.top = top + 'px'
}

function drawer_for(step: step_t): void {
  const on = step.drawer ? true : false
  if (q('drawer').classList.contains('on') !== on) drawer_set(on ? 1 : 0)
  if (on) home_group_show(step.id === 'mixer_btn' ? 'sound' : 'files')
  if ((step.id === 'fs' || step.id === 'onion_btn') && !st().view.tlopen) dispatch('view.set_timeline_open', 1)
  const target = document.getElementById(step_target_id(step.id))
  if (target?.closest('#rail')) target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  q('scrim').classList.remove('on')
}

function render(): void {
  const s = steps[cur]
  drawer_for(s)
  const root = tut_root()
  root.innerHTML = tr_html(
    '<div class="tdim"></div>' +
    '<div class="tspot"></div>' +
    '<div class="tcard">' +
    '<div class="tstep">' + (cur + 1) + ' / ' + steps.length + '</div>' +
    '<div class="tttl">' + ic('spark') + '<span>' + esc(s.title) + '</span></div>' +
    '<p class="tbody">' + esc(s.body) + '</p>' +
    '<div class="trow">' +
    '<button class="mbtn sm" id="t_end">おわる</button><span class="tspacer"></span>' +
    (cur > 0 ? '<button class="mbtn sm" id="t_prev">まえへ</button>' : '') +
    '<button class="mbtn sm primary" id="t_next">' + (cur === steps.length - 1 ? 'はじめる！' : 'つぎへ') + '</button>' +
    '</div></div>')
  query(root, '#t_end').addEventListener('click', tut_end)
  const prev = root.querySelector('#t_prev') as HTMLElement | null
  if (prev) prev.addEventListener('click', () => go(cur - 1))
  query(root, '#t_next').addEventListener('click', () => {
    if (cur === steps.length - 1) tut_end()
    else go(cur + 1)
  })
  query<HTMLElement>(root, '.tdim').style.zIndex = '80'
  query<HTMLElement>(root, '.tspot').style.zIndex = '81'
  query<HTMLElement>(root, '.tcard').style.zIndex = '82'
  requestAnimationFrame(place)
  requestAnimationFrame(() => requestAnimationFrame(place))
}

function go(i: number): void {
  cur = Math.max(0, Math.min(steps.length - 1, i))
  render()
}

function tut_end(): void {
  cur = -1
  tut_root().innerHTML = ''
  drawer_set(0)
  dispatch('view.set_timeline_open', timeline_restore)
  if (focus_restore) workspace_focus_set(true)
  storage_set('ug2_tut', '1')
  window.removeEventListener('resize', place)
}

export function tut_start(): void {
  if (cur < 0) {
    timeline_restore = st().view.tlopen
    focus_restore = document.body.dataset.focus === '1'
  }
  if (focus_restore) workspace_focus_set(false)
  pop_close()
  rail_sheet(0)
  window.addEventListener('resize', place)
  go(0)
}

export function tut_mount(): void {
  q('tut_btn').addEventListener('click', tut_start)
  q('tut_btn2').addEventListener('click', tut_start)
  q('menu_help').addEventListener('click', tut_start)
}

export function tut_offer(): void {
  if (storage_get('ug2_tut')) return
  storage_set('ug2_tut', '1')
  modal_confirm('はじめまして！', '作品ができました。<br>今の画面で「つかいかた」を見る？<br>あとからメニューの「使い方」でも見られます。', '見る！', tut_start)
}
