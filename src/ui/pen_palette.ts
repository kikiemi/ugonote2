import { brush_spacing, tip_get } from '../brush'
import { q } from '../dom'
import { mask_make } from '../gfx'
import { brush_defs, mode_normal, type pen_t } from '../h'
import { hex_rgb } from '../lib'
import { tr_line } from '../lang'
import { native_pen_mask } from '../nativepen'
import { native_pen_tips, n_brush, n_outline, native_pen_tip, pen_quick_sizes } from '../penprofile'
import { pref_theme } from '../prefs'
import type { deep_ro_t } from '../state/store'

export function pen_quick_html(mode: number, tool: number): string {
  const sizes = pen_quick_sizes(mode, tool)
  let html = ''
  for (let i = 0; i < sizes.length; i++) {
    const n = sizes[i]
    html += '<button data-quick-size="' + n + '" aria-label="' + tr_line('ふとさ ' + n) + '" aria-pressed="false"><span style="width:' + Math.min(n, 18) + 'px;height:' + Math.min(n, 18) + 'px"></span><b>' + n + '</b></button>'
  }
  return html
}

export function native_pen_html(): string {
  let html = '<div id="native_pen_options" hidden><div class="native_pen_head"><span>ペン先</span><button class="tgl" id="native_pen_expand" aria-pressed="false">拡張</button></div><div class="brushgrid native_pen_grid" id="native_pen_grid">'
  for (const tip of native_pen_tips) html += '<button class="brushb" id="native_pen_' + tip.id + '" data-native-tip="' + tip.id + '" title="' + tip.label + '"><canvas width="28" height="28" data-native-preview="' + tip.id + '"></canvas><span>' + tip.label + '</span></button>'
  return html + '<button class="brushb" id="native_pen_font" title="文字"><b class="native_font">A</b><span>文字</span></button></div></div>'
}

function native_preview(cv: HTMLCanvasElement, id: number, ink: string): void {
  if (cv.dataset.ink === ink) return
  const tip = native_pen_tip(id)
  const m = mask_make(28, 28)
  const line = tip.shape === n_brush || tip.shape === n_outline
  native_pen_mask(m, { ...tip, size: Math.min(18, tip.size) }, line ? 7.5 : 14.5, line ? 17.5 : 14.5, line ? 20.5 : 14.5, line ? 10.5 : 14.5)
  const x = cv.getContext('2d')!
  const img = x.createImageData(28, 28)
  const rgb = hex_rgb(ink)
  for (let i = 0; i < m.b.length; i++) {
    if (!m.b[i]) continue
    img.data[i * 4] = rgb[0]
    img.data[i * 4 + 1] = rgb[1]
    img.data[i * 4 + 2] = rgb[2]
    img.data[i * 4 + 3] = 255
  }
  x.putImageData(img, 0, 0)
  cv.dataset.ink = ink
}

export function pen_palette_render(p: deep_ro_t<pen_t>, mode: number): void {
  const quick = q('quick_sizes')
  const sizes = pen_quick_sizes(mode, p.tool).join(',')
  if (quick.dataset.sizes !== sizes) {
    quick.innerHTML = pen_quick_html(mode, p.tool)
    quick.dataset.sizes = sizes
  }
  for (const b of quick.querySelectorAll<HTMLElement>('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.quickSize) === p.size))
  q('quick_size_value').textContent = p.size + ' px'
  const native = mode !== mode_normal
  const ink = pref_theme() ? '#EDF0F7' : '#343746'
  q('normal_pen_grid').hidden = native
  q('native_pen_options').hidden = !native
  q('native_pen_expand').setAttribute('aria-pressed', String(p.native_tip >= 8))
  q('native_pen_expand').textContent = p.native_tip >= 8 ? '基本に戻す' : '拡張'
  for (const tip of native_pen_tips) {
    const button = q('native_pen_' + tip.id)
    button.hidden = (tip.id >= 8) !== (p.native_tip >= 8)
    button.classList.toggle('on', p.native_tip === tip.id)
    button.setAttribute('aria-pressed', String(p.native_tip === tip.id))
    if (native && !button.hidden) native_preview(button.querySelector('canvas')!, tip.id, ink)
  }
  for (const b of brush_defs) {
    const button = q('brush_' + b.id)
    button.classList.toggle('on', p.brush === b.id)
    button.setAttribute('aria-pressed', String(p.brush === b.id))
    if (native) continue
    const cv = button.querySelector('canvas')!
    if (cv.dataset.drawn === ink) continue
    const tip = tip_get(b.id, 6, ink, 0)
    const x = cv.getContext('2d')!
    x.clearRect(0, 0, cv.width, cv.height)
    for (let n = 6; n < 58; n += brush_spacing(b.id, 6)) x.drawImage(tip, n - tip.width / 2, 14 + Math.sin(n / 9) * 5 - tip.height / 2)
    cv.dataset.drawn = ink
  }
}
