import { esc, ic, query, toast } from '../dom'
import { effect_apply, effect_capture, effect_preview, type effect_capture_t } from '../effect'
import { effect_defs, ef_blur, mode_normal, transition_defs, tr_fade } from '../h'
import { canvas_make, clamp } from '../lib'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { transition_insert } from '../trans'
import { modal_close } from './modal'
import { sheet_open } from './sheet'

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
    toast('エフェクトはノーマルモード専用です')
    return
  }
  const buttons = effect_defs.map(d => `<button class="act" data-ef="${d.id}" title="${d.desc}" aria-pressed="false">${ic(d.icon)}<span>${d.label}</span></button>`).join('')
  const box = sheet_open({
    icon: 'effect',
    title: '絵のエフェクト',
    preview: `<canvas id="ef_prev" width="280" height="180"></canvas><div class="sheet_caption">${g.sel.has ? '選択範囲' : 'いまのレイヤー全体'}</div>`,
    pages: [
      {
        id: 'effect',
        icon: 'effect',
        label: 'エフェクト',
        body: `<section class="opt">
          <div class="acts" id="ef_kinds">${buttons}</div>
          <div class="opt_row"><label class="plab" for="ef_amt">つよさ</label><input type="range" id="ef_amt" min="0" max="100" step="5"><output id="ef_amt_v"></output></div>
        </section>`,
      },
    ],
    actions: '<button class="pbtn primary" id="ef_go">かける</button>',
  })
  const amount = query<HTMLInputElement>(box, '#ef_amt')
  const capture = effect_capture(320)
  let preview_raf = 0
  const sync = (): void => {
    for (const button of box.querySelectorAll<HTMLElement>('[data-ef]')) button.setAttribute('aria-pressed', String(Number(button.dataset.ef) === ef_kind))
    amount.value = String(Math.round(ef_amt * 100))
    query(box, '#ef_amt_v').textContent = amount.value
  }
  const preview = (): void => {
    if (preview_raf) return
    preview_raf = requestAnimationFrame(() => {
      preview_raf = 0
      if (box.isConnected) ef_preview_draw(box, capture)
    })
  }
  sync()
  ef_preview_draw(box, capture)
  query(box, '#ef_kinds').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-ef]')
    if (!button) return
    ef_kind = Number(button.dataset.ef)
    sync()
    preview()
    sfx_play('tap')
  })
  amount.addEventListener('input', () => {
    ef_amt = clamp(Number(amount.value) / 100, 0, 1)
    sync()
    preview()
  })
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
    toast('コマをつなぐのはノーマルモード専用です')
    return
  }
  const buttons = transition_defs.map(d => `<button data-tr="${d.id}" aria-pressed="false">${esc(d.label)}</button>`).join('')
  const box = sheet_open({
    icon: 'transition',
    title: 'コマをつなぐ',
    pages: [
      {
        id: 'transition',
        icon: 'transition',
        label: 'つなぎ方',
        body: `<section class="opt">
          <div class="opt_head"><b>${g.doc.cur + 1} → ${g.doc.cur + 2}</b></div>
          <div class="seg wrap" id="tr_kinds">${buttons}</div>
          <div class="opt_row"><label class="plab" for="tr_steps">枚数</label><input type="range" id="tr_steps" min="1" max="12" step="1"><output id="tr_steps_v"></output></div>
        </section>`,
      },
    ],
    actions: '<span class="sheet_note">この操作はもどせません</span><button class="pbtn primary" id="tr_go">入れる</button>',
  })
  const steps = query<HTMLInputElement>(box, '#tr_steps')
  const sync = (): void => {
    for (const button of box.querySelectorAll<HTMLElement>('[data-tr]')) button.setAttribute('aria-pressed', String(Number(button.dataset.tr) === tr_kind))
    steps.value = String(tr_steps)
    query(box, '#tr_steps_v').textContent = tr_steps + '枚'
  }
  sync()
  query(box, '#tr_kinds').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-tr]')
    if (!button) return
    tr_kind = Number(button.dataset.tr)
    sync()
    sfx_play('tap')
  })
  steps.addEventListener('input', () => {
    tr_steps = clamp(Math.round(Number(steps.value)), 1, 12)
    sync()
  })
  query(box, '#tr_go').addEventListener('click', () => {
    modal_close()
    dispatch('flo.cancel', null)
    dispatch('sel.clear', null)
    transition_insert(tr_kind, tr_steps)
  })
}
