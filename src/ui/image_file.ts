import { report_warning } from '../diagnostics'

export type ImageFileSource = {
  width: number
  height: number
  draw: (context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) => void
  close: () => void
}

function image_element_source(file: File, done: (source: ImageFileSource | null) => void): void {
  let url: string
  try {
    url = URL.createObjectURL(file)
  } catch (error) {
    report_warning('画像ファイルの一時URLを作成できませんでした', error)
    done(null)
    return
  }
  let released = 0
  const release = (): void => {
    if (released) return
    released = 1
    try {
      URL.revokeObjectURL(url)
    } catch {}
  }
  const image = new Image()
  image.onload = () => {
    if (image.naturalWidth < 1 || image.naturalHeight < 1) {
      release()
      report_warning('画像ファイルに表示できる画素がありません', file.name)
      done(null)
      return
    }
    done({
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw: (context, x, y, width, height) => context.drawImage(image, x, y, width, height),
      close: release,
    })
  }
  image.onerror = event => {
    release()
    report_warning('画像ファイルを読み込めませんでした', event)
    done(null)
  }
  try {
    image.src = url
  } catch (error) {
    release()
    report_warning('画像ファイルの読み込みを開始できませんでした', error)
    done(null)
  }
}

export function image_file_decode(file: File, done: (source: ImageFileSource | null) => void): void {
  const decode = globalThis.createImageBitmap
  if (!decode) {
    image_element_source(file, done)
    return
  }
  decode(file).then(
    bitmap => {
      if (bitmap.width < 1 || bitmap.height < 1) {
        bitmap.close()
        report_warning('画像ファイルに表示できる画素がありません', file.name)
        done(null)
        return
      }
      let closed = 0
      done({
        width: bitmap.width,
        height: bitmap.height,
        draw: (context, x, y, width, height) => context.drawImage(bitmap, x, y, width, height),
        close: () => {
          if (closed) return
          closed = 1
          bitmap.close()
        },
      })
    },
    error => {
      report_warning('高速画像デコードを使えなかったため通常方式で読み込みます', error)
      image_element_source(file, done)
    }
  )
}
