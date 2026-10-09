import { report_warning } from '../diagnostics'
import { doc_frame_new } from '../doc'
import { toast } from '../dom'
import { L_P, type Frame } from '../h'
import { canvas_make, file_pick, rle_pack } from '../lib'
import { mode_frame_limit } from '../mode'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { modal_progress } from './modal'
import { zip_read } from '../zipr'

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
            const pngEntries = entries.filter(entry => /\.png$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }))
            if (!pngEntries.length) {
              toast('PNGが入ってないみたい')
              return
            }
            const g = st()
            const initialFrameCount = g.doc.frames.length
            const room = mode_frame_limit(g.doc.mode) - initialFrameCount
            const entryCount = Math.min(room, pngEntries.length)
            if (entryCount < 1) {
              toast('これ以上コマを増やせないよ')
              return
            }
            dispatch('frame.sync_live', null)
            const progress = modal_progress('PNG連番を取り込み中')
            progress.note(entryCount + 'コマ（写真レイヤーへ）')
            const width = g.doc.w
            const height = g.doc.h
            const [, context] = canvas_make(width, height, 1)
            const frames: Frame[] = []
            let entryIndex = 0
            let failedCount = 0

            const finish = (): void => {
              progress.close()
              const current = st()
              if (current.doc.w !== width || current.doc.h !== height || current.doc.frames.length !== initialFrameCount) {
                report_warning('PNG連番の取り込み中にプロジェクト構成が変更されました', 'stale import')
                toast('編集中の内容が変わったため取り込みを中止しました')
                return
              }
              if (!frames.length) {
                toast('読み込めるPNGがありませんでした')
                return
              }
              if (dispatch('frame.append_bulk', { frames, setCur: initialFrameCount + frames.length - 1 }) < 0) {
                toast('PNG連番を追加できなかった…')
                return
              }
              toast(frames.length + 'コマ取り込みました' + (failedCount ? '（' + failedCount + '件は読込失敗）' : ''))
              sfx_play('save')
            }

            const step = (): void => {
              if (entryIndex >= entryCount) {
                finish()
                return
              }
              const entry = pngEntries[entryIndex]
              const data = entry.data.buffer.slice(entry.data.byteOffset, entry.data.byteOffset + entry.data.byteLength) as ArrayBuffer
              const blob = new Blob([data], { type: 'image/png' })
              createImageBitmap(blob).then(
                bitmap => {
                  try {
                    if (bitmap.width < 1 || bitmap.height < 1) throw new RangeError('PNG has no drawable size')
                    context.clearRect(0, 0, width, height)
                    const imageRatio = bitmap.width / bitmap.height
                    const canvasRatio = width / height
                    let drawWidth = width
                    let drawHeight = height
                    if (imageRatio > canvasRatio) drawHeight = Math.round(width / imageRatio)
                    else drawWidth = Math.round(height * imageRatio)
                    context.imageSmoothingEnabled = true
                    context.drawImage(bitmap, Math.round((width - drawWidth) / 2), Math.round((height - drawHeight) / 2), drawWidth, drawHeight)
                    const frame = doc_frame_new()
                    frame.pk[L_P] = pack_img_data(context.getImageData(0, 0, width, height))
                    frames.push(frame)
                  } catch (error) {
                    failedCount++
                    report_warning('PNG連番の画像を変換できませんでした: ' + entry.name, error)
                  } finally {
                    bitmap.close()
                    entryIndex++
                    progress.set(entryIndex / entryCount)
                    step()
                  }
                },
                error => {
                  failedCount++
                  report_warning('PNG連番の画像をデコードできませんでした: ' + entry.name, error)
                  entryIndex++
                  progress.set(entryIndex / entryCount)
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

