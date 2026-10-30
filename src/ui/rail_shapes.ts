import { ic, pressed, q } from '../dom'
import { is_shape_tool, shape_tool_list } from '../h'
import { tr } from '../lang'
import { st } from '../state/store'
import { tool_def } from './tool_defs'

// 道具箱の図形は、道具の一覧の1行に入るだけ (列の数より1つ少なく) ならべ、のこりは「その他」から選ぶ。
// 道具箱が出ていないときは、ならべ方はそのまま (出たときに大きさが変わって、もう一度よばれる)。
// 1行に出ていない図形を持っているときは、「その他」をその図形の絵と名前にする。
// ならべなおすのは列の数が変わったときだけ (ならべなおしで道具箱の大きさが変わり、また呼ばれてくり返さないように)。
let rail_columns = 0

export function rail_shapes_render(): void {
  const grid = q('rail_tools')
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length
  if (grid.offsetParent && columns > 1 && columns !== rail_columns) {
    rail_columns = columns
    const shown = Math.min(shape_tool_list.length, columns - 1)
    for (let i = 0; i < shape_tool_list.length; i++) q('tl_' + shape_tool_list[i]).classList.toggle('rshape_more', i >= shown)
  }
  const tool = st().pen.tool
  const button = is_shape_tool(tool) ? q('tl_' + tool) : null
  const hidden = button && button.classList.contains('rshape_more') ? tool_def(tool) : null
  const more = q('tl_shape_more')
  const key = hidden ? String(hidden.t) : ''
  if (more.dataset.shown !== key) {
    more.dataset.shown = key
    more.querySelector('.ic')!.outerHTML = ic(hidden ? hidden.icon : 'dots')
    more.querySelector('.rlbl')!.textContent = hidden ? tr(hidden.label) : tr('その他')
  }
  pressed(more, !!hidden)
}
