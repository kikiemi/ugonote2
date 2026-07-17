import { report_warning } from '../diagnostics'
import { esc, ic, q, query, toast } from '../dom'
import { fonts_list, font_import } from '../font'
import { text_render } from '../gfx'
import { tr_html } from '../lang'
import { clamp, file_pick } from '../lib'
import { dispatch } from '../state/commands/index'
import { anim_playing } from '../state/commands/play'
import { st } from '../state/store'
import { anim_stop } from './playback'

let modalOn = 0
let modalCleanup: (() => void) | null = null

function release_modal_resources(): void {
  const cleanup = modalCleanup
  modalCleanup = null
  if (!cleanup) return
  try {
    cleanup()
  } catch (error) {
    report_warning('モーダルの一時リソースを解放できませんでした', error)
  }
}

export function modal_active(): number {
  return modalOn
}

export function modal_set_cleanup(cleanup: () => void): void {
  release_modal_resources()
  modalCleanup = cleanup
}

export function modal_close(): void {
  release_modal_resources()
  q('modalRoot').innerHTML = ''
  modalOn = 0
}

export function modal_open(boxHtml: string, dismissable: number): HTMLElement {
  release_modal_resources()
  boxHtml = tr_html(boxHtml)
  const root = q('modalRoot')
  root.innerHTML = '<div class="mback"><div class="mbox">' + boxHtml + '</div></div>'
  modalOn = 1
  const back = root.firstElementChild as HTMLElement
  if (dismissable) {
    back.addEventListener('pointerdown', e => {
      if (e.target === back) modal_close()
    })
  }
  return back.firstElementChild as HTMLElement
}

export function modal_prompt_num(title: string, body: string, init: number, min: number, max: number, cb: (v: number) => void): void {
  const box = modal_open(
    '<div class="mhead">' + esc(title) + '</div>' +
    '<p class="mbody">' + esc(body) + '</p>' +
    '<div class="mrow"><input type="number" class="numin" style="width:110px;font-size:20px;text-align:center" id="mNum" min="' + min + '" max="' + max + '" step="1" value="' + init + '"></div>' +
    '<div class="mrow" style="justify-content:flex-end"><button class="mbtn" id="mCancel">やめる</button><button class="mbtn primary" id="mOk">OK</button></div>',
    1
  )
  const input = box.querySelector('#mNum') as HTMLInputElement
  input.focus()
  input.select()
  const done = (ok: number): void => {
    const value = clamp(Math.round(Number(input.value)), min, max)
    modal_close()
    if (ok && Number.isFinite(value)) cb(value)
  }
  query(box, '#mOk').addEventListener('click', () => done(1))
  query(box, '#mCancel').addEventListener('click', () => done(0))
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') done(1)
  })
}

export function modal_confirm(title: string, body: string, okLabel: string, cb: () => void): void {
  const box = modal_open(
    '<div class="mhead">' + ic('warn') + '<span>' + esc(title) + '</span></div>' +
    '<p class="mbody">' + body + '</p>' +
    '<div class="mrow end"><button class="mbtn" id="mNo">やめる</button><button class="mbtn primary" id="mOk">' + esc(okLabel) + '</button></div>',
    1
  )
  query(box, '#mNo').addEventListener('click', () => modal_close())
  query(box, '#mOk').addEventListener('click', () => {
    modal_close()
    cb()
  })
}

export function modal_progress(title: string): { set: (p: number) => void, close: () => void, note: (s: string) => void } {
  const box = modal_open(
    '<div class="mhead">' + ic('gear') + '<span>' + esc(title) + '</span></div>' +
    '<div class="pbar"><div class="pfill" id="pFill"></div></div>' +
    '<p class="mbody dim" id="pNote">準備中…</p>',
    0
  )
  const fill = box.querySelector('#pFill') as HTMLElement
  const note = box.querySelector('#pNote') as HTMLElement
  return {
    set: p => {
      fill.style.width = Math.round(clamp(p, 0, 1) * 100) + '%'
    },
    note: s => {
      note.textContent = s
    },
    close: () => modal_close(),
  }
}

export function modal_goto(): void {
  const g = st()
  const n = g.doc.frames.length
  const box = modal_open(
    '<div class="mhead">' + ic('goto') + '<span>コマ移動</span></div>' +
    '<div class="mrow"><input type="number" id="mGotoN" min="1" max="' + n + '" value="' + (g.doc.cur + 1) + '" class="mnum"><span class="dim">/ ' + n + '</span></div>' +
    '<div class="mrow end"><button class="mbtn primary" id="mOk">移動</button></div>',
    1
  )
  const inp = box.querySelector('#mGotoN') as HTMLInputElement
  inp.focus()
  inp.select()
  const go = () => {
    const v = clamp(Math.round(Number(inp.value) || 1) - 1, 0, n - 1)
    modal_close()
    if (anim_playing()) anim_stop()
    dispatch('frame.goto', v)
  }
  query(box, '#mOk').addEventListener('click', go)
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') go()
  })
}

export function modal_addmany(): void {
  const box = modal_open(
    '<div class="mhead">' + ic('many') + '<span>まとめて追加</span></div>' +
    '<div class="mrow"><input type="number" id="mManyN" min="1" max="200" value="8" class="mnum"><span class="dim">コマ</span></div>' +
    '<div class="mrow end"><button class="mbtn primary" id="mOk">追加</button></div>',
    1
  )
  const inp = box.querySelector('#mManyN') as HTMLInputElement
  inp.focus()
  inp.select()
  const go = () => {
    const v = clamp(Math.round(Number(inp.value) || 1), 1, 200)
    modal_close()
    dispatch('frame.add_many', v)
  }
  query(box, '#mOk').addEventListener('click', go)
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') go()
  })
}

let txtVert = 0

let txtOut = 0

let txtOColor = '#FFFFFF'

let txtOW = 4

let txtFam = ''

function font_opts(): string {
  let o = '<option value="">まるゴシック（標準）</option>'
  o += '<option value="sans-serif">ゴシック</option><option value="serif">明朝</option><option value="monospace">等幅</option>'
  for (const f of fonts_list()) o += '<option value="' + f.family + '"' + (txtFam === f.family ? ' selected' : '') + '>' + esc(f.name) + '</option>'
  return o
}

export function modal_text(bx: number, by: number): void {
  const box = modal_open(
    '<div class="mhead">' + ic('text') + '<span>もじを入れる</span></div>' +
    '<textarea id="mTxt" rows="3" placeholder="ここに入力…"></textarea>' +
    '<div class="mrow"><span class="rlab">フォント</span><select id="mTxtFont">' + font_opts() + '</select><button class="mbtn sm" id="mTxtFontAdd">＋取込</button></div>' +
    '<label class="mrow rng"><span class="rlab">大きさ</span><input type="range" id="mTxtSize" min="12" max="140" value="36"><span class="rval" id="mTxtSizeV">36</span></label>' +
    '<div class="mrow">' +
    '<button class="tgl on" id="mTxtBold">' + ic('text') + '<span>ふとい</span></button>' +
    '<button class="tgl' + (txtVert ? ' on' : '') + '" id="mTxtVert">' + ic('flipv') + '<span>たて書き</span></button>' +
    '</div>' +
    '<div class="mrow">' +
    '<button class="tgl' + (txtOut ? ' on' : '') + '" id="mTxtOut">' + ic('outline') + '<span>ふくろ文字</span></button>' +
    '<input type="color" id="mTxtOColor" value="' + txtOColor + '" title="フチの色">' +
    '<input type="range" id="mTxtOW" min="1" max="14" step="1" value="' + txtOW + '"><b class="rval" id="mTxtOWV">' + txtOW + '</b>' +
    '</div>' +
    '<div class="mrow end"><button class="mbtn" id="mNo">やめる</button><button class="mbtn primary" id="mOk">配置する</button></div>',
    1
  )
  const ta = box.querySelector('#mTxt') as HTMLTextAreaElement
  const sz = box.querySelector('#mTxtSize') as HTMLInputElement
  const szv = box.querySelector('#mTxtSizeV') as HTMLElement
  const bold = box.querySelector('#mTxtBold') as HTMLElement
  const vert = box.querySelector('#mTxtVert') as HTMLElement
  const out = box.querySelector('#mTxtOut') as HTMLElement
  const oc = box.querySelector('#mTxtOColor') as HTMLInputElement
  const ow = box.querySelector('#mTxtOW') as HTMLInputElement
  const owv = box.querySelector('#mTxtOWV') as HTMLElement
  const fsel = box.querySelector('#mTxtFont') as HTMLSelectElement
  if (txtFam) fsel.value = txtFam
  query(box, '#mTxtFontAdd').addEventListener('click', () => {
    file_pick('.ttf,.otf,.woff,.woff2', f =>
      font_import(f, ok => {
        if (!ok) return
        const fl = fonts_list()
        txtFam = fl[fl.length - 1].family
        fsel.innerHTML = font_opts()
        fsel.value = txtFam
        toast('フォントを取り込んだよ（このセッションの間つかえます）')
      })
    )
  })
  ta.focus()
  sz.addEventListener('input', () => {
    szv.textContent = sz.value
  })
  ow.addEventListener('input', () => {
    owv.textContent = ow.value
  })
  bold.addEventListener('click', () => bold.classList.toggle('on'))
  vert.addEventListener('click', () => vert.classList.toggle('on'))
  out.addEventListener('click', () => out.classList.toggle('on'))
  query(box, '#mNo').addEventListener('click', () => modal_close())
  query(box, '#mOk').addEventListener('click', () => {
    const text = ta.value.replace(/\s+$/, '')
    txtVert = vert.classList.contains('on') ? 1 : 0
    txtOut = out.classList.contains('on') ? 1 : 0
    txtOColor = oc.value
    txtOW = clamp(Math.round(Number(ow.value)), 1, 14)
    txtFam = fsel.value
    modal_close()
    if (!text) return
    const doPlace = () => {
      const c = text_render(text, Number(sz.value), bold.classList.contains('on') ? 1 : 0, st().pen.color, txtOut, txtOColor, txtOW, txtVert, txtFam)
      dispatch('flo.begin_image', { canvas: c, kind: 3, x: bx, y: by, continuous: 0 })
    }
    if (txtFam) {
      const w = bold.classList.contains('on') ? '700' : '400'
      document.fonts.load(w + ' ' + Number(sz.value) + 'px "' + txtFam + '"').then(doPlace, doPlace)
    } else doPlace()
  })
}

export function modal_is_open(): number {
  return modalOn
}
