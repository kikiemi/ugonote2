import { q } from '../dom'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { drawer_set, ctx_hide, pop_close, pop_is_open, pop_open, pop_toggle, rail_sheet } from './overlay'
import { do_redo, do_undo, stage_down, tool_pick } from './stage_input'
import { shape_memory, shape_tools } from './tool_defs'
import { tool_has_options, tool_page_show } from './tool_options'
import { toolbox_open } from './toolbox'
import { tf_open } from './tool_input'
import { layer_cover } from './workspace_layout'

// 横向きのスマホでは、レイヤーの列をいまのレイヤー1つにたたんでおき、押すとほかのレイヤーと「レイヤー」を横にならべる。
// レイヤーのパネルを開いているあいだは、ならべたままにする。
function layer_folded(): boolean {
  return document.body.dataset.workspace === 'landscape' && q('layer_stack').dataset.open !== '1' && pop_is_open() !== 'pop_layer'
}

export function layer_fold(open: number): void {
  q('layer_stack').dataset.open = open ? '1' : ''
  layer_cover()
}

// 右メニュー。道具のボタンは、選んでいない道具なら持ちかえ、選んでいる道具ならその設定を開け閉めする。
export function dock_events(): void {
  const pick = (button: HTMLElement, tool: number, page: string): void => {
    if (st().pen.tool === tool && tool_has_options(tool)) {
      tool_page_show(page)
      pop_toggle('pop_tool', button)
      return
    }
    pop_close()
    rail_sheet(0)
    tool_pick(tool)
  }
  for (const button of q('dock_row').querySelectorAll<HTMLElement>('[data-dock-tool]')) {
    button.addEventListener('click', () => pick(button, Number(button.dataset.dockTool), 'tool'))
  }
  q('dock_shape').addEventListener('click', () => {
    const tool = shape_tools.includes(st().pen.tool) ? st().pen.tool : shape_memory.tool
    pick(q('dock_shape'), tool, 'shape')
  })
  q('studio_quick').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!button) return
    if (button.dataset.quickColor) dispatch('pen.set_color', button.dataset.quickColor)
    if (button.dataset.quickSize) dispatch('pen.set_size', Number(button.dataset.quickSize))
  })
  q('dock_color').addEventListener('click', () => pop_toggle('pop_color', q('dock_color')))
  q('dock_settings').addEventListener('click', () => {
    tool_page_show('tool')
    pop_toggle('pop_tool', q('dock_settings'))
  })
  q('dock_grid').addEventListener('click', () => toolbox_open('blk_grid'))
  q('dock_more').addEventListener('click', () => {
    if (q('rail').classList.contains('on')) rail_sheet(0)
    else toolbox_open()
  })
  q('toolbox_close').addEventListener('click', () => rail_sheet(0))
  q('live_layer_tabs').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-live-layer]')
    if (!button) return
    const layer = Number(button.dataset.liveLayer)
    if (layer_folded()) {
      layer_fold(1)
      return
    }
    layer_fold(0)
    if (layer === st().pen.layer) pop_toggle('pop_layer', button)
    else dispatch('pen.set_layer', layer)
  })
}

export function quick_events(): void {
  q('view_btn').addEventListener('click', () => pop_toggle('pop_view', q('view_btn')))
  q('layer_btn').addEventListener('click', () => {
    layer_fold(0)
    pop_toggle('pop_layer', q('layer_btn'))
  })
  q('tf_btn').addEventListener('click', tf_open)
  q('onion_btn').addEventListener('click', () => toolbox_open('toolbox_onion'))
  q('view_onion_btn').addEventListener('click', () => toolbox_open('toolbox_onion'))
  q('grid_btn').addEventListener('click', () => {
    dispatch('view.toggle_grid', null)
    sfx_play('tap')
  })
  q('vflip_btn').addEventListener('click', () => {
    dispatch('view.toggle_flip', null)
    sfx_play('tap')
  })
  q('fit_btn').addEventListener('click', () => {
    pop_close()
    rail_sheet(0)
    dispatch('view.fit', null)
    sfx_play('tap')
  })
}

export function header_events(): void {
  q('paper_color_btn').addEventListener('click', () => pop_open('pop_paper', q('paper_color_btn')))

  q('menu_btn').addEventListener('click', () => drawer_set(q('drawer').classList.contains('on') ? 0 : 1))
  q('drawer_close').addEventListener('click', () => drawer_set(0))
  q('scrim').addEventListener('click', () => drawer_set(0))
  q('undo_btn').addEventListener('click', do_undo)
  q('redo_btn').addEventListener('click', do_redo)
  const ti = q<HTMLInputElement>('title')
  ti.addEventListener('input', () => {
    dispatch('doc.set_name', ti.value)
  })
  ti.addEventListener('keydown', e => {
    if (e.key === 'Enter') ti.blur()
  })
  const menu_title = q<HTMLInputElement>('menu_title')
  menu_title.addEventListener('input', () => dispatch('doc.set_name', menu_title.value))
}

export function pop_chrome_events(): void {
  q('pop_tool').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('button[data-tool-page]')
    if (button) tool_page_show(button.dataset.toolPage)
  })
  const close_all = (e?: Event): void => {
    if (e?.cancelable) e.preventDefault()
    e?.stopPropagation()
    pop_close()
    rail_sheet(0)
  }
  // メニューの外をさわったら閉じる。「うごかす」のあいだだけは、紙をさわってコマ全体をうごかせるように通す。
  q('pop_scrim').addEventListener('pointerdown', e => {
    if (pop_is_open() === 'pop_tf') {
      e.preventDefault()
      e.stopPropagation()
      stage_down(e)
    } else close_all(e)
  })
  q('pop_scrim').addEventListener('click', e => {
    if (pop_is_open() === 'pop_tf') e.preventDefault()
    else close_all(e)
  })
  const pops = document.querySelectorAll('.pop .popx')
  for (let i = 0; i < pops.length; i++) {
    const close = pops[i] as HTMLElement
    close.addEventListener('click', close_all)
  }
}

export function outside_close(): void {
  document.addEventListener(
    'pointerdown',
    e => {
      const t = e.target as HTMLElement
      if (!q('ctx_menu').classList.contains('hide') && !t.closest('#ctx_menu, #tl_more_btn')) ctx_hide()
      // ならべたレイヤーの列は、ほかの所をさわったらたたむ。紙をさわったときは、メニューと同じく、たたむだけで線は引かない。
      if (q('layer_stack').dataset.open === '1' && !t.closest('#layer_stack')) {
        layer_fold(0)
        if (t.closest('#stage_wrap') && !pop_is_open()) {
          e.stopPropagation()
          e.preventDefault()
          return
        }
      }
      if (!pop_is_open() && !q('rail').classList.contains('on')) return
      if (t.closest('.pop, #pop_scrim, #rail, #stage_wrap')) return
      // メニューを開くボタンと、レイヤーのパネルを開いているときのレイヤーの列は、それぞれのボタンの動きにまかせる。ほかの所をさわったら閉じる。
      if (t.closest('[aria-controls], [aria-haspopup]')) return
      if (pop_is_open() === 'pop_layer' && t.closest('#layer_stack')) return
      pop_close()
      rail_sheet(0)
    },
    { capture: true }
  )
}

