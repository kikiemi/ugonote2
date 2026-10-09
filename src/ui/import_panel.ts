import { report_warning } from '../diagnostics'
import { esc, q, toast } from '../dom'
import { flip_import } from '../flipin'
import { K_PHOTO, L_P } from '../h'
import { canvas_make, file_pick } from '../lib'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { file_open_selected } from './export_ui'
import { image_file_decode } from './image_file'
import { drawer_set, pop_close } from './overlay'
import { modal_confirm, modal_progress } from './modal'
import { vid_import } from '../vid'

export function photo_import(): void {
  file_pick('image/*', file => {
    image_file_decode(file, source => {
      if (!source) {
        toast('画像を読めなかった…')
        return
      }
      try {
        const maxSideScale = Math.min(1, 2048 / Math.max(source.width, source.height))
        const areaScale = Math.min(1, Math.sqrt((4 * 1024 * 1024) / (source.width * source.height)))
        const scale = Math.min(maxSideScale, areaScale)
        const width = Math.max(1, Math.round(source.width * scale))
        const height = Math.max(1, Math.round(source.height * scale))
        const [canvas, context] = canvas_make(width, height)
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        source.draw(context, 0, 0, width, height)
        const globals = st()
        if (q('drawer').classList.contains('on')) drawer_set(0)
        pop_close()
        if (!globals.doc.lvis[L_P]) dispatch('layer.toggle_visible', L_P)
        dispatch('view.set_page', 'canvas')
        if (dispatch('flo.begin_image', { canvas, kind: K_PHOTO, x: globals.doc.w / 2, y: globals.doc.h / 2, continuous: 0 }) < 0) throw new Error('image placement command was rejected')
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
  file_pick('video/*', f => {
    modal_confirm('動画をコマにする', 'いまの「はやさ」(' + st().doc.fps + 'fps) で切り出して、写真レイヤーに追加するよ。', '取り込む', () => {
      const prog = modal_progress('動画を取り込み中')
      vid_import(f, p => prog.set(p), (err, added) => {
        prog.close()
        if (err !== 0) {
          toast(err === -2 ? 'コマがいっぱいで取り込めないよ' : '動画を読めなかった…')
          return
        }
        toast(added + 'コマ取り込みました')
        sfx_play('paper')
      })
    })
  })
}

export function file_open_any(): void {
  file_pick('.ugn2,.kwz,.ppm', file => {
    if (/\.(kwz|ppm)$/i.test(file.name)) flip_open_selected(file)
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
        q('drawerClose').click()
        toast(kind + 'を' + added + 'コマ読み込みました')
        sfx_play('paper')
      })
    }
  )
}

