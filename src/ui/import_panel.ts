import { pixel_source_prepare } from '../pixel_source'
import { report_warning } from '../diagnostics'
import { esc, q, query, toast } from '../dom'
import { flip_import } from '../flipin'
import { k_photo, l_p, mode_normal } from '../h'
import { canvas_make, file_pick } from '../lib'
import { sfx_play, snd_decode, snd_load_epoch } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { file_open_selected } from './export_ui'
import { image_file_decode } from './image_file'
import { drawer_set, pop_close } from './overlay'
import { modal_confirm, modal_progress, modal_open, modal_close } from './modal'
import { import_video_async } from '../workercli'
import { mode_name } from '../mode'

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
  const color_hint = mode === mode_normal ? '色をそのまま保ち、なめらかに取り込みます。' : '実機と同じキャンバス・色・レイヤーに変換します。'
  const box = modal_open('<div class="mhead">動画を取り込む</div><p class="mbody">' + esc(file.name) + '</p><p class="mbody"><b>' + esc(mode_name(mode)) + '</b>のまま、動画をコマに分けて音声と一緒に読み込みます。完了すると、いまのノートを置き換えます。</p>' + (mode === mode_normal ? '<label class="prow"><span class="plab">取り込む大きさ</span><select class="msel" id="video_size"><option value="source">元の動画と同じ</option><option value="canvas">現在のキャンバス（' + w + '×' + h + '）</option></select></label>' : '') + '<label class="prow"><span class="plab">1秒あたりのコマ数</span><input class="numin" id="video_fps" type="number" min="0.2" max="30" step="any" value="' + Math.max(0.2, Math.min(30, doc.fps)) + '" required></label><p class="phint">' + color_hint + ' コマの長さはすべて×1です。指定したコマ数・大きさ・音声を保ち、自動で画質を落としません。メモリが足りない場合は、元の作品を保って中止します。読み込めない場合は、いまのノートを保ちます。</p><div class="mrow end"><button class="mbtn" id="video_cancel">やめる</button><button class="mbtn primary" id="video_start">取り込む</button></div>', 1)
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

function flip_open_selected(f: File): void {
  modal_confirm(
    'うごメモ作品を読み込む',
    '<b>' + esc(f.name) + '</b> を読み込みます。<br>いまのノートは<b>置きかわります</b>（もどす不可）。キャンバスは描画領域のサイズ（DSi 256×192 / 3DS 310×230）になります。',
    '読み込む',
    () => {
      const prog = modal_progress('うごメモ作品を読み込み中')
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
      })
    }
  )
}

