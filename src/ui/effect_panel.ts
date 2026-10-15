import { esc, ic, query, toast } from '../dom'
import { effect_apply, effect_capture, effect_preview, type effect_capture_t } from '../effect'
import { effect_defs, ef_blur, mode_normal, transition_defs, tr_fade } from '../h'
import { canvas_make, clamp } from '../lib'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { transition_insert } from '../trans'
import { modal_close, modal_open } from './modal'

let ef_kind = ef_blur
let ef_amt = 0.5
let ef_scratch: HTMLCanvasElement | null = null
let ef_scratch_ctx: CanvasRenderingContext2D | null = null

function ef_preview_draw(box: HTMLElement, capture: effect_capture_t | null): void {
  const cv = box.querySelector('#ef_prev') as HTMLCanvasElement
  const x = cv.getContext('2d') as CanvasRenderingContext2D
  const res = effect_preview(ef_kind, ef_amt, capture)
  x.clearRect(0, 0, cv.width, cv.height)
  if (!res) return
  if (!ef_scratch || ef_scratch.width !== res.reg.w || ef_scratch.height !== res.reg.h) {
    const [c, ctx] = canvas_make(res.reg.w, res.reg.h)
    ef_scratch = c
    ef_scratch_ctx = ctx
  }
  const scratch_context = ef_scratch_ctx as CanvasRenderingContext2D
  scratch_context.putImageData(res.img, 0, 0)
  const sc = Math.min(cv.width / res.reg.w, cv.height / res.reg.h)
  const dw = res.reg.w * sc
  const dh = res.reg.h * sc
  x.imageSmoothingEnabled = true
  x.fillStyle = '#ffffff'
  x.fillRect(0, 0, cv.width, cv.height)
  x.drawImage(ef_scratch, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh)
}

export function modal_effect(): void {
  const g = st()
  if (g.doc.mode !== mode_normal) {
    toast('エフェクトはノーマルモード専用だよ')
    return
  }
  let btns = ''
  for (const d of effect_defs) btns += '<button class="efb" id="efb_' + d.id + '" data-ef="' + d.id + '" title="' + d.desc + '">' + ic(d.icon) + '<span>' + d.label + '</span></button>'
  const box = modal_open(
    '<div class="mhead">' + ic('effect') + 'エフェクト</div>' +
    '<div class="mbody dim">' + (g.sel.has ? '選択範囲' : 'いまのレイヤー全体') + 'にかかります</div>' +
    '<div class="efgrid">' + btns + '</div>' +
    '<div class="mrow rng"><span class="rlab">つよさ</span><input type="range" id="ef_amt_r" min="0" max="100" step="5" value="' + Math.round(ef_amt * 100) + '"><b class="rval" id="ef_amt_v">' + Math.round(ef_amt * 100) + '</b></div>' +
    '<canvas id="ef_prev" width="280" height="180" class="efprev"></canvas>' +
    '<div class="mrow end"><button class="mbtn" id="ef_no">やめる</button><button class="mbtn primary" id="ef_go">かける</button></div>',
    1
  )
  const sync_btns = () => {
    for (const d of effect_defs) (box.querySelector('#efb_' + d.id) as HTMLElement).classList.toggle('on', ef_kind === d.id)
  }
  const capture = effect_capture(320)
  let preview_raf = 0
  const preview = (): void => {
    if (preview_raf) return
    preview_raf = requestAnimationFrame(() => {
      preview_raf = 0
      if (box.isConnected) ef_preview_draw(box, capture)
    })
  }
  sync_btns()
  ef_preview_draw(box, capture)
  box.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.efb') as HTMLElement | null
    if (!b) return
    ef_kind = Number(b.dataset.ef)
    sync_btns()
    preview()
    sfx_play('tap')
  })
  const ar = box.querySelector('#ef_amt_r') as HTMLInputElement
  ar.addEventListener('input', () => {
    ef_amt = clamp(Number(ar.value) / 100, 0, 1)
    query(box, '#ef_amt_v').textContent = ar.value
    preview()
  })
  query(box, '#ef_no').addEventListener('click', modal_close)
  query(box, '#ef_go').addEventListener('click', () => {
    modal_close()
    effect_apply(ef_kind, ef_amt)
  })
}

let tr_kind = tr_fade
let tr_steps = 3

export function modal_transition(): void {
  const g = st()
  if (g.doc.mode !== mode_normal) {
    toast('トランジションはノーマルモード専用だよ')
    return
  }
  let btns = ''
  for (const d of transition_defs) btns += '<button class="trb" id="trb_' + d.id + '" data-tr="' + d.id + '">' + esc(d.label) + '</button>'
  const box = modal_open(
    '<div class="mhead">' + ic('transition') + 'トランジション</div>' +
    '<div class="mbody dim">いまのコマ（' + (g.doc.cur + 1) + '）と次のコマの間に、中間のコマを自動で作って入れます。<br><b>この操作は「もどす」できません</b>。</div>' +
    '<div class="trgrid">' + btns + '</div>' +
    '<div class="mrow rng"><span class="rlab">枚数</span><input type="range" id="tr_steps_r" min="1" max="12" step="1" value="' + tr_steps + '"><b class="rval" id="tr_steps_v">' + tr_steps + '枚</b></div>' +
    '<div class="mrow end"><button class="mbtn" id="tr_no">やめる</button><button class="mbtn primary" id="tr_go">入れる</button></div>',
    1
  )
  const sync_btns = () => {
    for (const d of transition_defs) (box.querySelector('#trb_' + d.id) as HTMLElement).classList.toggle('on', tr_kind === d.id)
  }
  sync_btns()
  box.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.trb') as HTMLElement | null
    if (!b) return
    tr_kind = Number(b.dataset.tr)
    sync_btns()
    sfx_play('tap')
  })
  const sr = box.querySelector('#tr_steps_r') as HTMLInputElement
  sr.addEventListener('input', () => {
    tr_steps = clamp(Math.round(Number(sr.value)), 1, 12)
    query(box, '#tr_steps_v').textContent = tr_steps + '枚'
  })
  query(box, '#tr_no').addEventListener('click', modal_close)
  query(box, '#tr_go').addEventListener('click', () => {
    modal_close()
    dispatch('flo.cancel', null)
    dispatch('sel.clear', null)
    transition_insert(tr_kind, tr_steps)
  })
}

