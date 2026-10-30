import { modal_close, modal_open } from './modal'
import { sheet_html, type sheet_t } from './templates/sheet'

export function sheet_page_show(root: HTMLElement, id: string): void {
  for (const page of root.querySelectorAll<HTMLElement>('[data-sheet-page]')) page.hidden = page.dataset.sheetPage !== id
  for (const tab of root.querySelectorAll<HTMLElement>('[data-sheet-tab]')) tab.setAttribute('aria-pressed', String(tab.dataset.sheetTab === id))
}

// 下のタブでページを切りかえる。close を渡すと「とじる」でそれを呼ぶ。
export function sheet_bind(root: HTMLElement, close?: () => void): void {
  root.addEventListener('click', e => {
    const target = e.target as HTMLElement
    if (close && target.closest('[data-sheet-close]')) {
      close()
      return
    }
    const tab = target.closest<HTMLElement>('[data-sheet-tab]')
    if (tab) sheet_page_show(root, tab.dataset.sheetTab!)
  })
}

// ページを切りかえても大きさが変わらないよう、いちばん高いページに合わせる。
function sheet_settle(box: HTMLElement): void {
  const body = box.querySelector<HTMLElement>('.sheet_body')
  const pages = Array.from(box.querySelectorAll<HTMLElement>('[data-sheet-page]'))
  if (!body || pages.length < 2) return
  const shown = pages.find(page => !page.hidden)
  let height = 0
  for (const page of pages) {
    for (const other of pages) other.hidden = other !== page
    height = Math.max(height, body.scrollHeight)
  }
  for (const page of pages) page.hidden = page !== shown
  body.style.flexBasis = height + 'px'
}

// 便利機能の画面のように、モーダルで開く。
export function sheet_open(s: sheet_t): HTMLElement {
  const box = modal_open(sheet_html(s), 1)
  box.classList.add('sheet')
  if (s.wide) box.classList.add('wide')
  sheet_bind(box, modal_close)
  sheet_settle(box)
  return box
}
