import { report_warning } from '../diagnostics'
import { doc_frame_new } from '../doc'
import { toast } from '../dom'
import { l_p, type frame_t } from '../h'
import { canvas_make, file_pick, rle_pack } from '../lib'
import { mode_frame_limit } from '../mode'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { modal_progress } from './modal'
import { zip_read, type zip_entry_t } from '../zipr'

function pack_img_data(img: ImageData): Uint32Array {
  return rle_pack(new Uint32Array(img.data.buffer))
}

export function zip_import(): void {
  file_pick('.zip', file => {
    file.arrayBuffer().then(
      buffer => {
        zip_read(buffer).then(
          entries => {
            if (!entries) {
              toast('ZIPを読めなかった…')
              return
            }
            const png_entries: zip_entry_t[] = []
            for (let i = 0; i < entries.length; i++) {
              if (/\.png$/i.test(entries[i].name)) png_entries.push(entries[i])
            }
            png_entries.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }))
            if (!png_entries.length) {
              toast('PNGが入ってないみたい')
              return
            }
            const g = st()
            const initial_frame_count = g.doc.frames.length
            const room = mode_frame_limit(g.doc.mode) - initial_frame_count
            const entry_count = Math.min(room, png_entries.length)
            if (entry_count < 1) {
              toast('これ以上コマを増やせないよ')
              return
            }
            dispatch('frame.sync_live', null)
            const progress = modal_progress('PNG連番を取り込み中')
            progress.note(entry_count + 'コマ（写真レイヤーへ）')
            const width = g.doc.w
            const height = g.doc.h
            const [, context] = canvas_make(width, height, 1)
            const frames: frame_t[] = []
            let entry_index = 0
            let failed_count = 0

            const finish = (): void => {
              progress.close()
              const current = st()
              if (current.doc.w !== width || current.doc.h !== height || current.doc.frames.length !== initial_frame_count) {
                report_warning('PNG連番の取り込み中にプロジェクト構成が変更されました', 'stale import')
                toast('編集中の内容が変わったため取り込みを中止しました')
                return
              }
              if (!frames.length) {
                toast('読み込めるPNGがありませんでした')
                return
              }
              if (dispatch('frame.append_bulk', { frames, set_cur: initial_frame_count + frames.length - 1 }) < 0) {
                toast('PNG連番を追加できなかった…')
                return
              }
              toast(frames.length + 'コマ取り込みました' + (failed_count ? '（' + failed_count + '件は読込失敗）' : ''))
              sfx_play('save')
            }

            const step = (): void => {
              if (entry_index >= entry_count) {
                finish()
                return
              }
              const entry = png_entries[entry_index]
              const data = entry.data.buffer.slice(entry.data.byteOffset, entry.data.byteOffset + entry.data.byteLength) as ArrayBuffer
              const blob = new Blob([data], { type: 'image/png' })
              createImageBitmap(blob).then(
                bitmap => {
                  try {
                    if (bitmap.width < 1 || bitmap.height < 1) throw new RangeError('PNG has no drawable size')
                    context.clearRect(0, 0, width, height)
                    const image_ratio = bitmap.width / bitmap.height
                    const canvas_ratio = width / height
                    let draw_width = width
                    let draw_height = height
                    if (image_ratio > canvas_ratio) draw_height = Math.round(width / image_ratio)
                    else draw_width = Math.round(height * image_ratio)
                    context.imageSmoothingEnabled = true
                    context.drawImage(bitmap, Math.round((width - draw_width) / 2), Math.round((height - draw_height) / 2), draw_width, draw_height)
                    const frame = doc_frame_new()
                    frame.pk[l_p] = pack_img_data(context.getImageData(0, 0, width, height))
                    frames.push(frame)
                  } catch (error) {
                    failed_count++
                    report_warning('PNG連番の画像を変換できませんでした: ' + entry.name, error)
                  } finally {
                    bitmap.close()
                    entry_index++
                    progress.set(entry_index / entry_count)
                    step()
                  }
                },
                error => {
                  failed_count++
                  report_warning('PNG連番の画像をデコードできませんでした: ' + entry.name, error)
                  entry_index++
                  progress.set(entry_index / entry_count)
                  step()
                }
              )
            }
            step()
          },
          error => {
            report_warning('ZIPファイルを読み込めませんでした', error)
            toast('ZIPを読めなかった…')
          }
        )
      },
      error => {
        report_warning('ZIPファイルの内容を読み出せませんでした', error)
        toast('ZIPを読めなかった…')
      }
    )
  })
}

