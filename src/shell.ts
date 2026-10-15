import { html_mount } from './ui/render'
import { editor_html } from './ui/templates/editor'
import { home_html } from './ui/templates/home'
import { dialogs_html } from './ui/templates/dialogs'

export function shell_build(root: HTMLElement): void {
  html_mount(root, editor_html() + home_html() + dialogs_html())
}
