import { esc, ic, q, query } from './dom'
import { tr_html } from './lang'
import { storage_get, storage_set } from './storage'
import { modal_confirm } from './ui/modal'

type Step = { id: string, drawer?: number, title: string, body: string }

const STEPS: Step[] = [
  { id: 'stageWrap', title: 'ようこそ！', body: 'ここがキャンバス。指やペンでそのまま描けるよ。2本指でズームと移動。' },
  { id: 'railTools', title: 'どうぐ', body: 'スマホは下のドック、PCは左のバー。ペンをもう一度タップすると、ペンの種類（大きな筆先えらび）と太さが出るよ。' },
  { id: 'optBtn', title: 'せってい', body: 'グリッドの大きさ・オニオンの枚数・テーマ・筆箱（初級/上級）はここ。むずかしければ初級筆箱にしてみてね。' },
  { id: 'colorBtn', title: 'いろ', body: 'ここでパレットを開く。「＋とうろく」でじぶんの色も保存できる。' },
  { id: 'layerBtn', title: 'レイヤー', body: 'A・B・Cの3枚＋写真レイヤー。順番の入れかえや透けぐあいもここ。' },
  { id: 'playBtn', title: '再生', body: '▶で動かしてみよう。スペースキーでもOK。となりはループとA-B区間ループ。' },
  { id: 'fs', title: 'タイムライン', body: 'コマの一覧。タップで移動、長おしでつかんで並べかえ。右クリックでメニューも。' },
  { id: 'addBtn', title: 'コマ追加', body: '＋で新しいコマ。オニオンスキン（右上）でまえのコマがうっすら見えるよ。' },
  { id: 'holdBtn', title: 'ホールド', body: 'このコマを何コマぶん見せるか。タメをつくるのに便利！［ ］キーでも変えられる。' },
  { id: 'abBtn', title: 'A-Bループ', body: '気になるところだけくり返し再生。コマを右クリック→「ここからループA」でも設定できるよ。' },
  { id: 'exportBtn', drawer: 1, title: '書き出し', body: 'GIF・MP4・WebMのほか、うごメモのKWZ/PPMにも書き出せる！' },
  { id: 'tutBtn', title: 'おしまい！', body: 'また見たくなったらここから。たのしんで描いてね〜' },
]

let cur = -1

function tut_root(): HTMLElement {
  return q('tutRoot')
}

const MOBILE_ALT: { [k: string]: string } = { railTools: 'dockMain', tl_0: 'dockMain', optBtn: 'hdSettings' }

function step_target_id(id: string): string {
  if (innerWidth <= 720 && MOBILE_ALT[id]) return MOBILE_ALT[id]
  return id
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
  q('drawer').classList.toggle('on', on)
  q('scrim').classList.toggle('on', false)
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
  q('drawer').classList.remove('on')
  storage_set('ug2_tut', '1')
  window.removeEventListener('resize', place)
}

export function tut_start(): void {
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
  modal_confirm('はじめまして！', 'うごくノート2へようこそ。<br>1分ちょっとの「つかいかた」を見る？（あとで右上からも見られるよ）', '見る！', tut_start)
}
