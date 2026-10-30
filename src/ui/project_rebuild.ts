import { memory_work_budget } from '../memory'
import { report_warning } from '../diagnostics'
import { toast } from '../dom'
import { mode_name } from '../mode'
import { project_revision, st } from '../state/store'
import { dispatch } from '../state/commands/index'
import { rebuild_canvas_async } from '../workercli'
import { modal_progress } from './modal'

let busy = 0

export async function project_rebuild(w: number, h: number, ratio: string, res: string, mode?: number): Promise<number> {
  if (busy) return -1
  busy = 1
  dispatch('project.prepare_rebuild', null)
  const g = st(), revision = project_revision(), source = g.doc.frames
  const progress = modal_progress('キャンバスを作り変え中')
  try {
    const frames = await rebuild_canvas_async({ w: g.doc.w, h: g.doc.h, nw: w, nh: h, frames: source, mode, budget: memory_work_budget(g.mobile) }, progress.set)
    dispatch('frame.sync_live', null)
    if (revision !== project_revision() || source !== st().doc.frames) throw new Error('編集中の作品が変わったため作り変えを中止しました')
    const result = dispatch('project.resize_canvas', { w, h, ratio, res, frames, mode })
    if (result < 0) throw new Error('キャンバスを作り変えられませんでした')
    progress.close()
    if (mode !== undefined) toast(mode_name(mode) + 'モードになりました')
    return result
  } catch (error) {
    progress.close()
    report_warning('キャンバスの作り変えを中止しました', error)
    toast(error instanceof Error ? error.message : '作り変えに失敗しました')
    return -1
  } finally { busy = 0 }
}
