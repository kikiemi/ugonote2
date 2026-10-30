import { close_html, ic } from '../../dom'

export type sheet_page_t = { id: string, icon: string, label: string, body: string }
export type sheet_t = { icon: string, title: string, preview?: string, pages: sheet_page_t[], actions?: string, wide?: number }

// 道具の設定と同じ形のパネル。見出しと「とじる」、見本、ページ、操作ボタン、ページを切りかえる下のタブ。
export function sheet_html(s: sheet_t): string {
  const pages = s.pages.map((p, i) => `<section class="sheet_page" data-sheet-page="${p.id}"${i ? ' hidden' : ''}>${p.body}</section>`).join('')
  const tabs = s.pages.length > 1
    ? `<nav class="tool_page_tabs">${s.pages.map((p, i) => `<button data-sheet-tab="${p.id}" aria-pressed="${i ? 'false' : 'true'}">${ic(p.icon)}${p.label}</button>`).join('')}</nav>`
    : ''
  return `<div class="pop_head">
      <div class="tool_heading"><b>${ic(s.icon)}<span>${s.title}</span></b></div>
      ${close_html('とじる', ' data-sheet-close')}
    </div>
    ${s.preview ? `<div class="sheet_preview">${s.preview}</div>` : ''}
    <div class="pop_body sheet_body">${pages}</div>
    ${s.actions ? `<div class="sheet_actions">${s.actions}</div>` : ''}
    ${tabs}`
}
