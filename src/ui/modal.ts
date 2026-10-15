import { report_warning } from '../diagnostics'
import { esc, focus_cycle, ic, q, query, toast } from '../dom'
import { fonts_list, font_import } from '../font'
import { text_render } from '../gfx'
import { tr_html } from '../lang'
import { clamp, file_pick } from '../lib'
import { mode_frame_limit } from '../mode'
import { dispatch } from '../state/commands/index'
import { anim_playing } from '../state/commands/play'
import { st } from '../state/store'
import { anim_stop } from './playback'

let modal_on = 0
let modal_cleanup: (() => void) | null = null
let modal_focus: HTMLElement | null = null
let modal_inert: { element: HTMLElement, previous: boolean }[] = []
export function modal_background_inert(element: HTMLElement, inert: boolean): void {
  const entry = modal_inert.find(item => item.element === element)
  if (modal_on && entry) {
    entry.previous = inert
    element.inert = true
  } else element.inert = inert
}

function release_modal_resources(): void {
  const cleanup = modal_cleanup
  modal_cleanup = null
  if (!cleanup) return
  try {
    cleanup()
  } catch (error) {
    report_warning('モーダルの一時リソースを解放できませんでした', error)
  }
}

export function modal_active(): number {
  return modal_on
}

export function modal_set_cleanup(cleanup: () => void): void {
  release_modal_resources()
  modal_cleanup = cleanup
}

export function modal_close(): void {
  release_modal_resources()
  q('modal_root').innerHTML = ''
  modal_on = 0
  for (const entry of modal_inert) entry.element.inert = entry.previous
  modal_inert = []
  if (modal_focus?.isConnected && !modal_focus.closest('[inert]')) modal_focus.focus({ preventScroll: true })
  modal_focus = null
}

export function modal_open(box_html: string, dismissable: number): HTMLElement {
  release_modal_resources()
  box_html = tr_html(box_html)
  const root = q('modal_root')
  if (!modal_on) {
    modal_focus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    modal_inert = []
    for (const element of Array.from(root.parentElement?.children || [])) {
      if (!(element instanceof HTMLElement) || element === root) continue
      modal_inert.push({ element, previous: element.inert })
      element.inert = true
    }
  }
  root.innerHTML = '<div class="mback"><div class="mbox">' + box_html + '</div></div>'
  modal_on = 1
  const back = root.firstElementChild as HTMLElement
  if (dismissable) {
    back.addEventListener('pointerdown', e => {
      if (e.target === back) modal_close()
    })
  }
  const box = back.firstElementChild as HTMLElement
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('tabindex', '-1')
  box.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      modal_close()
      return
    }
    focus_cycle(box, event)
  })
  const first = box.querySelector<HTMLElement>('button,input,select,textarea')
  ;(first || box).focus({ preventScroll: true })
  return box
}

export function modal_prompt_num(title: string, body: string, init: number, min: number, max: number, cb: (v: number) => void): void {
  const box = modal_open(
    '<div class="mhead">' + esc(title) + '</div>' +
    '<p class="mbody">' + esc(body) + '</p>' +
    '<div class="mrow"><input type="number" class="numin" style="width:110px;font-size:20px;text-align:center" id="m_num" min="' + min + '" max="' + max + '" step="1" value="' + init + '"></div>' +
    '<div class="mrow" style="justify-content:flex-end"><button class="mbtn" id="m_cancel">やめる</button><button class="mbtn primary" id="m_ok">OK</button></div>',
    1
  )
  const input = box.querySelector('#m_num') as HTMLInputElement
  input.focus()
  input.select()
  const done = (ok: number): void => {
    const value = clamp(Math.round(Number(input.value)), min, max)
    modal_close()
    if (ok && Number.isFinite(value)) cb(value)
  }
  query(box, '#m_ok').addEventListener('click', () => done(1))
  query(box, '#m_cancel').addEventListener('click', () => done(0))
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') done(1)
  })
}

export function modal_confirm(title: string, body: string, ok_label: string, cb: () => void): void {
  const box = modal_open(
    '<div class="mhead">' + ic('warn') + '<span>' + esc(title) + '</span></div>' +
    '<p class="mbody">' + body + '</p>' +
    '<div class="mrow end"><button class="mbtn" id="m_no">やめる</button><button class="mbtn primary" id="m_ok">' + esc(ok_label) + '</button></div>',
    1
  )
  query(box, '#m_no').addEventListener('click', () => modal_close())
  query(box, '#m_ok').addEventListener('click', () => {
    modal_close()
    cb()
  })
}

export function modal_progress(title: string): { set: (p: number) => void, close: () => void, note: (s: string) => void } {
  const box = modal_open(
    '<div class="mhead">' + ic('gear') + '<span>' + esc(title) + '</span></div>' +
    '<div class="pbar"><div class="pfill" id="p_fill"></div></div>' +
    '<p class="mbody dim" id="p_note">準備中…</p>',
    0
  )
  const fill = box.querySelector('#p_fill') as HTMLElement
  const note = box.querySelector('#p_note') as HTMLElement
  return {
    set: p => {
      fill.style.width = Math.round(clamp(p, 0, 1) * 100) + '%'
    },
    note: s => {
      note.textContent = s
    },
    close: () => { if (box.isConnected) modal_close() },
  }
}

export function modal_goto(): void {
  const g = st()
  const n = g.doc.frames.length
  const box = modal_open(
    '<div class="mhead">' + ic('goto') + '<span>コマ移動</span></div>' +
    '<div class="mrow"><input type="number" id="m_goto_n" min="1" max="' + n + '" value="' + (g.doc.cur + 1) + '" class="mnum"><span class="dim">/ ' + n + '</span></div>' +
    '<div class="mrow end"><button class="mbtn primary" id="m_ok">移動</button></div>',
    1
  )
  const inp = box.querySelector('#m_goto_n') as HTMLInputElement
  inp.focus()
  inp.select()
  const go = () => {
    const v = clamp(Math.round(Number(inp.value) || 1) - 1, 0, n - 1)
    modal_close()
    if (anim_playing()) anim_stop()
    dispatch('frame.goto', v)
  }
  query(box, '#m_ok').addEventListener('click', go)
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') go()
  })
}

export function modal_addmany(): void {
  const limit = mode_frame_limit(st().doc.mode)
  const room = Math.max(0, limit - st().doc.frames.length)
  if (!room) {
    toast('これ以上コマを増やせないよ（最大' + limit + '）')
    return
  }
  let presets = ''
  for (const count of [10, 100, 999]) presets += '<button class="mbtn sm" data-add-count="' + count + '"' + (count > room ? ' disabled' : '') + '>' + count + '枚</button>'
  const box = modal_open(
    '<div class="mhead">' + ic('many') + '<span>まとめて追加</span></div>' +
    '<div class="mrow"><label for="m_many_n">追加する枚数</label><input type="number" id="m_many_n" min="1" max="' + room + '" step="1" value="' + Math.min(8, room) + '" class="mnum" required><span class="dim">コマ</span></div>' +
    '<div class="mrow">' + presets + '</div>' +
    '<p class="phint">あと' + room + 'コマ追加できます（合計 最大' + limit + 'コマ）</p>' +
    '<div class="mrow end"><button class="mbtn" id="m_cancel">やめる</button><button class="mbtn primary" id="m_ok">追加</button></div>',
    1
  )
  const inp = box.querySelector('#m_many_n') as HTMLInputElement
  inp.focus()
  inp.select()
  const go = () => {
    if (!inp.reportValidity()) return
    const v = Number(inp.value)
    modal_close()
    dispatch('frame.add_many', v)
  }
  query(box, '#m_ok').addEventListener('click', go)
  query(box, '#m_cancel').addEventListener('click', modal_close)
  for (const button of box.querySelectorAll<HTMLElement>('[data-add-count]')) button.addEventListener('click', () => { inp.value = button.dataset.addCount || '1'; inp.focus(); inp.select() })
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') go()
  })
}

let txt_vert = 0

let txt_out = 0

let txt_o_color = '#FFFFFF'

let txt_ow = 4

let txt_fam = ''

function font_opts(): string {
  let o = '<option value="">まるゴシック（標準）</option>'
  o += '<option value="sans-serif">ゴシック</option><option value="serif">明朝</option><option value="monospace">等幅</option>'
  for (const f of fonts_list()) o += '<option value="' + f.family + '"' + (txt_fam === f.family ? ' selected' : '') + '>' + esc(f.name) + '</option>'
  return o
}

export function modal_text(bx: number, by: number): void {
  const box = modal_open(
    '<div class="mhead">' + ic('text') + '<span>もじを入れる</span></div>' +
    '<textarea id="m_txt" rows="3" placeholder="ここに入力…"></textarea>' +
    '<div class="mrow"><span class="rlab">フォント</span><select id="m_txt_font">' + font_opts() + '</select><button class="mbtn sm" id="m_txt_font_add">＋取込</button></div>' +
    '<label class="mrow rng"><span class="rlab">大きさ</span><input type="range" id="m_txt_size" min="12" max="140" value="36"><span class="rval" id="m_txt_size_v">36</span></label>' +
    '<div class="mrow">' +
    '<button class="tgl on" id="m_txt_bold">' + ic('text') + '<span>ふとい</span></button>' +
    '<button class="tgl' + (txt_vert ? ' on' : '') + '" id="m_txt_vert">' + ic('flipv') + '<span>たて書き</span></button>' +
    '</div>' +
    '<div class="mrow">' +
    '<button class="tgl' + (txt_out ? ' on' : '') + '" id="m_txt_out">' + ic('outline') + '<span>ふくろ文字</span></button>' +
    '<input type="color" id="m_txt_o_color" value="' + txt_o_color + '" title="フチの色">' +
    '<input type="range" id="m_txt_ow" min="1" max="14" step="1" value="' + txt_ow + '"><b class="rval" id="m_txt_owv">' + txt_ow + '</b>' +
    '</div>' +
    '<div class="mrow end"><button class="mbtn" id="m_no">やめる</button><button class="mbtn primary" id="m_ok">配置する</button></div>',
    1
  )
  const ta = box.querySelector('#m_txt') as HTMLTextAreaElement
  const sz = box.querySelector('#m_txt_size') as HTMLInputElement
  const szv = box.querySelector('#m_txt_size_v') as HTMLElement
  const bold = box.querySelector('#m_txt_bold') as HTMLElement
  const vert = box.querySelector('#m_txt_vert') as HTMLElement
  const out = box.querySelector('#m_txt_out') as HTMLElement
  const oc = box.querySelector('#m_txt_o_color') as HTMLInputElement
  const ow = box.querySelector('#m_txt_ow') as HTMLInputElement
  const owv = box.querySelector('#m_txt_owv') as HTMLElement
  const fsel = box.querySelector('#m_txt_font') as HTMLSelectElement
  if (txt_fam) fsel.value = txt_fam
  query(box, '#m_txt_font_add').addEventListener('click', () => {
    file_pick('.ttf,.otf,.woff,.woff2', f =>
      font_import(f, ok => {
        if (!ok) return
        const fl = fonts_list()
        txt_fam = fl[fl.length - 1].family
        fsel.innerHTML = font_opts()
        fsel.value = txt_fam
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
  query(box, '#m_no').addEventListener('click', () => modal_close())
  query(box, '#m_ok').addEventListener('click', () => {
    const text = ta.value.replace(/\s+$/, '')
    txt_vert = vert.classList.contains('on') ? 1 : 0
    txt_out = out.classList.contains('on') ? 1 : 0
    txt_o_color = oc.value
    txt_ow = clamp(Math.round(Number(ow.value)), 1, 14)
    txt_fam = fsel.value
    modal_close()
    if (!text) return
    const do_place = () => {
      const c = text_render(text, Number(sz.value), bold.classList.contains('on') ? 1 : 0, st().pen.color, txt_out, txt_o_color, txt_ow, txt_vert, txt_fam)
      dispatch('flo.begin_image', { canvas: c, kind: 3, x: bx, y: by, continuous: 0 })
    }
    if (txt_fam) {
      const w = bold.classList.contains('on') ? '700' : '400'
      document.fonts.load(w + ' ' + Number(sz.value) + 'px "' + txt_fam + '"').then(do_place, do_place)
    } else do_place()
  })
}

export function modal_is_open(): number {
  return modal_on
}
