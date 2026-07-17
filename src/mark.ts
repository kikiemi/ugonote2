import { report_warning } from './diagnostics'
import { toast } from './dom'
import { live_slot } from './engine'
import type { MarkDef } from './h'
import { canvas_make, canvas_to_blob } from './lib'
import { sfx_play } from './snd'
import { dispatch } from './state/commands/index'
import { st } from './state/store'
import { storage_read_json, storage_write_json } from './storage'

const LS_KEY = 'ug2_marks'
const MAX_MARKS = 24

export function marks_load(): void {
  const value = storage_read_json(LS_KEY)
  if (!Array.isArray(value)) return
  const list: MarkDef[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const mark = item as Partial<MarkDef>
    if (typeof mark.id !== 'string' || !mark.id || typeof mark.data !== 'string' || !mark.data.startsWith('data:image/')) continue
    const width = Number(mark.w)
    const height = Number(mark.h)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 220 || height > 220) continue
    list.push({
      id: mark.id.slice(0, 80),
      name: typeof mark.name === 'string' ? mark.name.slice(0, 24) : 'マーク',
      w: Math.round(width),
      h: Math.round(height),
      data: mark.data,
    })
    if (list.length >= MAX_MARKS) break
  }
  dispatch('marks.set_list', list)
}

function marks_save(): void {
  if (!storage_write_json(LS_KEY, st().marks)) toast('マークの保存に失敗（容量オーバーかも）')
}

function gen_id(): string {
  return 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36)
}

export function mark_capture_from_selection(name: string, cb: (ok: number) => void): void {
  let completed = 0
  const finish = (ok: number): void => {
    if (completed) return
    completed = 1
    cb(ok)
  }
  try {
    const g = st()
    const layer = g.pen.layer
    let sourceX = 0
    let sourceY = 0
    let sourceWidth = g.doc.w
    let sourceHeight = g.doc.h
    if (g.sel.has) {
      sourceX = g.sel.x
      sourceY = g.sel.y
      sourceWidth = g.sel.w
      sourceHeight = g.sel.h
    }
    if (sourceWidth < 1 || sourceHeight < 1) {
      finish(0)
      return
    }
    const sourceContext = live_slot(layer)
    const image = sourceContext.getImageData(sourceX, sourceY, sourceWidth, sourceHeight)
    let minX = sourceWidth
    let minY = sourceHeight
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < sourceHeight; y++) {
      for (let x = 0; x < sourceWidth; x++) {
        if (image.data[(y * sourceWidth + x) * 4 + 3] <= 8) continue
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
    if (maxX < minX) {
      finish(0)
      return
    }
    const trimmedWidth = maxX - minX + 1
    const trimmedHeight = maxY - minY + 1
    const [trimmedCanvas, trimmedContext] = canvas_make(trimmedWidth, trimmedHeight)
    trimmedContext.putImageData(image, -minX, -minY, minX, minY, trimmedWidth, trimmedHeight)
    const scale = Math.min(1, 220 / Math.max(trimmedWidth, trimmedHeight))
    const width = Math.max(1, Math.round(trimmedWidth * scale))
    const height = Math.max(1, Math.round(trimmedHeight * scale))
    const [canvas, context] = canvas_make(width, height)
    context.imageSmoothingEnabled = true
    context.drawImage(trimmedCanvas, 0, 0, width, height)
    canvas_to_blob(canvas, 'image/png', undefined, (blob, error) => {
      if (!blob) {
        report_warning('選択範囲のマーク画像を作成できませんでした', error)
        finish(0)
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        try {
          if (typeof reader.result !== 'string') throw new TypeError('FileReader returned a non-string result')
          mark_add({ id: gen_id(), name: name || 'マーク', w: width, h: height, data: reader.result })
          finish(1)
        } catch (readError) {
          report_warning('選択範囲をマークへ保存できませんでした', readError)
          finish(0)
        }
      }
      reader.onerror = () => {
        report_warning('マーク画像を読み出せませんでした', reader.error || 'FileReader error')
        finish(0)
      }
      reader.onabort = () => {
        report_warning('マーク画像の読み出しが中止されました', 'FileReader aborted')
        finish(0)
      }
      try {
        reader.readAsDataURL(blob)
      } catch (readError) {
        report_warning('マーク画像の読み出しを開始できませんでした', readError)
        finish(0)
      }
    })
  } catch (error) {
    report_warning('選択範囲からマークを作成できませんでした', error)
    finish(0)
  }
}

export function mark_capture_from_file(file: File, cb: (ok: number) => void): void {
  let url = ''
  let completed = 0
  const finish = (ok: number): void => {
    if (completed) return
    completed = 1
    if (url) URL.revokeObjectURL(url)
    cb(ok)
  }
  try {
    url = URL.createObjectURL(file)
  } catch (error) {
    report_warning('マーク用画像を開けませんでした', error)
    finish(0)
    return
  }
  const image = new Image()
  image.onload = () => {
    try {
      if (image.naturalWidth < 1 || image.naturalHeight < 1) throw new RangeError('image has no drawable size')
      const scale = Math.min(1, 220 / Math.max(image.naturalWidth, image.naturalHeight))
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      const [canvas, context] = canvas_make(width, height)
      context.imageSmoothingEnabled = true
      context.drawImage(image, 0, 0, width, height)
      const data = canvas.toDataURL('image/png')
      mark_add({ id: gen_id(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 16) || 'マーク', w: width, h: height, data })
      finish(1)
    } catch (error) {
      report_warning('画像からマークを作成できませんでした', error)
      finish(0)
    }
  }
  image.onerror = event => {
    report_warning('マーク用画像を読み込めませんでした', event)
    finish(0)
  }
  image.src = url
}

function mark_add(m: MarkDef): void {
  const list = st().marks.slice() as MarkDef[]
  if (list.length >= MAX_MARKS) list.shift()
  list.push(m)
  dispatch('marks.set_list', list)
  marks_save()
}

export function mark_delete(id: string): void {
  dispatch('marks.remove', id)
  marks_save()
  sfx_play('del')
}

export function mark_get(id: string): MarkDef | null {
  for (const m of st().marks) if (m.id === id) return m
  return null
}

export function mark_place(id: string, cb: (canvas: HTMLCanvasElement | null) => void): void {
  const mark = mark_get(id)
  if (!mark) {
    cb(null)
    return
  }
  const image = new Image()
  image.onload = () => {
    try {
      if (image.naturalWidth < 1 || image.naturalHeight < 1) throw new RangeError('mark image has no drawable size')
      const [canvas, context] = canvas_make(image.naturalWidth, image.naturalHeight)
      context.drawImage(image, 0, 0)
      cb(canvas)
    } catch (error) {
      report_warning('マークを配置用画像へ変換できませんでした', error)
      cb(null)
    }
  }
  image.onerror = event => {
    report_warning('保存済みマークを読み込めませんでした', event)
    cb(null)
  }
  image.src = mark.data
}
