import { esc, ic, query, toast } from '../dom'
import { effect_apply, effect_capture, effect_preview, type EffectCapture } from '../effect'
import { EFFECT_DEFS, EF_BLUR, MODE_NORMAL, TRANSITION_DEFS, TR_FADE } from '../h'
import { canvas_make, clamp } from '../lib'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { transition_insert } from '../trans'
import { modal_close, modal_open } from './modal'

let efKind = EF_BLUR
let efAmt = 0.5
let efScratch: HTMLCanvasElement | null = null
let efScratchCtx: CanvasRenderingContext2D | null = null

function ef_preview_draw(box: HTMLElement, capture: EffectCapture | null): void {
  const cv = box.querySelector('#efPrev') as HTMLCanvasElement
  const x = cv.getContext('2d') as CanvasRenderingContext2D
  const res = effect_preview(efKind, efAmt, capture)
  x.clearRect(0, 0, cv.width, cv.height)
  if (!res) return
  if (!efScratch || efScratch.width !== res.reg.w || efScratch.height !== res.reg.h) {
    const [c, ctx] = canvas_make(res.reg.w, res.reg.h)
    efScratch = c
    efScratchCtx = ctx
  }
  const scratchContext = efScratchCtx as CanvasRenderingContext2D
  scratchContext.putImageData(res.img, 0, 0)
  const sc = Math.min(cv.width / res.reg.w, cv.height / res.reg.h)
  const dw = res.reg.w * sc
  const dh = res.reg.h * sc
  x.imageSmoothingEnabled = true
  x.fillStyle = '#ffffff'
  x.fillRect(0, 0, cv.width, cv.height)
  x.drawImage(efScratch, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh)
}

export function modal_effect(): void {
  const g = st()
  if (g.doc.mode !== MODE_NORMAL) {
    toast('エフェクトはノーマルモード専用だよ')
    return
  }
  let btns = ''
  for (const d of EFFECT_DEFS) btns += '<button class="efb" id="efb_' + d.id + '" data-ef="' + d.id + '" title="' + d.desc + '">' + ic(d.icon) + '<span>' + d.label + '</span></button>'
  const box = modal_open(
    '<div class="mhead">' + ic('effect') + 'エフェクト</div>' +
    '<div class="mbody dim">' + (g.sel.has ? '選択範囲' : 'いまのレイヤー全体') + 'にかかります</div>' +
    '<div class="efgrid">' + btns + '</div>' +
    '<div class="mrow rng"><span class="rlab">つよさ</span><input type="range" id="efAmtR" min="0" max="100" step="5" value="' + Math.round(efAmt * 100) + '"><b class="rval" id="efAmtV">' + Math.round(efAmt * 100) + '</b></div>' +
    '<canvas id="efPrev" width="280" height="180" class="efprev"></canvas>' +
    '<div class="mrow end"><button class="mbtn" id="efNo">やめる</button><button class="mbtn primary" id="efGo">かける</button></div>',
    1
  )
  const sync_btns = () => {
    for (const d of EFFECT_DEFS) (box.querySelector('#efb_' + d.id) as HTMLElement).classList.toggle('on', efKind === d.id)
  }
  const capture = effect_capture(320)
  let previewRaf = 0
  const preview = (): void => {
    if (previewRaf) return
    previewRaf = requestAnimationFrame(() => {
      previewRaf = 0
      if (box.isConnected) ef_preview_draw(box, capture)
    })
  }
  sync_btns()
  ef_preview_draw(box, capture)
  box.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.efb') as HTMLElement | null
    if (!b) return
    efKind = Number(b.dataset.ef)
    sync_btns()
    preview()
    sfx_play('tap')
  })
  const ar = box.querySelector('#efAmtR') as HTMLInputElement
  ar.addEventListener('input', () => {
    efAmt = clamp(Number(ar.value) / 100, 0, 1)
    query(box, '#efAmtV').textContent = ar.value
    preview()
  })
  query(box, '#efNo').addEventListener('click', modal_close)
  query(box, '#efGo').addEventListener('click', () => {
    modal_close()
    effect_apply(efKind, efAmt)
  })
}

let trKind = TR_FADE
let trSteps = 3

export function modal_transition(): void {
  const g = st()
  if (g.doc.mode !== MODE_NORMAL) {
    toast('トランジションはノーマルモード専用だよ')
    return
  }
  let btns = ''
  for (const d of TRANSITION_DEFS) btns += '<button class="trb" id="trb_' + d.id + '" data-tr="' + d.id + '">' + esc(d.label) + '</button>'
  const box = modal_open(
    '<div class="mhead">' + ic('transition') + 'トランジション</div>' +
    '<div class="mbody dim">いまのコマ（' + (g.doc.cur + 1) + '）と次のコマの間に、中間のコマを自動で作って入れます。<br><b>この操作は「もどす」できません</b>。</div>' +
    '<div class="trgrid">' + btns + '</div>' +
    '<div class="mrow rng"><span class="rlab">枚数</span><input type="range" id="trStepsR" min="1" max="12" step="1" value="' + trSteps + '"><b class="rval" id="trStepsV">' + trSteps + '枚</b></div>' +
    '<div class="mrow end"><button class="mbtn" id="trNo">やめる</button><button class="mbtn primary" id="trGo">入れる</button></div>',
    1
  )
  const sync_btns = () => {
    for (const d of TRANSITION_DEFS) (box.querySelector('#trb_' + d.id) as HTMLElement).classList.toggle('on', trKind === d.id)
  }
  sync_btns()
  box.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.trb') as HTMLElement | null
    if (!b) return
    trKind = Number(b.dataset.tr)
    sync_btns()
    sfx_play('tap')
  })
  const sr = box.querySelector('#trStepsR') as HTMLInputElement
  sr.addEventListener('input', () => {
    trSteps = clamp(Math.round(Number(sr.value)), 1, 12)
    query(box, '#trStepsV').textContent = trSteps + '枚'
  })
  query(box, '#trNo').addEventListener('click', modal_close)
  query(box, '#trGo').addEventListener('click', () => {
    modal_close()
    dispatch('flo.cancel', null)
    dispatch('sel.clear', null)
    transition_insert(trKind, trSteps)
  })
}

