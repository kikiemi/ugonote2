import { kwz_canvas_h, kwz_canvas_w } from '../codec/kwzgeom'
import { ppm_h, ppm_w } from '../codec/ppm'
import { report_warning } from '../diagnostics'
import { doc_frame_new } from '../doc'
import { esc, query, toast } from '../dom'
import { color_hex, kwz_colors, ppm_colors, rgba_word } from '../flipnote/color'
import type { flip_image_format_t, flip_image_result_t } from '../flipnote/image'
import { mode_3_d, mode_dsi, note_meta_zero, type frame_t } from '../h'
import { lang, tr } from '../lang'
import { canvas_make, clamp, file_pick, rle_unpack } from '../lib'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { convert_flip_image_async } from '../workercli'
import { modal_export } from './export_ui'
import { image_file_decode, type image_file_source_t } from './image_file'
import { modal_close, modal_set_cleanup } from './modal'
import { sheet_open } from './sheet'

// 色の名前。PPM と KWZ で色の並びがちがう (PPM の3番は青、KWZ の3番は黄)。
const color_names: Record<flip_image_format_t, string[]> = { ppm: ['白', '黒', '赤', '青'], kwz: ['白', '黒', '赤', '黄', '緑', '青'] }

function paper_options(format: flip_image_format_t, selected: number): string {
  let options = '<option value="-1">' + tr('画像から自動') + '</option>'
  const colors = format === 'ppm' ? ppm_colors.slice(0, 2) : kwz_colors
  for (let index = 0; index < colors.length; index++) {
    const name = tr(color_names[format][index])
    options += '<option value="' + index + '"' + (selected === index ? ' selected' : '') + '>' + name + '</option>'
  }
  return options
}

function format_size(format: flip_image_format_t): [number, number] {
  return format === 'ppm' ? [ppm_w, ppm_h] : [kwz_canvas_w, kwz_canvas_h]
}

function source_pixels(source: image_file_source_t, format: flip_image_format_t, fit: string): Uint8ClampedArray {
  const [width, height] = format_size(format)
  const [, context] = canvas_make(width, height, 1)
  context.clearRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  const scale = fit === 'contain' ? Math.min(width / source.width, height / source.height) : Math.max(width / source.width, height / source.height)
  const draw_width = source.width * scale
  const draw_height = source.height * scale
  source.draw(context, (width - draw_width) / 2, (height - draw_height) / 2, draw_width, draw_height)
  return context.getImageData(0, 0, width, height).data
}

function result_frames(result: flip_image_result_t): frame_t[] {
  const frames: frame_t[] = []
  for (const packed of result.frames) {
    const frame = doc_frame_new()
    frame.pk = packed
    frames.push(frame)
  }
  return frames
}

function result_apply(result: flip_image_result_t, name: string): void {
  const mode = result.format === 'ppm' ? mode_dsi : mode_3_d
  const applied = dispatch('project.apply_flip', {
    meta: note_meta_zero(),
    mode,
    w: result.width,
    h: result.height,
    ratio: '4:3',
    res: result.format === 'ppm' ? 'dsi' : '3ds',
    fps: 30,
    loop: 1,
    paper: result.paper_hex,
    frames: result_frames(result),
    cur: 0,
    bgm: null,
    bgm_rate: 0,
    bgm_fps: 0,
    se: [null, null, null, null],
  })
  if (applied < 0) throw new Error('generated Flipnote project was rejected')
  dispatch('doc.set_name', name)
  dispatch('view.set_page', 'canvas')
}

function palette_html(result: flip_image_result_t): string {
  const colors = result.format === 'ppm' ? ppm_colors : kwz_colors
  let html = ''
  for (const index of result.colors) {
    const color = colors[index]
    if (!color) continue
    html += '<span class="fmchip"><i style="background:' + color_hex(color) + '"></i>' + esc(tr(color_names[result.format][index])) + '</span>'
  }
  return html
}

function preview_images(context: CanvasRenderingContext2D, result: flip_image_result_t): ImageData[] {
  const images: ImageData[] = []
  const scratch = new Uint32Array(result.width * result.height)
  const palette = result.format === 'ppm' ? ppm_colors : kwz_colors
  const paper = rgba_word(palette[result.paper])
  for (const frame of result.frames) {
    const image = context.createImageData(result.width, result.height)
    const output = new Uint32Array(image.data.buffer)
    output.fill(paper)
    for (let layer = 3; layer >= 1; layer--) {
      const packed = frame[layer]
      if (!packed) continue
      scratch.fill(0)
      if (rle_unpack(packed, scratch) !== scratch.length) throw new Error('invalid generated preview layer')
      for (let pixel = 0; pixel < output.length; pixel++) if (scratch[pixel] >>> 24) output[pixel] = scratch[pixel]
    }
    images.push(image)
  }
  return images
}

function open_maker(file: File, source: image_file_source_t): void {
  const current_mode = st().doc.mode
  const default_format: flip_image_format_t = current_mode === mode_3_d ? 'kwz' : 'ppm'
  const box = sheet_open({
    icon: 'film',
    title: '画像からうごメモ',
    wide: 1,
    preview: '<canvas id="fm_preview"></canvas><div id="fm_state" class="sheet_caption">変換を準備中…</div><div id="fm_palette" class="fmpalette"></div>',
    pages: [
      {
        id: 'picture',
        icon: 'image',
        label: '絵',
        body: `<section class="opt">
          <div class="opt_row"><label class="plab" for="fm_format">形式</label><select id="fm_format"><option value="ppm">PPM・うごメモ</option><option value="kwz">KWZ・うごメモ3D</option></select></div>
          <div class="opt_row"><label class="plab" for="fm_fit">配置</label><select id="fm_fit"><option value="cover">画面いっぱい</option><option value="contain">画像全体</option></select></div>
          <div class="opt_row"><label class="plab" for="fm_frames">なめらかさ</label><select id="fm_frames"><option value="1">1コマ・静止</option><option value="4">4コマ・軽量</option><option value="8">8コマ・標準</option><option value="16" selected>16コマ・最高</option></select></div>
        </section>`,
      },
      {
        id: 'color',
        icon: 'palette',
        label: '色',
        body: `<section class="opt">
          <div class="opt_row"><label class="plab" for="fm_paper">紙の色</label><select id="fm_paper"></select></div>
          <div class="opt_row"><label class="plab" for="fm_contrast">明暗</label><input type="range" id="fm_contrast" min="70" max="140" value="100"><output id="fm_contrast_v">100</output></div>
          <div class="opt_row"><label class="plab" for="fm_saturation">色の強さ</label><input type="range" id="fm_saturation" min="0" max="160" value="110"><output id="fm_saturation_v">110</output></div>
        </section>`,
      },
    ],
    actions: '<span class="sheet_note">いまのノートは置きかわります</span><button class="pbtn" id="fm_create" disabled>ノートだけ作る</button><button class="pbtn primary" id="fm_export" disabled>作って書き出す…</button>',
  })
  const format_input = query<HTMLSelectElement>(box, '#fm_format')
  const fit_input = query<HTMLSelectElement>(box, '#fm_fit')
  const frames_input = query<HTMLSelectElement>(box, '#fm_frames')
  const paper_input = query<HTMLSelectElement>(box, '#fm_paper')
  const contrast_input = query<HTMLInputElement>(box, '#fm_contrast')
  const saturation_input = query<HTMLInputElement>(box, '#fm_saturation')
  const contrast_value = query<HTMLElement>(box, '#fm_contrast_v')
  const saturation_value = query<HTMLElement>(box, '#fm_saturation_v')
  const state = query<HTMLElement>(box, '#fm_state')
  const palette = query<HTMLElement>(box, '#fm_palette')
  const preview = query<HTMLCanvasElement>(box, '#fm_preview')
  const create = query<HTMLButtonElement>(box, '#fm_create')
  const export_button = query<HTMLButtonElement>(box, '#fm_export')
  format_input.value = default_format
  let closed = 0
  let request = 0
  let debounce = 0
  let animation = 0
  let latest: flip_image_result_t | null = null
  let latest_key = ''
  const source_cache = new Map<string, Uint8ClampedArray>()

  const settings_key = (): string => [format_input.value, fit_input.value, frames_input.value, paper_input.value, contrast_input.value, saturation_input.value].join('|')
  const update_papers = (): void => {
    const selected = paper_input.options.length ? Number(paper_input.value) : -1
    paper_input.innerHTML = paper_options(format_input.value as flip_image_format_t, selected)
    if (![...paper_input.options].some(option => option.value === String(selected))) paper_input.value = '-1'
  }
  const stop_animation = (): void => {
    if (!animation) return
    cancelAnimationFrame(animation)
    animation = 0
  }
  const show_result = (result: flip_image_result_t): void => {
    stop_animation()
    preview.width = result.width
    preview.height = result.height
    const context = preview.getContext('2d') as CanvasRenderingContext2D
    let images: ImageData[]
    try {
      images = preview_images(context, result)
    } catch (error) {
      report_warning('うごメモ変換プレビューを準備できませんでした', error)
      state.textContent = tr('プレビューを準備できませんでした')
      create.disabled = true
      export_button.disabled = true
      return
    }
    context.putImageData(images[0], 0, 0)
    if (images.length > 1) {
      const frame_time = 1000 / 30
      let started = 0
      let last_frame = 0
      const draw = (time: number): void => {
        if (closed) return
        if (!started) started = time
        const frame = Math.floor((time - started) / frame_time) % images.length
        if (frame !== last_frame) {
          context.putImageData(images[frame], 0, 0)
          last_frame = frame
        }
        animation = requestAnimationFrame(draw)
      }
      animation = requestAnimationFrame(draw)
    }
    const ink_names: string[] = []
    if (result.ppm_pens) {
      for (let i = 0; i < result.ppm_pens.length; i++) ink_names.push(tr(color_names.ppm[result.ppm_pens[i]]))
    }
    state.textContent = lang === 'en'
      ? result.width + '×' + result.height + ' · ' + result.frames.length + ' frames · ' + result.colors.length + ' colors' + (ink_names.length ? ' · inks ' + ink_names.join(' + ') : '')
      : result.width + '×' + result.height + '・' + result.frames.length + 'コマ・使用 ' + result.colors.length + '色' + (ink_names.length ? '・インク ' + ink_names.join('＋') : '')
    palette.innerHTML = palette_html(result)
    create.disabled = false
    export_button.disabled = false
  }
  const convert = (): void => {
    if (closed) return
    const format = format_input.value as flip_image_format_t
    const [width, height] = format_size(format)
    const key = settings_key()
    const id = ++request
    create.disabled = true
    export_button.disabled = true
    state.textContent = tr('実機の色へ変換中…')
    palette.innerHTML = ''
    let pixels: Uint8ClampedArray
    try {
      const source_key = format + '|' + fit_input.value
      const cached = source_cache.get(source_key)
      if (cached) pixels = cached
      else {
        pixels = source_pixels(source, format, fit_input.value)
        source_cache.set(source_key, pixels)
      }
    } catch (error) {
      report_warning('変換元画像を準備できませんでした', error)
      state.textContent = tr('画像を準備できませんでした')
      return
    }
    convert_flip_image_async(
      {
        format,
        width,
        height,
        pixels,
        frames: clamp(Math.round(Number(frames_input.value)), 1, 16),
        paper: Number(paper_input.value),
        contrast: Number(contrast_input.value) / 100,
        saturation: Number(saturation_input.value) / 100,
      },
      (result, error) => {
        if (closed || id !== request) return
        if (!result) {
          report_warning('画像をうごメモへ変換できませんでした', error)
          state.textContent = tr('変換できませんでした')
          create.disabled = true
          export_button.disabled = true
          return
        }
        latest = result
        latest_key = key
        show_result(result)
      }
    )
  }
  const schedule = (): void => {
    latest = null
    latest_key = ''
    if (debounce) clearTimeout(debounce)
    debounce = window.setTimeout(convert, 180)
  }
  const format_changed = (): void => {
    update_papers()
    schedule()
  }
  update_papers()
  format_input.addEventListener('change', format_changed)
  fit_input.addEventListener('change', schedule)
  frames_input.addEventListener('change', schedule)
  paper_input.addEventListener('change', schedule)
  contrast_input.addEventListener('input', () => {
    contrast_value.textContent = contrast_input.value
    schedule()
  })
  saturation_input.addEventListener('input', () => {
    saturation_value.textContent = saturation_input.value
    schedule()
  })
  const apply_result = (open_export: number): void => {
    const result = latest
    if (!result || latest_key !== settings_key()) {
      schedule()
      return
    }
    try {
      const base = file.name.replace(/\.[^.]+$/, '').trim() || '画像うごメモ'
      result_apply(result, base.slice(0, 40))
      modal_close()
      toast(result.format === 'ppm' ? 'PPM用のうごメモノートを作りました' : 'KWZ用のうごメモ3Dノートを作りました')
      if (open_export) setTimeout(() => modal_export(result.format), 0)
    } catch (error) {
      report_warning('生成したうごメモノートを開けませんでした', error)
      toast('ノートを作れませんでした')
    }
  }
  create.addEventListener('click', () => apply_result(0))
  export_button.addEventListener('click', () => apply_result(1))
  modal_set_cleanup(() => {
    closed = 1
    request++
    if (debounce) clearTimeout(debounce)
    stop_animation()
    latest = null
    source_cache.clear()
    source.close()
  })
  convert()
}

export function flipnote_maker_pick(): void {
  file_pick('image/*', file => {
    image_file_decode(file, source => {
      if (!source) {
        toast('画像を読めませんでした')
        return
      }
      open_maker(file, source)
    })
  })
}
