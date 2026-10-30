import { pixel_source_prepare } from '../pixel_source'
import { report_warning } from '../diagnostics'
import { esc, ic, q, query, toast } from '../dom'
import { flip_import, type flip_normal_t } from '../flipin'
import { tr } from '../lang'
import { k_photo, l_p, mode_normal, reso_size, resos } from '../h'
import { canvas_make, file_pick } from '../lib'
import { sfx_play, snd_decode, snd_load_epoch } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { file_open_selected } from './export_ui'
import { image_file_decode } from './image_file'
import { drawer_set, pop_close } from './overlay'
import { modal_progress, modal_open, modal_close } from './modal'
import { import_video_async } from '../workercli'

export function photo_import(): void {
  file_pick('image/*', file => {
    image_file_decode(file, source => {
      if (!source) {
        toast('画像を読めなかった…')
        return
      }
      try {
        const max_side_scale = Math.min(1, 2048 / Math.max(source.width, source.height))
        const area_scale = Math.min(1, Math.sqrt((4 * 1024 * 1024) / (source.width * source.height)))
        const scale = Math.min(max_side_scale, area_scale)
        const width = Math.max(1, Math.round(source.width * scale))
        const height = Math.max(1, Math.round(source.height * scale))
        const [canvas, context] = canvas_make(width, height)
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        source.draw(context, 0, 0, width, height)
        const globals = st()
        if (q('drawer').classList.contains('on')) drawer_set(0)
        pop_close()
        if (!globals.doc.lvis[l_p]) dispatch('layer.toggle_visible', l_p)
        dispatch('view.set_page', 'canvas')
        if (dispatch('flo.begin_image', { canvas, kind: k_photo, x: globals.doc.w / 2, y: globals.doc.h / 2, continuous: 0 }) < 0) throw new Error('image placement command was rejected')
        toast('ドラッグで位置、ボタンで回転・大きさ、✓で決定')
      } catch (error) {
        report_warning('画像を写真レイヤーへ取り込めませんでした', error)
        toast('画像を取り込めなかった…')
      } finally {
        try {
          source.close()
        } catch {}
      }
    })
  })
}

export function video_import(): void {
  file_pick('video/*,.mp4,.mov,.m4v,.webm,.mkv', video_open_selected)
}

export function video_open_selected(file: File): void {
  const doc = st().doc
  const mode = doc.mode, epoch = snd_load_epoch(), frames = doc.frames, w = doc.w, h = doc.h, paper = doc.paper
  const box = modal_open(
    '<div class="mhead">' + ic('video') + '<span>動画を取り込む</span></div>' +
    '<p class="mbody mono" data-user-text>' + esc(file.name) + '</p>' +
    (mode === mode_normal ? '<div class="opt_row"><label class="plab" for="video_size">大きさ</label><select id="video_size"><option value="source">元の動画と同じ</option><option value="canvas">いまの紙（' + w + '×' + h + '）</option></select></div>' : '') +
    '<div class="opt_row"><label class="plab" for="video_fps">コマ/秒</label><input class="numin" id="video_fps" type="number" min="0.2" max="30" step="any" value="' + Math.max(0.2, Math.min(30, doc.fps)) + '" required></div>' +
    '<p class="mbody warn">いまのノートと置きかわります</p>' +
    '<div class="mrow end"><button class="pbtn" id="video_cancel">やめる</button><button class="pbtn primary" id="video_start">取り込む</button></div>',
    1
  )
  query(box, '#video_cancel').addEventListener('click', () => modal_close())
  query(box, '#video_start').addEventListener('click', () => {
    const field = query<HTMLInputElement>(box, '#video_fps')
    if (!field.reportValidity()) return
    const fps = field.valueAsNumber
    const size = mode === mode_normal && query<HTMLSelectElement>(box, '#video_size').value === 'source' ? 'source' as const : 'canvas' as const
    const options = { fps, w, h, mode, paper, size }
    modal_close()
    const prog = modal_progress('動画を取り込み中')
    void import_video_async(file, options, p => prog.set(p)).then(async loaded => {
      await pixel_source_prepare(loaded.frames[0])
      const bytes = loaded.slots[0].bytes
      const buffer = bytes ? await new Promise<AudioBuffer | null>(resolve => snd_decode(bytes, resolve)) : null
      if (bytes && !buffer) throw new Error('動画の音声を再生できません。取り込みを中止しました')
      if (st().doc !== doc || snd_load_epoch() !== epoch || doc.mode !== mode || doc.frames !== frames || doc.w !== w || doc.h !== h || doc.paper !== paper) throw new Error('編集中の作品が変わったため取り込みを中止しました')
      if (dispatch('project.apply_loaded', loaded) < 0) throw new Error('動画から作成したノートを開けませんでした')
      prog.close()
      if (q('drawer').classList.contains('on')) drawer_set(0)
      toast(loaded.frames.length + 'コマ取り込みました（' + loaded.w + '×' + loaded.h + '）')
      sfx_play('paper')
    }).catch(error => {
      prog.close()
      report_warning('動画の取り込みを中止しました', error)
      toast(error instanceof Error ? error.message : '動画を読めなかった…')
    })
  })
}

export function file_open_any(): void {
  file_pick('.ugn2,.kwz,.ppm,video/*,.mp4,.mov,.m4v,.webm,.mkv', file => {
    if (file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name)) video_open_selected(file)
    else if (/\.(kwz|ppm)$/i.test(file.name)) flip_open_selected(file)
    else file_open_selected(file)
  })
}

export function flip_import_ui(): void {
  file_pick('.kwz,.ppm', flip_open_selected)
}

// 通常モードで開くときの画質。いまのキャンバスが通常モードの画質ならそれに合わせ、うごメモの実寸などなら低画質にする。
function flip_normal_res(): string {
  const res = st().doc.res
  return ['low', 'mid', 'hd', '4k'].includes(res) ? res : 'low'
}

// 通常モードで開くときの紙のかたち (元の比率 4:3 か、画面全体)。この画面を開いているあいだは、前に選んだものを使う。
let flip_shape = '4:3'

// フルスクリーンにしたときの画面の大きさ (いまの向き)。端末によっては縦向きのままの大きさが返るので、向きに合わせて入れかえる。
function screen_full(): { w: number, h: number } {
  const long = Math.max(screen.width, screen.height) || Math.max(innerWidth, innerHeight, 1)
  const short = Math.min(screen.width, screen.height) || Math.max(1, Math.min(innerWidth, innerHeight))
  return innerWidth >= innerHeight ? { w: long, h: short } : { w: short, h: long }
}

// 画面の形を「16:9」のような比で表す (きれいな比にならないときは、縦を 9 とした比)。
function aspect_name(w: number, h: number): string {
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a
  const g = gcd(w, h)
  if (w / g <= 21 && h / g <= 21) return w / g + ':' + h / g
  return Math.round(w / h * 90) / 10 + ':9'
}

// 通常モードで開くときのキャンバス。元の比率なら、いまの画質の 4:3。画面全体なら、フルスクリーンの画面と同じ比率で、
// 4:3 の絵の高さ (縦長の画面なら幅) をいまの画質にそろえたキャンバス (絵は、違和感のないようにいっぱいまでのばす)。
function flip_normal_canvas(shape: string, res: string): { w: number, h: number, ratio: string, res: string } {
  const base = reso_size('4:3', res)
  if (shape !== 'free') return { ...base, ratio: '4:3', res }
  const full = screen_full()
  const aspect = full.w / full.h
  const w = Math.max(base.w, base.h * aspect)
  const h = w / aspect
  const fit = Math.min(1, 4096 / w, 4096 / h)
  const even = (v: number): number => Math.max(16, Math.round(v * fit / 2) * 2)
  return { w: even(w), h: even(h), ratio: 'free', res: 'free' }
}

// うごメモ作品を開くときに選んだもの。この画面を開いているあいだは、前に選んだものを使う。
// native: うごメモ (3D) モードで開くか。lines: 線をなめらかにするか。fill: 色 (模様) をなめらかな塗りにするか。ai: AI で整えるもの (1 が線、2 が塗り)。
const flip_choice = { native: 0, lines: 1, fill: 1, ai: 0 }

// うごメモの作品は、通常モードで開くか、実機と同じうごメモ (3D) モードで開くかを選んでから読み込む。
// 通常モードでは、線と色をそれぞれなめらかにするか (AI で整えるかも) をチェックで選ぶ。チェックのないものは元の点のまま大きくする。
function flip_open_selected(f: File): void {
  const ppm = /\.ppm$/i.test(f.name)
  const res = flip_normal_res()
  const quality = resos.find(item => item.id === res)?.label || res
  const native_name = ppm ? 'うごメモモードで開く' : 'うごメモ3Dモードで開く'
  const native_note = ppm ? '実機と同じ見た目と大きさ（DSi 256×192）。なめらかにはしません。' : '実機と同じ見た目と大きさ（3DS 310×230）。なめらかにはしません。'
  const box = modal_open(
    '<div class="mhead">' + ic('file') + '<span>うごメモ作品を読み込む</span></div>' +
    '<p class="mbody"><b data-user-text>' + esc(f.name) + '</b></p>' +
    '<p class="mbody">いまのノートは置きかわります（もどす不可）。</p>' +
    '<div class="modegrid flip_modes" role="radiogroup" aria-label="開くモード">' +
    '<button class="modecard" id="m_flip_mode_normal" role="radio">' + ic('check') + '<span><b>通常モードで開く</b><small>いろいろなペンや色で描きたせます</small></span></button>' +
    '<button class="modecard" id="m_flip_mode_native" role="radio">' + ic('check') + '<span><b>' + native_name + '</b><small>' + native_note + '</small></span></button>' +
    '</div>' +
    '<div class="flip_opts" id="m_flip_opts">' +
    '<div class="opt_row"><label class="plab" for="m_flip_shape">紙のかたち</label><select id="m_flip_shape"><option value="4:3">元の比率（4:3）</option><option value="free">画面全体（フルスクリーンの比率）</option></select></div>' +
    // AI (β) は、WebGPU か WebGL2 があれば GPU で、どちらもなければ CPU で (時間をかけて) 動かす。なめらかにするものの右はしに置く。
    '<div class="flip_check"><label class="flip_main"><input type="checkbox" id="m_flip_lines"><span><b>線をなめらかにする</b><small>ギザギザの線を、ペンで引いたなめらかな線にします</small></span></label>' +
    '<label class="flip_ai"><input type="checkbox" id="m_flip_ai"><span>AIで整える（β）</span></label></div>' +
    '<div class="flip_check"><label class="flip_main"><input type="checkbox" id="m_flip_fill"><span><b>色をなめらかにする</b><small>あみ点などの模様を、平らな色の塗りにします</small></span></label>' +
    '<label class="flip_ai"><input type="checkbox" id="m_flip_ai_fill"><span>AIで整える（β）</span></label></div>' +
    '<p class="mbody dim" id="m_flip_note"></p>' +
    ('gpu' in navigator || typeof WebGL2RenderingContext !== 'undefined' ? '' : '<p class="mbody dim">この端末ではAIをCPUで動かすので、時間がかかります。</p>') +
    '</div>' +
    '<div class="mrow end"><button class="pbtn" id="m_no">やめる</button><button class="pbtn primary" id="m_ok">開く</button></div>',
    1
  )
  const shape = query<HTMLSelectElement>(box, '#m_flip_shape')
  const lines = query<HTMLInputElement>(box, '#m_flip_lines')
  const fill = query<HTMLInputElement>(box, '#m_flip_fill')
  const ai_lines = query<HTMLInputElement>(box, '#m_flip_ai')
  const ai_fill = query<HTMLInputElement>(box, '#m_flip_ai_fill')
  shape.value = flip_shape
  lines.checked = !!flip_choice.lines
  fill.checked = !!flip_choice.fill
  ai_lines.checked = !!(flip_choice.ai & 1)
  ai_fill.checked = !!(flip_choice.ai & 2)
  const render = (): void => {
    query(box, '#m_flip_mode_normal').setAttribute('aria-pressed', String(!flip_choice.native))
    query(box, '#m_flip_mode_native').setAttribute('aria-pressed', String(!!flip_choice.native))
    query(box, '#m_flip_mode_normal').setAttribute('aria-checked', String(!flip_choice.native))
    query(box, '#m_flip_mode_native').setAttribute('aria-checked', String(!!flip_choice.native))
    query(box, '#m_flip_opts').hidden = !!flip_choice.native
    // AI は、なめらかにするものだけで使える。
    ai_lines.disabled = !lines.checked
    ai_fill.disabled = !fill.checked
    const size = flip_normal_canvas(shape.value, res)
    const full = screen_full()
    const plain = !lines.checked && !fill.checked ? 'なめらかにせず、元の点のまま大きくします。' : !lines.checked ? '線は元の点のままです。' : !fill.checked ? '模様は元の点のままです。' : ''
    query(box, '#m_flip_note').textContent = (plain ? tr(plain) + ' ' : '') + tr('キャンバス') + ' ' + size.w + '×' + size.h + (shape.value === 'free' ? '（' + aspect_name(full.w, full.h) + '）' : '') + '・' + tr(quality) + '（' + tr('いまのキャンバスの画質') + '）'
  }
  render()
  query(box, '#m_flip_mode_normal').addEventListener('click', () => {
    flip_choice.native = 0
    render()
  })
  query(box, '#m_flip_mode_native').addEventListener('click', () => {
    flip_choice.native = 1
    render()
  })
  shape.addEventListener('change', () => {
    flip_shape = shape.value
    render()
  })
  for (const input of [lines, fill, ai_lines, ai_fill]) input.addEventListener('change', render)
  query(box, '#m_no').addEventListener('click', () => modal_close())
  query(box, '#m_ok').addEventListener('click', () => {
    flip_choice.lines = lines.checked ? 1 : 0
    flip_choice.fill = fill.checked ? 1 : 0
    flip_choice.ai = (ai_lines.checked ? 1 : 0) | (ai_fill.checked ? 2 : 0)
    if (flip_choice.native) {
      flip_open_run(f, null)
      return
    }
    const ai = (lines.checked && ai_lines.checked ? 1 : 0) | (fill.checked && ai_fill.checked ? 2 : 0)
    flip_open_run(f, { ...flip_normal_canvas(shape.value, res), stretch: shape.value === 'free' ? 1 : 0, lines: flip_choice.lines, keep: fill.checked ? 0 : 1, ai })
  })
}

// normal が null なら、うごメモ (3D) モードのまま開く。
function flip_open_run(f: File, normal: Omit<flip_normal_t, 'progress'> | null): void {
  modal_close()
  const prog = modal_progress('うごメモ作品を読み込み中')
  if (normal) prog.note(tr(normal.lines ? normal.keep ? '線をなめらかにしています…' : '線をなめらかにして、模様を色の塗りにしています…' : normal.keep ? '元の点のまま大きくしています…' : '模様を色の塗りにしています…'))
  flip_import(f, (added, kind) => {
    prog.close()
    if (added < 0) return
    if (!added) {
      toast('読み込めなかった…（.kwz / .ppm の中身を確認してください）')
      return
    }
    q('drawer_close').click()
    toast(kind + 'を' + added + 'コマ読み込みました')
    sfx_play('paper')
  }, undefined, normal ? { ...normal, progress: p => prog.set(p) } : undefined)
}
