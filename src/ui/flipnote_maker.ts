import { KWZ_CANVAS_H, KWZ_CANVAS_W } from '../codec/kwzgeom'
import { PPM_H, PPM_W } from '../codec/ppm'
import { report_warning } from '../diagnostics'
import { doc_frame_new } from '../doc'
import { esc, ic, query, toast } from '../dom'
import { color_hex, KWZ_COLORS, PPM_COLORS, rgba_word } from '../flipnote/color'
import type { FlipImageFormat, FlipImageResult } from '../flipnote/image'
import { MODE_3D, MODE_DSI, note_meta_zero, type Frame } from '../h'
import { LANG, tr } from '../lang'
import { canvas_make, clamp, file_pick, rle_unpack } from '../lib'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { convert_flip_image_async } from '../workercli'
import { modal_export } from './export_ui'
import { image_file_decode, type ImageFileSource } from './image_file'
import { modal_close, modal_open, modal_set_cleanup } from './modal'

const COLOR_NAMES = ['白', '黒', '赤', '黄', '緑', '青']

function paper_options(format: FlipImageFormat, selected: number): string {
  let options = '<option value="-1">' + tr('画像から自動') + '</option>'
  const colors = format === 'ppm' ? PPM_COLORS.slice(0, 2) : KWZ_COLORS
  for (let index = 0; index < colors.length; index++) {
    const name = tr(COLOR_NAMES[index])
    options += '<option value="' + index + '"' + (selected === index ? ' selected' : '') + '>' + name + '</option>'
  }
  return options
}

function format_size(format: FlipImageFormat): [number, number] {
  return format === 'ppm' ? [PPM_W, PPM_H] : [KWZ_CANVAS_W, KWZ_CANVAS_H]
}

function source_pixels(source: ImageFileSource, format: FlipImageFormat, fit: string): Uint8ClampedArray {
  const [width, height] = format_size(format)
  const [, context] = canvas_make(width, height, 1)
  context.clearRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  const scale = fit === 'contain' ? Math.min(width / source.width, height / source.height) : Math.max(width / source.width, height / source.height)
  const drawWidth = source.width * scale
  const drawHeight = source.height * scale
  source.draw(context, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
  return context.getImageData(0, 0, width, height).data
}

function result_frames(result: FlipImageResult): Frame[] {
  const frames: Frame[] = []
  for (const packed of result.frames) {
    const frame = doc_frame_new()
    frame.pk = packed
    frames.push(frame)
  }
  return frames
}

function result_apply(result: FlipImageResult, name: string): void {
  const mode = result.format === 'ppm' ? MODE_DSI : MODE_3D
  const applied = dispatch('project.apply_flip', {
    meta: note_meta_zero(),
    mode,
    w: result.width,
    h: result.height,
    ratio: '4:3',
    res: result.format === 'ppm' ? 'dsi' : '3ds',
    fps: 30,
    loop: 1,
    paper: result.paperHex,
    frames: result_frames(result),
    cur: 0,
    bgm: null,
    bgmRate: 0,
    bgmFps: 0,
    se: [null, null, null, null],
  })
  if (applied < 0) throw new Error('generated Flipnote project was rejected')
  dispatch('doc.set_name', name)
  dispatch('view.set_page', 'canvas')
}

function palette_html(result: FlipImageResult): string {
  const colors = result.format === 'ppm' ? PPM_COLORS : KWZ_COLORS
  let html = ''
  for (const index of result.colors) {
    const color = colors[index]
    if (!color) continue
    html += '<span class="fmchip"><i style="background:' + color_hex(color) + '"></i>' + esc(tr(COLOR_NAMES[index])) + '</span>'
  }
  return html
}

function preview_images(context: CanvasRenderingContext2D, result: FlipImageResult): ImageData[] {
  const images: ImageData[] = []
  const scratch = new Uint32Array(result.width * result.height)
  const palette = result.format === 'ppm' ? PPM_COLORS : KWZ_COLORS
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

function open_maker(file: File, source: ImageFileSource): void {
  const currentMode = st().doc.mode
  const defaultFormat: FlipImageFormat = currentMode === MODE_3D ? 'kwz' : 'ppm'
  const box = modal_open(
    '<div class="mhead">' + ic('film') + '<span>画像からうごメモを作る</span></div>' +
    '<p class="mbody warn2">' + ic('warn') + ' 通常の写真取り込みとは別に、実機の色・レイヤー制限へ合わせた編集可能なノートを作ります。いまのノートは置きかわります。</p>' +
    '<div class="fmgrid"><div class="fmpreview"><canvas id="fmPreview"></canvas><div id="fmState" class="phint">変換を準備中…</div><div id="fmPalette" class="fmpalette"></div></div>' +
    '<div class="fmopts">' +
    '<label class="mrow"><span class="mlab">形式</span><select id="fmFormat" class="grow"><option value="ppm">PPM・うごメモ</option><option value="kwz">KWZ・うごメモ3D</option></select></label>' +
    '<label class="mrow"><span class="mlab">配置</span><select id="fmFit" class="grow"><option value="cover">画面いっぱい</option><option value="contain">画像全体</option></select></label>' +
    '<label class="mrow"><span class="mlab">なめらかさ</span><select id="fmFrames" class="grow"><option value="1">1コマ・静止</option><option value="4">4コマ・軽量</option><option value="8">8コマ・標準</option><option value="16" selected>16コマ・最高</option></select></label>' +
    '<label class="mrow"><span class="mlab">紙の色</span><select id="fmPaper" class="grow"></select></label>' +
    '<label class="mrow rng"><span class="mlab">明暗</span><input type="range" id="fmContrast" min="70" max="140" value="100"><b id="fmContrastV">100</b></label>' +
    '<label class="mrow rng"><span class="mlab">色の強さ</span><input type="range" id="fmSaturation" min="0" max="160" value="110"><b id="fmSaturationV">110</b></label>' +
    '<div id="fmRules" class="fmrules"></div>' +
    '</div></div>' +
    '<div class="mrow end"><button class="mbtn" id="fmCancel">やめる</button><button class="mbtn" id="fmCreate" disabled>ノートだけ作る</button><button class="mbtn primary" id="fmExport" disabled>作って書き出す…</button></div>',
    1
  )
  box.classList.add('wide')
  const formatInput = query<HTMLSelectElement>(box, '#fmFormat')
  const fitInput = query<HTMLSelectElement>(box, '#fmFit')
  const framesInput = query<HTMLSelectElement>(box, '#fmFrames')
  const paperInput = query<HTMLSelectElement>(box, '#fmPaper')
  const contrastInput = query<HTMLInputElement>(box, '#fmContrast')
  const saturationInput = query<HTMLInputElement>(box, '#fmSaturation')
  const contrastValue = query<HTMLElement>(box, '#fmContrastV')
  const saturationValue = query<HTMLElement>(box, '#fmSaturationV')
  const rules = query<HTMLElement>(box, '#fmRules')
  const state = query<HTMLElement>(box, '#fmState')
  const palette = query<HTMLElement>(box, '#fmPalette')
  const preview = query<HTMLCanvasElement>(box, '#fmPreview')
  const create = query<HTMLButtonElement>(box, '#fmCreate')
  const exportButton = query<HTMLButtonElement>(box, '#fmExport')
  formatInput.value = defaultFormat
  let closed = 0
  let request = 0
  let debounce = 0
  let animation = 0
  let latest: FlipImageResult | null = null
  let latestKey = ''
  const sourceCache = new Map<string, Uint8ClampedArray>()

  const settings_key = (): string => [formatInput.value, fitInput.value, framesInput.value, paperInput.value, contrastInput.value, saturationInput.value].join('|')
  const update_rules = (): void => {
    const format = formatInput.value as FlipImageFormat
    if (format === 'ppm') rules.innerHTML = tr('<b>PPM</b>　256×192・紙1色＋固定インク2色・描画2レイヤー。複数コマの時間ディザで写真の階調を補います。')
    else rules.innerHTML = tr('<b>KWZ</b>　編集310×230・ファイル320×240・全6色。赤・緑・青を含む色を3レイヤーへ2色ずつ割り当てます。')
  }
  const update_papers = (): void => {
    const selected = paperInput.options.length ? Number(paperInput.value) : -1
    paperInput.innerHTML = paper_options(formatInput.value as FlipImageFormat, selected)
    if (![...paperInput.options].some(option => option.value === String(selected))) paperInput.value = '-1'
  }
  const stop_animation = (): void => {
    if (!animation) return
    cancelAnimationFrame(animation)
    animation = 0
  }
  const show_result = (result: FlipImageResult): void => {
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
      exportButton.disabled = true
      return
    }
    context.putImageData(images[0], 0, 0)
    if (images.length > 1) {
      const frameTime = 1000 / 30
      let started = 0
      let lastFrame = 0
      const draw = (time: number): void => {
        if (closed) return
        if (!started) started = time
        const frame = Math.floor((time - started) / frameTime) % images.length
        if (frame !== lastFrame) {
          context.putImageData(images[frame], 0, 0)
          lastFrame = frame
        }
        animation = requestAnimationFrame(draw)
      }
      animation = requestAnimationFrame(draw)
    }
    const inkNames = result.ppmPens ? result.ppmPens.map(index => tr(COLOR_NAMES[index])) : []
    state.textContent = LANG === 'en'
      ? result.width + '×' + result.height + ' · ' + result.frames.length + ' frames · ' + result.colors.length + ' colors' + (inkNames.length ? ' · inks ' + inkNames.join(' + ') : '')
      : result.width + '×' + result.height + '・' + result.frames.length + 'コマ・使用 ' + result.colors.length + '色' + (inkNames.length ? '・インク ' + inkNames.join('＋') : '')
    palette.innerHTML = palette_html(result)
    create.disabled = false
    exportButton.disabled = false
  }
  const convert = (): void => {
    if (closed) return
    const format = formatInput.value as FlipImageFormat
    const [width, height] = format_size(format)
    const key = settings_key()
    const id = ++request
    create.disabled = true
    exportButton.disabled = true
    state.textContent = tr('実機の色へ変換中…')
    palette.innerHTML = ''
    let pixels: Uint8ClampedArray
    try {
      const sourceKey = format + '|' + fitInput.value
      const cached = sourceCache.get(sourceKey)
      if (cached) pixels = cached
      else {
        pixels = source_pixels(source, format, fitInput.value)
        sourceCache.set(sourceKey, pixels)
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
        frames: clamp(Math.round(Number(framesInput.value)), 1, 16),
        paper: Number(paperInput.value),
        contrast: Number(contrastInput.value) / 100,
        saturation: Number(saturationInput.value) / 100,
      },
      (result, error) => {
        if (closed || id !== request) return
        if (!result) {
          report_warning('画像をうごメモへ変換できませんでした', error)
          state.textContent = tr('変換できませんでした')
          create.disabled = true
          exportButton.disabled = true
          return
        }
        latest = result
        latestKey = key
        show_result(result)
      }
    )
  }
  const schedule = (): void => {
    latest = null
    latestKey = ''
    if (debounce) clearTimeout(debounce)
    debounce = window.setTimeout(convert, 180)
  }
  const format_changed = (): void => {
    update_papers()
    update_rules()
    schedule()
  }
  update_papers()
  update_rules()
  formatInput.addEventListener('change', format_changed)
  fitInput.addEventListener('change', schedule)
  framesInput.addEventListener('change', schedule)
  paperInput.addEventListener('change', schedule)
  contrastInput.addEventListener('input', () => {
    contrastValue.textContent = contrastInput.value
    schedule()
  })
  saturationInput.addEventListener('input', () => {
    saturationValue.textContent = saturationInput.value
    schedule()
  })
  query(box, '#fmCancel').addEventListener('click', () => modal_close())
  const apply_result = (openExport: number): void => {
    const result = latest
    if (!result || latestKey !== settings_key()) {
      schedule()
      return
    }
    try {
      const base = file.name.replace(/\.[^.]+$/, '').trim() || '画像うごメモ'
      result_apply(result, base.slice(0, 40))
      modal_close()
      toast(result.format === 'ppm' ? 'PPM用のうごメモノートを作りました' : 'KWZ用のうごメモ3Dノートを作りました')
      if (openExport) setTimeout(() => modal_export(result.format), 0)
    } catch (error) {
      report_warning('生成したうごメモノートを開けませんでした', error)
      toast('ノートを作れませんでした…')
    }
  }
  create.addEventListener('click', () => apply_result(0))
  exportButton.addEventListener('click', () => apply_result(1))
  modal_set_cleanup(() => {
    closed = 1
    request++
    if (debounce) clearTimeout(debounce)
    stop_animation()
    latest = null
    sourceCache.clear()
    source.close()
  })
  convert()
}

export function flipnote_maker_pick(): void {
  file_pick('image/*', file => {
    image_file_decode(file, source => {
      if (!source) {
        toast('画像を読めなかった…')
        return
      }
      open_maker(file, source)
    })
  })
}
