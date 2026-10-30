import { esc, ic, query, toast } from '../dom'
import { fonts_list, font_import } from '../font'
import { text_render } from '../gfx'
import { clamp, file_pick } from '../lib'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { modal_close } from './modal'
import { sheet_open } from './sheet'
import { switch_row } from './templates/parts'

// もじの設定は、次にもじを入れるときも引きつぐ。
let txt_bold = 1
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

// もじを入れる画面。bx, by は紙の上の置く場所。
export function modal_text(bx: number, by: number): void {
  const box = sheet_open({
    icon: 'text',
    title: 'もじを入れる',
    pages: [{
      id: 'text',
      icon: 'text',
      label: 'もじ',
      body: `<section class="opt"><textarea id="m_txt" class="mtxt" rows="3" placeholder="ここに入力…"></textarea></section>
        <section class="opt">
          <div class="opt_row"><label class="plab" for="m_txt_font">フォント</label><select id="m_txt_font">${font_opts()}</select><button class="pbtn" id="m_txt_font_add">${ic('plus')}取込</button></div>
          <div class="opt_row"><label class="plab" for="m_txt_size">大きさ</label><input type="range" id="m_txt_size" min="12" max="140" value="36"><output id="m_txt_size_v">36</output></div>
        </section>
        <section class="opt">
          ${switch_row('m_txt_bold', 'text', 'ふとい')}
          ${switch_row('m_txt_vert', 'flipv', 'たて書き')}
          ${switch_row('m_txt_out', 'outline', 'ふくろ文字')}
          <div class="opt_row"><label class="plab" for="m_txt_ow">フチの太さ</label><input type="range" id="m_txt_ow" min="1" max="14" step="1" value="${txt_ow}"><output id="m_txt_owv">${txt_ow}</output><input type="color" id="m_txt_o_color" value="${txt_o_color}" title="フチの色"></div>
        </section>`,
    }],
    actions: '<button class="pbtn" id="m_no">やめる</button><button class="pbtn primary" id="m_ok">配置する</button>',
  })
  const ta = query<HTMLTextAreaElement>(box, '#m_txt')
  const size = query<HTMLInputElement>(box, '#m_txt_size')
  const outline_width = query<HTMLInputElement>(box, '#m_txt_ow')
  const outline_color = query<HTMLInputElement>(box, '#m_txt_o_color')
  const font = query<HTMLSelectElement>(box, '#m_txt_font')
  if (txt_fam) font.value = txt_fam
  const toggles: [string, () => number, (v: number) => void][] = [
    ['m_txt_bold', () => txt_bold, v => { txt_bold = v }],
    ['m_txt_vert', () => txt_vert, v => { txt_vert = v }],
    ['m_txt_out', () => txt_out, v => { txt_out = v }],
  ]
  for (const [id, value, set] of toggles) {
    const button = query(box, '#' + id)
    button.setAttribute('aria-pressed', String(!!value()))
    button.addEventListener('click', () => {
      set(value() ? 0 : 1)
      button.setAttribute('aria-pressed', String(!!value()))
    })
  }
  query(box, '#m_txt_font_add').addEventListener('click', () => {
    file_pick('.ttf,.otf,.woff,.woff2', f =>
      font_import(f, ok => {
        if (!ok) return
        const list = fonts_list()
        txt_fam = list[list.length - 1].family
        font.innerHTML = font_opts()
        font.value = txt_fam
        toast('フォントを取り込んだよ（このセッションの間つかえます）')
      })
    )
  })
  ta.focus()
  size.addEventListener('input', () => { query(box, '#m_txt_size_v').textContent = size.value })
  outline_width.addEventListener('input', () => { query(box, '#m_txt_owv').textContent = outline_width.value })
  query(box, '#m_no').addEventListener('click', () => modal_close())
  query(box, '#m_ok').addEventListener('click', () => {
    const text = ta.value.replace(/\s+$/, '')
    txt_o_color = outline_color.value
    txt_ow = clamp(Math.round(Number(outline_width.value)), 1, 14)
    txt_fam = font.value
    modal_close()
    if (!text) return
    const px = Number(size.value)
    const place = () => {
      const c = text_render(text, px, txt_bold, st().pen.color, txt_out, txt_o_color, txt_ow, txt_vert, txt_fam)
      dispatch('flo.begin_image', { canvas: c, kind: 3, x: bx, y: by, continuous: 0 })
    }
    if (txt_fam) document.fonts.load((txt_bold ? '700' : '400') + ' ' + px + 'px "' + txt_fam + '"').then(place, place)
    else place()
  })
}
