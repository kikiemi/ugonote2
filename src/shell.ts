import { html_mount } from './ui/render'
import { editor_html } from './ui/templates/editor'
import { home_html } from './ui/templates/home'
import { dialogs_html } from './ui/templates/dialogs'

export { TOOL_DEFS } from './ui/tool_defs'

export function shell_build(root: HTMLElement): void {
  html_mount(root, editor_html() + home_html() + dialogs_html())
  root.querySelector('#stageWrap')!.appendChild(root.querySelector('#selBar')!)
  root.querySelector('#mainRow')!.appendChild(root.querySelector('#layerStack')!)
  const bay = document.createElement('aside')
  bay.id = 'drawingBay'
  bay.setAttribute('aria-label', '描くためのどうぐ')
  for (const id of ['rail', 'popTool', 'popColor']) bay.appendChild(root.querySelector('#' + id)!)
  root.appendChild(bay)
  for (const pop of root.querySelectorAll<HTMLElement>('.pop:not(#popTool)')) {
    const head = pop.querySelector('.popHead')!
    const body = document.createElement('div')
    body.className = 'popBody'
    while (head.nextSibling) body.appendChild(head.nextSibling)
    pop.appendChild(body)
  }
  for (const block of root.querySelectorAll<HTMLElement>('#toolOptions .pbk')) {
    block.dataset.optionsPage = ({ blkBrush: 'brush', blkSize: 'size', blkGrid: 'grid', blkPxn: 'grid', blkPat: 'pattern' } as Record<string, string>)[block.id] || 'detail'
  }
}
