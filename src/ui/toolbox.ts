import { q } from '../dom'
import { dispatch } from '../state/commands/index'
import { rail_sheet } from './overlay'
import { transform_canvas } from './canvas_panel'

function toolbox_page_show(page: string): void {
  q('rail').dataset.toolboxPage = page
  for (const panel of q('rail').querySelectorAll<HTMLElement>('[data-toolbox-panel]')) panel.hidden = panel.dataset.toolboxPanel !== page
  for (const button of q('rail').querySelectorAll<HTMLElement>('[data-toolbox-page]')) button.setAttribute('aria-pressed', String(button.dataset.toolboxPage === page))
  q('rail').querySelector('.toolbox_body')!.scrollTop = 0
}

export function toolbox_open(focus?: string): void {
  toolbox_page_show(focus === 'features' ? 'features' : focus === 'toolbox_turns' ? 'transform' : focus ? 'view' : 'tools')
  rail_sheet(1)
  if (focus && focus !== 'features') q(focus).scrollIntoView({ block: 'start', inline: 'nearest' })
}

export function toolbox_events(): void {
  q('rail').querySelector('.toolbox_tabs')!.addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-toolbox-page]')
    if (button) toolbox_page_show(button.dataset.toolboxPage!)
  })
  for (const [id, kind, angle] of [['rot_l_btn', 'rotate', -90], ['rot_r_btn', 'rotate', 90], ['flip_h_btn', 'fliph', 0], ['flip_v_btn', 'flipv', 0]] as const) q(id).addEventListener('click', () => transform_canvas(kind, angle))
  q('rotate_apply').addEventListener('click', () => {
    const input = q<HTMLInputElement>('rotation_angle')
    if (input.reportValidity()) transform_canvas('rotate', input.valueAsNumber)
  })
  q('scale_apply').addEventListener('click', () => {
    const input = q<HTMLInputElement>('artwork_scale')
    if (input.reportValidity()) transform_canvas('scale', input.valueAsNumber / 100)
  })
  q('toolbox_mirror').addEventListener('click', () => dispatch('view.toggle_flip', null))
  q('adjust_grid').addEventListener('click', () => dispatch('view.toggle_grid', null))
  q('grid_choices').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-grid-size]')
    if (button) dispatch('view.set_grid_size', Number(button.dataset.gridSize))
  })
  q<HTMLInputElement>('grid_step_num').addEventListener('input', e => dispatch('view.set_grid_size', Number((e.target as HTMLInputElement).value)))
  q('onion_choices').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-onion-count]')
    if (button) dispatch('view.set_onion_count', Number(button.dataset.onionCount))
  })
  for (const [id, key] of [['onion_prev', 'oprev'], ['onion_next', 'onext']] as const) q(id).addEventListener('click', () => dispatch('view.toggle_onion_direction', key))
  q<HTMLInputElement>('onion_count').addEventListener('input', e => dispatch('view.set_onion_count', Number((e.target as HTMLInputElement).value)))
}
