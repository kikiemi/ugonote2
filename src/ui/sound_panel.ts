import { tr_line, tr_dom } from '../lang'
import { doc_compose } from '../doc'
import { esc, ic, pressed, query } from '../dom'
import { se_labels } from '../h'
import { clamp } from '../lib'
import { dispatch } from '../state/commands/index'
import { anim_playing } from '../state/commands/play'
import { st } from '../state/store'
import { modal_close, modal_open } from './modal'
import { anim_stop } from './playback'

function mixer_cell_update(button: HTMLElement, frame: number, track: number): void {
  const on = !!(st().doc.frames[frame].se & (1 << track))
  pressed(button, on)
  button.setAttribute('aria-label', tr_line((frame + 1) + 'コマ目・音' + (track + 1) + (on ? 'を鳴らす・タップで外す' : 'を追加')))
  button.innerHTML = ic(on ? 'check' : 'plus') + '<span>' + tr_line(on ? '鳴らす' : '追加') + '</span>'
}

export function modal_mixer(track = -1): void {
  if (anim_playing()) anim_stop()
  const g = st()
  const n = g.doc.frames.length
  const page_size = 50
  const page_count = Math.ceil(n / page_size)
  let page = Math.floor(g.doc.cur / page_size)
  let head = '<div class="mixhead"><span class="mixno">コマ</span>'
  for (let k = 0; k < 4; k++) {
    head += '<span class="mixse' + (track === k ? ' selected' : '') + '">音 ' + (k + 1) + '<em>' + esc(g.snd.se[k].name ? (se_labels[g.snd.se[k].name] || g.snd.se[k].name) : '未登録') + '</em></span>'
  }
  head += '</div>'
  const box = modal_open(
    '<div class="mhead">' + ic('sound') + '<span>音を鳴らすコマ</span></div>' +
    '<div class="mix_toolbar"><div class="mix_jump"><label for="mix_goto">コマへ</label><input type="number" id="mix_goto" min="1" max="' + n + '" value="' + (g.doc.cur + 1) + '"><span>/ ' + n + '</span><button class="pbtn" id="mix_go">移動</button></div>' +
    (page_count > 1 ? '<div class="mix_pages"><button class="pbtn" id="mix_prev">前へ</button><span class="dim" id="mix_page"></span><button class="pbtn" id="mix_next">次へ</button></div>' : '') +
    '</div><div class="mixbody" id="mix_rows"></div>' +
    '<div class="mrow end"><button class="pbtn" id="m_ok">とじる</button></div>',
    1
  )
  box.classList.add('sound_assignment')
  const rows = query(box, '#mix_rows')
  const frame_focus = (): void => {
    for (const row of rows.querySelectorAll<HTMLElement>('.mixrow')) row.classList.toggle('cur', Number(row.dataset.frame) === g.doc.cur)
    query<HTMLInputElement>(box, '#mix_goto').value = String(g.doc.cur + 1)
    const current = rows.querySelector<HTMLElement>('.mixrow.cur')
    if (current) {
      const top = current.getBoundingClientRect().top - rows.getBoundingClientRect().top
      rows.scrollTop += top - query(rows, '.mixhead').getBoundingClientRect().height
    }
  }
  const render_page = (): void => {
    const start = page * page_size
    const end = Math.min(n, start + page_size)
    let html = head
    for (let i = start; i < end; i++) {
      html += '<div class="mixrow" data-frame="' + i + '"><button class="mix_frame" data-mix-frame="' + i + '" aria-label="' + (i + 1) + 'コマ目を見る"><canvas width="60" height="40"></canvas><span>' + (i + 1) + '</span></button>'
      for (let k = 0; k < 4; k++) html += '<button class="mixc' + (track === k ? ' selected' : '') + '" data-i="' + i + '" data-k="' + k + '"></button>'
      html += '</div>'
    }
    rows.innerHTML = html
    tr_dom(rows)
    for (const button of rows.querySelectorAll<HTMLElement>('.mixc')) mixer_cell_update(button, Number(button.dataset.i), Number(button.dataset.k))
    for (const button of rows.querySelectorAll<HTMLElement>('.mix_frame')) {
      const cv = button.querySelector('canvas')!
      cv.height = Math.max(1, Math.round(cv.width * g.doc.h / g.doc.w))
      doc_compose(Number(button.dataset.mixFrame), cv.getContext('2d')!, cv.width, cv.height, 1)
    }
    rows.scrollTop = 0
    frame_focus()
    if (page_count <= 1) return
    query(box, '#mix_page').textContent = start + 1 + '〜' + end + ' / ' + n
    query<HTMLButtonElement>(box, '#mix_prev').disabled = page <= 0
    query<HTMLButtonElement>(box, '#mix_next').disabled = page >= page_count - 1
  }
  const jump = (): void => {
    const value = Number(query<HTMLInputElement>(box, '#mix_goto').value)
    if (!Number.isFinite(value)) return
    const frame = clamp(Math.round(value) - 1, 0, n - 1)
    dispatch('frame.goto', frame)
    page = Math.floor(frame / page_size)
    render_page()
  }
  render_page()
  query(box, '#m_ok').addEventListener('click', () => modal_close())
  query(box, '#mix_go').addEventListener('click', jump)
  query(box, '#mix_goto').addEventListener('keydown', event => {
    if (event.key === 'Enter') jump()
  })
  if (page_count > 1) {
    query(box, '#mix_prev').addEventListener('click', () => {
      if (page <= 0) return
      page--
      render_page()
    })
    query(box, '#mix_next').addEventListener('click', () => {
      if (page >= page_count - 1) return
      page++
      render_page()
    })
  }
  rows.addEventListener('click', event => {
    const target = event.target as HTMLElement
    const button = target.closest<HTMLElement>('button.mixc')
    if (button) {
      const frame = Number(button.dataset.i)
      const track = Number(button.dataset.k)
      dispatch('frame.se_toggle', { i: frame, bit: track })
      mixer_cell_update(button, frame, track)
      return
    }
    const frame_button = target.closest<HTMLElement>('button.mix_frame')
    if (!frame_button) return
    dispatch('frame.goto', Number(frame_button.dataset.mixFrame))
    frame_focus()
  })
}

